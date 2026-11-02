'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
test('native gate composition retains every refusal and authorizes only accepted calls', () => {
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-chain-')));
try {
  const plugin = path.join(temp, 'plugin'), hooks = path.join(plugin, 'hooks'), adapter = path.join(hooks, 'antigravity');
  fs.mkdirSync(adapter, { recursive: true });
  for (const name of ['antigravity-shim.sh', 'emit-verdict.js', 'normalize-payload.js', 'invocation-chain.js', 'render-context.js', 'session-paths.js']) {
    fs.copyFileSync(path.join(root, 'hooks', 'antigravity', name), path.join(adapter, name));
  }
  fs.copyFileSync(path.join(root, 'hooks', 'hooks.json'), path.join(hooks, 'hooks.json'));
  // Session bootstrap/guard behavior has separate contract tests. Here they
  // deliberately add no state, so each chain test controls only gate decisions.
  fs.writeFileSync(path.join(adapter, 'session-bootstrap.js'), `process.stdout.write(process.argv.includes('--data-root') ? ${JSON.stringify(path.join(temp, 'data'))} : JSON.stringify({zensuBootstrap:{created:process.env.ZENSU_TEST_CREATED==='1'}}));`);
  fs.writeFileSync(path.join(adapter, 'session-command-guard.js'), `process.stdout.write(process.argv.includes('--gate-payload') ? require('fs').readFileSync(0,'utf8') : '{}');`);
  const shim = path.join(adapter, 'antigravity-shim.sh');
  const inventory = (tool) => spawnSync('bash', [shim, '--list-handlers', 'pre-tool-chain.sh', tool], { encoding: 'utf8' }).stdout.trim().split('\n');
  const names = [...new Set([...inventory('Write'), ...inventory('Bash')])];
  const stub = (name, verdict = {}, rc = 0) => fs.writeFileSync(path.join(hooks, name), `#!/bin/bash\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify(verdict)}'\nexit ${rc}\n`);
  const clear = () => names.forEach(name => stub(name));
  const deny = (reason) => ({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason } });
  const ask = (kind) => ({ hookSpecificOutput: { permissionDecision: kind, permissionDecisionReason: 'consent required' } });
  const trace = path.join(temp, 'trace'), decisions = path.join(temp, 'decisions');
  function run(tool = 'write_to_file', entry = 'pre-tool-chain.sh', event = 'PreToolUse', created = false, command = 'echo probe') {
    fs.writeFileSync(trace, ''); fs.writeFileSync(decisions, '');
    // Principal binding is covered separately. Use the compatibility identity
    // here while exercising the real native tool/argument normalization.
    const payload = { session_id: 'ba91d910-530e-4a9e-bd12-309a50446a50', workspacePaths: [temp],
      toolCall: { name: tool, args: tool === 'run_command' ? { CommandLine: command, Cwd: temp }
        : tool === 'write_file' ? { Path: path.join(temp, 'probe.txt'), Content: 'probe' }
          : { TargetFile: path.join(temp, 'probe.txt'), CodeContent: 'probe' } } };
    const result = spawnSync('bash', [shim, entry, event], { input: JSON.stringify(payload), encoding: 'utf8',
      env: { ...process.env, ZENSU_SHIM_TRACE: trace, ZENSU_SHIM_DECISIONS: decisions, ZENSU_TEST_CREATED: created ? '1' : '0' } });
    assert.equal(result.status, 0, result.stderr);
    return { verdict: JSON.parse(result.stdout), trace: fs.readFileSync(trace, 'utf8'), decisions: fs.readFileSync(decisions, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
  }
  clear(); stub('pre-write-secret-scan.sh', deny('secret blocked'));
  let result = run();
  assert.equal(result.verdict.decision, 'deny'); assert.equal(result.verdict.reason, 'secret blocked');
  assert.match(result.trace, /pre-edit-tdd-reminder.sh ran/);
  assert.match(result.trace, /pre-write-secret-scan.sh ran/);
  assert.ok(result.decisions.some(row => row.script === 'pre-write-secret-scan.sh' && row.decision === 'deny' && row.contentDigest.length === 64));
  assert.ok(!fs.readFileSync(decisions, 'utf8').includes('secret blocked'));
  assert.ok(!fs.readFileSync(decisions, 'utf8').includes('CodeContent'));
  result = run('write_file');
  assert.equal(result.verdict.decision, 'deny'); assert.equal(result.verdict.reason, 'secret blocked');
  assert.match(result.trace, /pre-edit-tdd-reminder.sh ran/);
  assert.match(result.trace, /pre-write-secret-scan.sh ran/);
  assert.ok(result.decisions.some(row => row.script === 'pre-write-secret-scan.sh'
    && row.decision === 'deny' && row.tool === 'Write'));
  clear(); stub('pre-reviewer-capability-gate.sh', deny('first blocked'));
  result = run(); assert.equal(result.verdict.reason, 'first blocked');
  assert.doesNotMatch(result.trace, /pre-write-secret-scan.sh ran/);
  clear(); stub('pre-reviewer-capability-gate.sh', ask('ask')); result = run(); assert.equal(result.verdict.decision, 'ask');
  clear(); stub('pre-reviewer-capability-gate.sh', ask('force_ask')); stub('pre-edit-tdd-reminder.sh', ask('ask'));
  result = run(); assert.equal(result.verdict.decision, 'force_ask');
  stub('pre-write-secret-scan.sh', deny('later blocked')); result = run(); assert.equal(result.verdict.decision, 'deny');
  clear(); stub('pre-bash-source-write-gate.sh', deny('source blocked')); result = run('run_command');
  assert.equal(result.verdict.reason, 'source blocked'); assert.match(result.trace, /pre-bash-zensu-gate.sh ran/);
  clear(); stub('pre-reviewer-capability-gate.sh', deny('binding rejected'), 2); result = run(); assert.equal(result.verdict.reason, 'binding rejected');
  clear(); stub('pre-reviewer-capability-gate.sh', {}, 2); result = run(); assert.equal(result.verdict.decision, 'deny');
  const startup = spawnSync('bash', [shim, '--list-handlers', 'startup-chain.sh', 'Read'], { encoding:'utf8' }).stdout.trim().split('\n');
  const prompts = spawnSync('bash', [shim, '--list-handlers', 'pre-invocation-chain.sh', 'Read'], { encoding:'utf8' }).stdout.trim().split('\n');
  [...startup, ...prompts].forEach(name => stub(name));
  fs.writeFileSync(path.join(hooks, 'session-start-evidence-discipline.sh'), `#!/bin/bash\nnode -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));if(j.hook_event_name!=="SessionStart"||j.source!=="startup")process.exit(2);console.log(JSON.stringify({hookSpecificOutput:{additionalContext:"startup evidence context"}}))'\n`);
  result=run('write_to_file','pre-invocation-chain.sh','PreInvocation',true);
  assert.ok(result.verdict.injectSteps.some(row=>row.ephemeralMessage.includes('startup evidence context')));
  assert.match(result.trace,/session-start-evidence-discipline.sh ran/);
  result=run('write_to_file','pre-invocation-chain.sh','PreInvocation',false);
  assert.doesNotMatch(result.trace,/session-start-evidence-discipline.sh ran/);
  // Use the real command guard + receipt consumer at the transport boundary.
  // A later engine deny/ask must never leave authorization that can be replayed.
  for (const name of ['session-command-guard.js', 'session-helper.js', 'session-paths.js']) {
    fs.copyFileSync(path.join(root, 'hooks/antigravity', name), path.join(adapter, name));
  }
  const home=fs.realpathSync(temp), data=path.join(home,'.zensu/antigravity/plugin-data');
  const preload=path.join(temp,'os-home.cjs');
  fs.writeFileSync(preload, `const os=require('os'),original=os.userInfo;os.userInfo=(...args)=>({...original(...args),homedir:${JSON.stringify(home)}});`);
  process.env.NODE_OPTIONS=`--require ${preload}`;
  fs.writeFileSync(path.join(adapter, 'session-bootstrap.js'), `process.stdout.write(process.argv.includes('--data-root') ? ${JSON.stringify(data)} : '{}');`);
  const helpers=require(path.join(adapter,'session-helper.js'));
  const guard=require(path.join(adapter,'session-command-guard.js'));
  const session='ba91d910-530e-4a9e-bd12-309a50446a50';
  const command=`bash '${path.join(adapter,'session-helper.sh')}' --session '${session}' --helper log -- --chain-status`;
  const inspect = command => guard.inspectCommand({session_id:session,tool_name:'Bash',tool_input:{command}});
  for (const spelling of ["session-''command-guard.js", "session-\\command-guard.js", "session-\\\ncommand-guard.js"]) {
    assert.equal(inspect(`node '${adapter}'/${spelling} --authorize`).kind,'deny');
    assert.equal(inspect(`node '${adapter}'/${spelling} --authorize < /tmp/fixture-request.json`).kind,'deny');
  }
  assert.equal(inspect('printf ordinary').kind,'ordinary');
  const request=guard.inspectCommand({session_id:session,tool_name:'Bash',tool_input:{command}}).request;
  assert.ok(request);
  clear();stub('pre-bash-source-write-gate.sh',deny('later policy refused'));
  result=run('run_command','pre-tool-chain.sh','PreToolUse',false,command);
  assert.equal(result.verdict.decision,'deny');
  assert.throws(()=>helpers.consumeAuthorization(request,{pluginData:data}),/No current/);
  clear();stub('pre-bash-source-write-gate.sh',ask('ask'));
  result=run('run_command','pre-tool-chain.sh','PreToolUse',false,command);
  assert.equal(result.verdict.decision,'ask');
  assert.throws(()=>helpers.consumeAuthorization(request,{pluginData:data}),/No current/);
  clear();result=run('run_command','pre-tool-chain.sh','PreToolUse',false,command);
  assert.deepEqual(result.verdict,{decision:'ask'});
  helpers.consumeAuthorization(request,{pluginData:data});
  assert.throws(()=>helpers.consumeAuthorization(request,{pluginData:data}),/No current/);
  delete process.env.NODE_OPTIONS;
  console.log('PASS: chain composition, private decisions, and authorization only after all gates accept');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
