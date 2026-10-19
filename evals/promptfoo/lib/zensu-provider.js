#!/usr/bin/env node
'use strict';

// Offline promptfoo exec provider for the Zensu Antigravity plugin.
//
// It drives the REAL plugin artifacts — hook scripts through the Antigravity
// shim, shell libraries, and the manifest — inside a disposable sandbox, and
// returns a JSON envelope the shared assertion inspects. No network, no model
// call, no host binary: every scenario is deterministic.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }));
  process.exit(0);
}

// promptfoo hands an exec provider three arguments: the rendered prompt, the
// provider options, and the test context. The scenario vars live in the
// context; the options form is accepted too so the provider stays callable by
// hand for debugging.
function readVars() {
  for (const raw of [process.argv[4], process.argv[3]]) {
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      continue;
    }
    if (parsed && parsed.vars && Object.keys(parsed.vars).length) return parsed.vars;
  }
  return null;
}

function makeSandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-pf-')));
  const project = path.join(base, 'project');
  const data = path.join(base, 'home', '.zensu', 'antigravity', 'plugin-data');
  const home = path.join(base, 'home');
  for (const dir of [project, data, home]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Test-only OS identity seam: exercise shipped adapter code with an isolated
  // home while production continues to ignore caller-controlled HOME selectors.
  const identity = path.join(base, 'os-identity.cjs');
  fs.writeFileSync(identity, `const os=require('node:os'),original=os.userInfo;os.userInfo=(...args)=>({...original(...args),homedir:${JSON.stringify(home)}});`);
  return { base, project, data, home, identity };
}

function writeFixtures(sandbox, files) {
  if (!files || typeof files !== 'object') return;
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.resolve(sandbox.project, relative);
    if (!target.startsWith(sandbox.project + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(contents));
  }
}

function baseEnv(sandbox, vars) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('ZENSU_') || name.startsWith('ANTIGRAVITY_')) delete env[name];
  }
  env.HOME = sandbox.home;
  env.ZENSU_PLUGIN_ROOT = ROOT;
  env.ZENSU_PLUGIN_DATA = sandbox.data;
  env.ZENSU_TEST_PLUGIN_DATA = sandbox.data;
  env.NODE_OPTIONS = `--require ${sandbox.identity}`;
  env.ZENSU_REVIEW_EXECUTION = 'in-thread';
  env.ZENSU_PROJECT_DIR = sandbox.project;
  env.ZENSU_HOST_SESSION_ID = vars.session_id || vars.payload?.conversationId || vars.payload?.session_id || 'pf-session';
  if (vars.env && typeof vars.env === 'object') {
    for (const [key, value] of Object.entries(vars.env)) {
      if (value === null) delete env[key];
      else env[key] = expandTokens(value, sandbox);
    }
  }
  return env;
}

// Scenarios stay portable by writing __PROJECT__ / __DATA__ / __HOME__ wherever
// they need an absolute sandbox path; the provider substitutes the real ones.
function expandTokens(text, sandbox) {
  return String(text)
    .split('__PROJECT__')
    .join(sandbox.project)
    .split('__DATA__')
    .join(sandbox.data)
    .split('__SESSION__')
    .join(sandbox.session || 'pf-session')
    .split('__HOME__')
    .join(sandbox.home);
}

function renderPayload(vars, sandbox) {
  if (typeof vars.payload === 'string') return expandTokens(vars.payload, sandbox);
  if (vars.payload && typeof vars.payload === 'object') {
    return expandTokens(JSON.stringify(vars.payload), sandbox);
  }
  return '';
}

// The shim's second argument is the hook EVENT, and it selects the output
// dialect. Resolving it from hooks.json.template rather than from a table in
// here means a scenario always exercises the event the plugin really wires the
// hook to: re-wire a hook in the template and every scenario follows. A scenario
// can still pass `event:` explicitly to cover a mis-wiring on purpose.
let TEMPLATE_EVENTS = null;
function eventForHook(hook) {
  if (!TEMPLATE_EVENTS) {
    TEMPLATE_EVENTS = new Map();
    try {
      const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json.template'), 'utf8'));
      const note = (event, handler) => {
        const m = String((handler && handler.command) || '').match(/antigravity-shim\.sh\s+(\S+)/);
        if (!m) return;
        // Collect ALL events a hook is wired to. Keeping only the first would let a
        // hook registered on two events silently collapse to whichever JSON key
        // iterates first, and the shim explicitly anticipates that case.
        if (!TEMPLATE_EVENTS.has(m[1])) TEMPLATE_EVENTS.set(m[1], new Set());
        TEMPLATE_EVENTS.get(m[1]).add(event);
      };
      for (const group of Object.values(tpl || {}))
        for (const [event, arr] of Object.entries(group || {})) {
          if (!Array.isArray(arr)) continue;
          for (const entry of arr) {
            if (Array.isArray(entry && entry.hooks)) entry.hooks.forEach(h => note(event, h));
            else note(event, entry);
          }
        }
      const engine = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
      for (const [neutralEvent, groups] of Object.entries(engine.hooks)) {
        const event = {UserPromptSubmit:'PreInvocation',SessionStart:'PreInvocation'}[neutralEvent] || neutralEvent;
        for (const group of groups) for (const handler of group.hooks) {
          const hook = handler.command.match(/\/([^/]+\.sh)"$/)?.[1];
          if (!hook) continue;
          if (!TEMPLATE_EVENTS.has(hook)) TEMPLATE_EVENTS.set(hook, new Set());
          TEMPLATE_EVENTS.get(hook).add(event);
        }
      }
    } catch (error) { fail(`invalid hook inventory: ${error.message}`); }
  }
  const events = TEMPLATE_EVENTS.get(hook);
  if (!events || events.size === 0) {
    fail(`hook ${hook} is not wired in hooks.json.template — pass an explicit \`event:\` var, ` +
         `or the scenario would silently run the no-event dialect and only ever observe {}`);
  }
  if (events.size > 1) {
    fail(`hook ${hook} is wired to ${[...events].join(', ')} — the scenario must name one with \`event:\``);
  }
  return [...events][0];
}

function initializeSession(sandbox, vars) {
  const env = baseEnv(sandbox, vars);
  sandbox.session = env.ZENSU_HOST_SESSION_ID;
  fs.appendFileSync(path.join(sandbox.project, '.gitignore'), '\n.zensu/\n');
  for (const args of [['init','-q'], ['config','user.email','offline@example.invalid'],
    ['config','user.name','Offline Fixture'], ['add','.'], ['commit','-qm','Offline baseline','--allow-empty']]) {
    const result=spawnSync('git', args, {cwd:sandbox.project, env, encoding:'utf8'});
    if(result.status!==0) throw Error(`fixture Git baseline failed: ${result.stderr}`);
  }
  const result=spawnSync('node',[path.join(ROOT,'hooks/antigravity/session-bootstrap.js'),'--event','PreInvocation'], {
    input:JSON.stringify({session_id:sandbox.session,workspace_root:sandbox.project,cwd:sandbox.project}),
    env,cwd:sandbox.project,encoding:'utf8',timeout:30000});
  if(result.status!==0) throw Error(`fixture bootstrap failed: ${result.stdout} ${result.stderr}`);
}

function runHook(vars, sandbox) {
  const hook = String(vars.hook || '');
  if (!/^[A-Za-z0-9._-]+\.sh$/.test(hook)) fail(`invalid hook name: ${hook}`);
  const dialect = vars.dialect || 'antigravity';
  const event = vars.event === undefined ? eventForHook(hook) : String(vars.event);
  const entry =
    dialect === 'flat'
      ? [path.join(ROOT, 'hooks', hook)]
      : [path.join(ROOT, 'hooks', 'antigravity', 'antigravity-shim.sh'), hook, event].filter(
          (part, index) => index < 2 || part !== ''
        );
  if (!fs.existsSync(entry[0])) fail(`missing hook entry: ${entry[0]}`);
  const env = baseEnv(sandbox, vars);
  // A stateful scenario arms the session first (a TDD phase, a review chain),
  // then lets the hook observe that state. The setup runs with the same
  // sandbox environment, so anything it writes is what the hook reads.
  if (vars.setup) {
    const prepared = spawnSync('bash', ['-c', expandTokens(vars.setup, sandbox)], {
      env,
      cwd: sandbox.project,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (prepared.status !== 0) {
      return {
        kind: 'hook',
        hook,
        setup_failed: true,
        exit_code: prepared.status === null ? -1 : prepared.status,
        stdout: prepared.stdout || '',
        stderr: `setup failed: ${prepared.stderr || ''}`,
      };
    }
  }
  const result = spawnSync('bash', entry, {
    input: renderPayload(vars, sandbox),
    env: baseEnv(sandbox, vars),
    cwd: sandbox.project,
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    kind: 'hook',
    hook,
    dialect,
    event,
    exit_code: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runShell(vars, sandbox) {
  const script = String(vars.script || '');
  if (!script) fail('shell scenario requires a script');
  const bound = vars.bind_session ? '. "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-session.sh"; zensu_bind_model_session || exit $?;\n' : '';
  const result = spawnSync('bash', ['-c', bound + expandTokens(script, sandbox)], {
    env: baseEnv(sandbox, vars),
    cwd: sandbox.project,
    encoding: 'utf8',
    timeout: 60000,
  });
  return {
    kind: 'shell',
    exit_code: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runManifest(vars) {
  const target = String(vars.file || 'plugin.json');
  const resolved = path.resolve(ROOT, target);
  if (!resolved.startsWith(ROOT + path.sep)) fail('manifest scenario escaped the plugin root');
  let stdout = '';
  let code = 0;
  try {
    stdout = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    code = 1;
    stdout = '';
  }
  return { kind: 'manifest', file: target, exit_code: code, stdout, stderr: '' };
}

function main() {
  const vars = readVars();
  if (!vars) fail('provider could not parse its options payload');
  const kind = String(vars.kind || 'hook');

  if (kind === 'manifest') {
    process.stdout.write(JSON.stringify(runManifest(vars)));
    return;
  }

  const sandbox = makeSandbox();
  try {
    writeFixtures(sandbox, vars.files);
    if (vars.config) {
      const configPath = path.join(sandbox.home, '.zensu', 'config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        typeof vars.config === 'string' ? vars.config : JSON.stringify(vars.config)
      );
    }
    if (kind === 'hook' || vars.bind_session) initializeSession(sandbox, vars);
    const envelope = kind === 'shell' ? runShell(vars, sandbox) : runHook(vars, sandbox);
    process.stdout.write(JSON.stringify(envelope));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String((error && error.message) || error) }));
  } finally {
    try {
      fs.rmSync(sandbox.base, { recursive: true, force: true });
    } catch (_) {}
  }
}

main();
