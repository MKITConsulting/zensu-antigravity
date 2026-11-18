#!/usr/bin/env node
'use strict';

// LIVE promptfoo exec provider: drives a real `agy` install instead of the
// plugin's own artifacts.
//
// This is the only harness in the repo that can observe what the HOST does, as
// opposed to what our scripts do in isolation. Everything the offline suite
// proves is internal consistency; three shipped defects (a hook-entry shape the
// host rejected, a verdict dialect it ignored, a session id it already provided)
// were invisible to 43 green suites because none of them ever asked agy.
//
// It is opt-in on purpose. It costs model calls, needs a logged-in agy, and is
// therefore skipped unless ZENSU_LIVE_AGY=1. CI stays hermetic.
//
// Probe kinds (PROBES below is the authoritative list — an unknown value errors):
//   command   — resolve a /zensu-* slash command and report the skill it loaded
//   hooklog   — start a session, then read agy's own CLI log for hook-parse errors
//   hookfire  — start a session and report which <event>:<script> pairs ran
//   gatewrite — paired gate-disabled writes and denied writes, with byte-level proof
//   stopcycle — run one conversation twice, unarmed then with the chain armed, and
//               report the enforcer's decision and the host's compliance separately
//   prompt    — send a prompt and return the model's answer verbatim

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const AGY_LOG_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'log');
const DEFAULT_TIMEOUT_S = 120;
const SOURCE_WRITE_CONTENT = 'changed probe content\n';

// process.exit does NOT unwind `finally`, so cleanup has to happen HERE — a
// `finally { rmSync(ws) }` around the probe body is dead code and leaks one temp
// workspace per scenario.
let WORKSPACE = '';
let CANDIDATE_ROOT = '';
const NATIVE_RUNS = [];
function evidenceDirectory() {
  const value = process.env.ZENSU_LIVE_EVIDENCE_DIR;
  if (!value) {
    if (process.env.ZENSU_LIVE_INTERACTIVE === '1') throw Error('interactive live probes require ZENSU_LIVE_EVIDENCE_DIR');
    return null;
  }
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw Error('live evidence directory must be an absolute temporary path');
  const real = fs.realpathSync.native(value);
  const temporaryRoots = [os.tmpdir(), '/tmp'].filter(dir => fs.existsSync(dir)).map(dir => fs.realpathSync.native(dir));
  if (real !== path.resolve(value) || !fs.statSync(real).isDirectory()
      || !temporaryRoots.some(dir => real.startsWith(dir + path.sep))) {
    throw Error('live evidence directory must be a physical directory inside temporary storage');
  }
  return real;
}
function emit(obj) {
  if (WORKSPACE) {
    const evidence = evidenceDirectory();
    if (evidence) {
      const root = installedPluginRoot();
      obj.harnessEvidence = { workspace: WORKSPACE, pluginRoot: root,
        runtimeDigest: root ? require(path.join(root, 'hooks/lib/session-control-core-v1.js')).computeRuntimeDigest(root, 'native') : null,
        nativeRuns: NATIVE_RUNS, workspacePreserved: true };
      fs.writeFileSync(path.join(evidence, `${path.basename(WORKSPACE)}.result.json`), JSON.stringify(obj, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } else {
      try { fs.rmSync(WORKSPACE, { recursive: true, force: true }); } catch (_) {}
      WORKSPACE = '';
    }
  }
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function readVars() {
  for (const raw of [process.argv[4], process.argv[3]]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.vars && Object.keys(parsed.vars).length) return parsed.vars;
    } catch (_) {
      /* try the next argument */
    }
  }
  return null;
}

function haveAgy() {
  return spawnSync('command', ['-v', 'agy'], { shell: true, encoding: 'utf8' }).status === 0;
}

function logSnapshot() {
  const out = new Map();
  try {
    for (const n of fs.readdirSync(AGY_LOG_DIR)) {
      if (!n.endsWith('.log')) continue;
      const full = path.join(AGY_LOG_DIR, n);
      try {
        const st = fs.statSync(full);
        out.set(full, { mtime: st.mtimeMs, size: st.size });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

// The log dir is shared, and scenarios run concurrently (maxConcurrency: 2), so
// "the newest log is fresher than my start time" is satisfied by a SIBLING probe's
// log. That would let this probe report HOOK-PARSE-CLEAN about a file it never
// produced — the exact "never report CLEAN on something it did not read" failure
// the freshness check exists to prevent.
//
// Growth alone does not fix it: under concurrency a sibling's log can easily grow
// MORE than this probe's, so "prefer the one that grew the most" picks the wrong
// file precisely when two probes overlap. The candidate must therefore NAME this
// probe: `marker` is the probe's own mkdtemp workspace path, which agy records in
// its CLI log, and which no other probe can be running under. Only a log that both
// grew during this run AND mentions the marker is this probe's output; without a
// match the caller reports LIVE-UNAVAILABLE rather than reading a stranger's file.
function logWrittenDuring(before, marker) {
  if (!marker) return null;
  const needle = path.basename(String(marker));
  let best = null;
  for (const [full, now] of logSnapshot()) {
    const prev = before.get(full);
    const grew = prev ? now.size - prev.size : now.size;
    if (grew <= 0) continue;
    let text = '';
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (_) {
      continue;
    }
    if (!text.includes(needle)) continue;
    if (!best || grew > best.grew) best = { full, grew };
  }
  return best ? best.full : null;
}

// Turn a trace into the hook-firing verdict.
//
// Reports EVENT:SCRIPT pairs, not bare script names. A de-duplicated list of
// script names cannot distinguish "all five hook groups fired" from "only the
// PreToolUse group fired": revert the hooks.json flat-list fix and the host again
// rejects the PreInvocation and Stop groups, yet a name-only list still reads
// HOOKS-FIRED and the scenario stays green — the precise regression this probe
// exists to catch. The pair lets a scenario name the groups it requires.
//
// `requireFired` is a SPACE-SEPARATED STRING, never a YAML list: promptfoo expands
// an array-valued var into one test run per element, so a three-item list ran the
// probe three times and handed each run a single string — Array.isArray was false,
// the requirement silently emptied, and the scenario reported the weaker
// "HOOKS-FIRED". Matching the pairs in YAML instead would mean asserting
// substrings of a sorted, space-joined list, which is order-fragile, so the check
// lives here and the scenario asserts a single stable marker.
function fireReport(rows, requireFired) {
  // Only `ran` rows satisfy a requirement. A bailed row proves the host called the
  // registration but the wrapped script never executed — reporting that as "fired"
  // would turn a dropped-script packaging defect into a green run.
  const fired = Array.from(
    new Set(rows.filter(e => e.outcome === 'ran').map(e => `${e.event}:${e.script}`))
  ).sort();
  const bailed = Array.from(
    new Set(rows.filter(e => e.outcome !== 'ran').map(e => `${e.event}:${e.script}(${e.outcome})`))
  ).sort();
  const required = String(requireFired || '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const missing = required.filter(r => !fired.includes(r));

  // A tool-call hook group can only be observed if the model actually made a tool
  // call. When it did not, "PreToolUse:x.sh is missing" reads as a registration
  // defect while the real cause is that the host never reached a tool call at all —
  // a different problem with a different fix. Say which. LIVE-INCONCLUSIVE still
  // fails the run (run-live.sh treats it exactly like LIVE-UNAVAILABLE); it only
  // changes the diagnosis, never the verdict.
  const wantsToolCall = required.some(
    r => r.startsWith('PreToolUse:') || r.startsWith('PostToolUse:')
  );
  const sawToolCall = rows.some(e => e.event === 'PreToolUse' || e.event === 'PostToolUse');

  let verdict;
  if (!fired.length) verdict = 'HOOKS-NOT-FIRED';
  else if (missing.length && wantsToolCall && !sawToolCall) {
    verdict = `LIVE-INCONCLUSIVE the model made no tool call, so ${missing.join(' ')} could not be observed`;
  } else if (missing.length) verdict = `HOOKS-FIRED-MISSING ${missing.join(' ')}`;
  else verdict = required.length ? 'HOOKS-FIRED-ALL' : 'HOOKS-FIRED';

  return { fired, bailed, required, missing, verdict };
}

// A throwaway workspace per probe: agy anchors project state on the workspace,
// and a probe must never write into the user's repos.
function copyCandidate(ws, stage) {
  if (!isAgyPluginRoot(stage) || !fs.existsSync(path.join(stage, 'plugin.json'))
      || !fs.existsSync(path.join(stage, 'hooks.json'))) throw Error('incomplete portable plugin stage');
  const inspect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('portable plugin stage contains a symbolic link');
      if (entry.isDirectory()) inspect(path.join(directory, entry.name));
      else if (!entry.isFile()) throw Error('portable plugin stage contains a non-regular file');
    }
  };
  inspect(stage);
  const target = path.join(ws, '.agents/plugins/zensu');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(stage, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}

function makeWorkspace(parent, scenarioId) {
  CANDIDATE_ROOT = '';
  const evidence = evidenceDirectory();
  const manifestFile = process.env.ZENSU_LIVE_WORKSPACE_MANIFEST;
  if (manifestFile) {
    if (!evidence || !path.isAbsolute(manifestFile) || fs.realpathSync.native(manifestFile) !== path.resolve(manifestFile)
        || !manifestFile.startsWith(evidence + path.sep) || !fs.lstatSync(manifestFile).isFile()
        || fs.statSync(manifestFile).size > 128 * 1024) throw Error('workspace manifest must be a bounded physical file under the evidence directory');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.schema !== 'zensu-live-workspaces-v1' || !Array.isArray(manifest.entries) || !manifest.entries.length
        || manifest.entries.some(entry => !entry || typeof entry.scenarioId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.scenarioId)
          || typeof entry.workspace !== 'string')
        || new Set(manifest.entries.map(entry => entry.scenarioId)).size !== manifest.entries.length
        || new Set(manifest.entries.map(entry => entry.workspace)).size !== manifest.entries.length) throw Error('workspace manifest has invalid or duplicate entries');
    const entry = manifest.entries.find(candidate => candidate.scenarioId === scenarioId);
    if (!entry) throw Error('workspace manifest does not name this exact scenario');
    const ws = fs.realpathSync.native(entry.workspace);
    if (ws !== entry.workspace || path.dirname(ws) !== path.join(evidence, 'workspaces')
        || !/^zensu-live-[A-Za-z0-9]+$/.test(path.basename(ws)) || !fs.statSync(ws).isDirectory()) throw Error('manifest workspace is not an owned physical live-probe directory');
    const plugin = installedPluginRoot();
    const registry = { entries: [{ path: path.dirname(plugin), include_only: [path.basename(plugin)] }] };
    const names = fs.readdirSync(ws).sort();
    const agents = path.join(ws, '.agents'), note = path.join(ws, 'note.txt'), pointer = path.join(agents, 'plugins.json');
    if (JSON.stringify(names) !== JSON.stringify(['.agents', 'note.txt']) || !fs.lstatSync(agents).isDirectory()
        || JSON.stringify(fs.readdirSync(agents)) !== JSON.stringify(['plugins.json'])
        || !fs.lstatSync(note).isFile() || fs.readFileSync(note, 'utf8') !== 'probe workspace\n'
        || !fs.lstatSync(pointer).isFile() || JSON.stringify(JSON.parse(fs.readFileSync(pointer, 'utf8'))) !== JSON.stringify(registry)) {
      throw Error('preallocated workspace differs from its untouched note and frozen plugin registry');
    }
    const claims = path.join(evidence, 'workspace-claims');
    fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(claims, `${scenarioId}.json`), JSON.stringify({ scenarioId, workspace: ws, pid: process.pid }) + '\n',
      { flag: 'wx', mode: 0o600 });
    if (process.env.ZENSU_LIVE_INTERACTIVE === '1') {
      // agy 1.5.6 rejects registry paths outside the workspace. Keep the frozen
      // template untouched and bind every observation to this local copy.
      CANDIDATE_ROOT = copyCandidate(ws, plugin);
      fs.writeFileSync(pointer, JSON.stringify({ entries: [{
        path: path.dirname(CANDIDATE_ROOT), include_only: [path.basename(CANDIDATE_ROOT)],
      }] }) + '\n', { mode: 0o600 });
    }
    return ws;
  }
  if (!parent) {
    parent = evidence ? path.join(evidence, 'workspaces') : os.tmpdir();
    if (evidence) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  // Host Cwd and immutable project bindings use physical paths. A logical temp
  // alias would turn an intended in-root write into an outside-worktree probe.
  const ws = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'zensu-live-')));
  fs.writeFileSync(path.join(ws, 'note.txt'), 'probe workspace\n');
  if (process.env.ZENSU_LIVE_PLUGIN_ROOT || process.env.ZENSU_LIVE_INTERACTIVE === '1') {
    const plugin = installedPluginRoot();
    fs.mkdirSync(path.join(ws, '.agents'), { mode: 0o700 });
    fs.writeFileSync(path.join(ws, '.agents/plugins.json'), JSON.stringify({
      entries: [{ path: path.dirname(plugin), include_only: [path.basename(plugin)] }],
    }) + '\n', { mode: 0o600 });
  }
  if (process.env.ZENSU_LIVE_PLUGIN_STAGE || process.env.ZENSU_LIVE_INTERACTIVE === '1') {
    try {
      const stage = process.env.ZENSU_LIVE_PLUGIN_STAGE
        ? fs.realpathSync(process.env.ZENSU_LIVE_PLUGIN_STAGE) : installedPluginRoot();
      CANDIDATE_ROOT = copyCandidate(ws, stage);
      if (process.env.ZENSU_LIVE_INTERACTIVE === '1') fs.writeFileSync(path.join(ws, '.agents/plugins.json'),
        JSON.stringify({ entries: [{ path: path.dirname(CANDIDATE_ROOT), include_only: ['zensu'] }] }) + '\n', { mode: 0o600 });
    } catch (error) {
      fs.rmSync(ws, { recursive: true, force: true });
      throw error;
    }
  }
  return ws;
}

// Chain state has to be armed with the SAME helper the Stop hook will read it
// back with, and the hook runs out of the INSTALLED plugin — not this checkout.
// Arming from the repo would silently pass whenever the two have drifted.
//
// Prefer the host's actual imported tree. The native adapter pointer is only a
// fallback; the legacy shared ~/.zensu/plugin-root may belong to another host.
// The adapter marker prevents accidentally arming a foreign plugin's state.
const AGY_PLUGIN_MARKER = path.join('hooks', 'antigravity', 'antigravity-shim.sh');

function isAgyPluginRoot(dir) {
  if (!dir) return false;
  return (
    fs.existsSync(path.join(dir, AGY_PLUGIN_MARKER)) &&
    fs.existsSync(path.join(dir, 'hooks', 'lib', 'zensu-log.sh'))
  );
}

// Returns null when no INSTALLED agy plugin can be identified. Deliberately not
// the repo checkout: falling back to it is the "silently pass whenever the two
// have drifted" case the note above exists to prevent, and it would report a
// verdict about a tree the host never loaded. The caller turns null into
// LIVE-UNAVAILABLE.
function installedPluginRoot() {
  if (process.env.ZENSU_LIVE_PLUGIN_STAGE && (process.env.ZENSU_LIVE_PLUGIN_ROOT || process.env.ZENSU_LIVE_INTERACTIVE === '1')) throw Error('candidate stage and explicit interactive plugin modes cannot be mixed');
  if (process.env.ZENSU_LIVE_INTERACTIVE === '1' && CANDIDATE_ROOT) return CANDIDATE_ROOT;
  // Candidate mode must never silently exercise the user's global installation.
  if (process.env.ZENSU_LIVE_PLUGIN_STAGE) return CANDIDATE_ROOT || null;
  const explicit = process.env.ZENSU_LIVE_PLUGIN_ROOT;
  if (explicit) {
    if (!path.isAbsolute(explicit) || /[\0\r\n]/.test(explicit)) throw Error('ZENSU_LIVE_PLUGIN_ROOT must be an absolute physical plugin directory');
    const real = fs.realpathSync.native(explicit);
    if (real !== path.resolve(explicit) || !isAgyPluginRoot(real) || !fs.existsSync(path.join(real, 'hooks.json'))) {
      throw Error('ZENSU_LIVE_PLUGIN_ROOT must identify the staged native plugin, including generated hooks.json');
    }
    return real;
  }
  if (process.env.ZENSU_LIVE_INTERACTIVE === '1') throw Error('interactive live probes require an explicit frozen ZENSU_LIVE_PLUGIN_ROOT');
  const hostDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zensu');
  if (isAgyPluginRoot(hostDir)) return hostDir;
  try {
    const pinned = fs.readFileSync(path.join(os.homedir(), '.zensu', 'antigravity', 'plugin-root'), 'utf8').trim();
    if (isAgyPluginRoot(pinned)) return pinned;
  } catch (_) {}
  return null;
}

function installedSessionEnvironment(ws, sid) {
  const root = installedPluginRoot();
  if (!root) return null;
  const data = spawnSync('node', [path.join(root, 'hooks/antigravity/session-bootstrap.js'), '--data-root'], { encoding: 'utf8' });
  if (data.status !== 0 || !data.stdout.trim()) return null;
  return { ...process.env, ZENSU_PLUGIN_ROOT: root, ZENSU_PLUGIN_DATA: data.stdout.trim(),
    ZENSU_HOST_SESSION_ID: sid, ZENSU_PROJECT_DIR: ws, ZENSU_CONFIG: path.join(ws, '.zensu/config.json') };
}

// The provider is the external fixture driver. It uses the installed canonical
// helper under this probe's explicit immutable host session binding; the agent
// itself must still use the guarded session helper route.
function zensuLog(ws, args, sid) {
  const root = installedPluginRoot(), env = installedSessionEnvironment(ws, sid);
  if (!root || !env) return { status: 1, stdout: '', stderr: 'no installed session adapter', error: true };
  return spawnSync('bash', [path.join(root, 'hooks/lib/zensu-log.sh'), ...args], { cwd: ws, encoding: 'utf8', env });
}

function stateSnapshot(ws, sid) {
  const root = installedPluginRoot();
  if (!root) return null;
  try { return require(path.join(root, 'hooks/lib/session-control-core-v1.js')).readWorkflowState({ projectRoot: ws, sessionId: sid }); }
  catch (_) { return null; }
}

// Parse one trace line into {event, script, outcome}. Exported so a deterministic
// test can run the REAL parser over a trace the REAL shim produced — a test that
// merely re-implements this logic pins one side only and drifts silently.
//
// The script is read from position 1, NOT from the last token: the shim appends an
// outcome field, and "the hook was invoked" and "the wrapped script ran" are
// different claims. Collapsing them is a false verification — a staging step that
// drops a script would otherwise report the hook as fired.
function parseTraceLine(line) {
  const t = String(line).trim().split(/\s+/);
  if (t.length < 2) return null;
  const script = t[1];
  if (!/\.(?:sh|js)$/.test(script)) return null;
  return { event: t[0], script, outcome: t[2] || 'ran' };
}

function readTrace(traceFile) {
  try {
    return fs
      .readFileSync(traceFile, 'utf8')
      .split('\n')
      .map(parseTraceLine)
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Only EXECUTED invocations count. A bailed one proves the host called us, never
// that the hook did anything.
function countHook(traceFile, script) {
  return readTrace(traceFile).filter(e => e.script === script && e.outcome === 'ran').length;
}

// A second Stop is not required: a correctly resumed model may still be
// executing tools when bounded print mode ends. Observe the host's own block
// message and later completed model activity within this exact resumed turn.
function stopContinuationProof({ sessionId, prompt, controlRows, armedRows, controlDecisions, armedDecisions }) {
  const no = reason => ({ verified: false, reason });
  const ordered = rows => Array.isArray(rows) && rows.length > 0 && rows.every((row, index) =>
    Number.isSafeInteger(row?.step_index) && row.step_index >= 0 && (!index || row.step_index > rows[index - 1].step_index));
  const human = row => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT' && row.status === 'DONE';
  const exactInput = row => row.content === prompt || (typeof row.content === 'string'
    && row.content.startsWith(`<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\n`));
  const hostBlock = row => row.type === 'SYSTEM_MESSAGE' && row.source === 'SYSTEM' && row.status === 'DONE'
    && typeof row.content === 'string' && (row.content.startsWith('Stop hook blocked termination: ')
      || row.content.startsWith('The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\nStop hook blocked termination: '));
  const ownDecisions = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row => row.sessionId === sessionId
    || (row.parentSessionId === sessionId && row.agentId === row.sessionId
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.agentId || '')));
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId || '')
      || !ordered(controlRows) || !ordered(armedRows)) return no('missing ordered own transcript');
  if (!ownDecisions(controlDecisions) || !ownDecisions(armedDecisions)) return no('missing or foreign decision identity');
  if (JSON.stringify(armedRows.slice(0, controlRows.length)) !== JSON.stringify(controlRows)) return no('control transcript prefix changed');
  const controlUsers = controlRows.filter(row => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT');
  const armedUsers = armedRows.filter(row => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT');
  if (controlUsers.length !== 1 || armedUsers.length !== 2 || !armedUsers.every(row => human(row) && exactInput(row))
      || armedUsers[1].step_index <= controlRows.at(-1).step_index) return no('not the exact resumed human turn');
  const controlStops = controlDecisions.filter(row => row.sessionId === sessionId && row.event === 'Stop' && row.script === 'stop-chain-enforcer.sh');
  if (controlStops.length !== 1 || controlStops[0].decision === 'block' || controlRows.some(hostBlock)) return no('control did not stop freely');
  if (!armedDecisions.some(row => row.sessionId === sessionId && row.event === 'Stop' && row.script === 'stop-chain-enforcer.sh' && row.decision === 'block')) return no('no own enforcer block');
  const turn = armedRows.filter(row => row.step_index > armedUsers[1].step_index);
  const block = turn.find(hostBlock);
  if (!block) return no('no host SYSTEM block in armed turn');
  const resumed = turn.find(row => row.step_index > block.step_index && row.type === 'PLANNER_RESPONSE'
    && row.source === 'MODEL' && row.status === 'DONE'
    && ((Array.isArray(row.tool_calls) && row.tool_calls.length > 0) || (typeof row.content === 'string' && row.content.trim())));
  if (!resumed) return no('no completed model activity after host block');
  return { verified: true, armedUserStep: armedUsers[1].step_index, blockedStep: block.step_index,
    resumedStep: resumed.step_index, activity: resumed.tool_calls?.length ? 'tool-call' : 'response',
    completedToolResults: turn.filter(row => row.step_index > resumed.step_index
      && row.type === 'GENERIC' && row.source === 'MODEL' && row.status === 'DONE').length };
}

function stopVerdicts({ enforcingStops, continuation }) {
  const blocked = enforcingStops >= 1;
  return {
    enforcer: blocked ? 'STOP-BLOCKED' : 'STOP-NOT-BLOCKED',
    host: blocked && continuation?.verified === true ? 'STOP-HONORED' : 'STOP-NOT-HONORED',
  };
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch (_) {
    return 0;
  }
}

// Decide where this probe's trace goes. Returns {path} or {error}; exported
// because this is the only thing standing between a PR-editable scenario var and
// an `fs.rmSync(..., {force:true})`, and it has already shipped one bug.
//
// An explicit path is the post-mortem escape hatch: the per-probe default lives
// inside the throwaway workspace and dies with it, so an operator who wants to
// READ the raw trace afterwards has to name a path that survives. It is confined
// to the temp dir and suffixed per scenario, because scenarios run concurrently
// and a verbatim shared path reintroduces the cross-talk the default prevents.
function resolveTraceFile(vars, probe, ws) {
  const explicit = (vars && vars.trace_file) || process.env.ZENSU_SHIM_TRACE || '';
  if (!explicit) return { path: path.join(ws, 'shim-trace.log') };

  // Realpath BOTH sides. Comparing an unresolved candidate against a resolved root
  // is wrong in both directions: on macOS os.tmpdir() is /var/folders/… whose
  // realpath is /private/var/folders/…, so every natural $TMPDIR path was rejected
  // and this escape hatch never worked on the platform the repo is developed on;
  // and a symlinked intermediate component could otherwise point the append and
  // the unlink outside the temp dir entirely.
  const resolved = path.resolve(explicit);
  const tmp = fs.realpathSync(os.tmpdir());
  let realParent;
  try {
    realParent = fs.realpathSync(path.dirname(resolved));
  } catch (_) {
    return { error: `trace_file directory does not exist: ${path.dirname(resolved)}` };
  }
  if (realParent !== tmp && !realParent.startsWith(tmp + path.sep)) {
    return { error: `trace_file must resolve under ${tmp}: ${explicit} -> ${realParent}` };
  }
  const tag = String((vars && vars.scenario_id) || probe).replace(/[^A-Za-z0-9._-]/g, '_');
  return { path: path.join(realParent, `${path.basename(resolved)}.${tag}`) };
}

// "agy could not answer" and "agy answered, and the answer is wrong" are
// different findings and must never share a verdict. A quota wall reported as
// UNRESOLVED reads exactly like a dead command shim — this pattern was hit for
// real: 15 command probes came back UNRESOLVED purely because the account's
// quota ran out mid-sweep.
const UNAVAILABLE = /quota reached|rate limit|Please upgrade your subscription|not authenticated|login required|context deadline exceeded|connection refused/i;

function unavailableReason(run) {
  // stderr ONLY: the model's own answer is data, not a transport signal. Matching
  // stdout would report an unreachable host for a reply that merely mentions a quota.
  const m = String(run.stderr || '').match(UNAVAILABLE);
  if (m) return m[0];
  // A killed run is unavailability, never data. spawnSync reports a timeout through
  // `error`/`signal` while still handing back whatever partial stdout was flushed,
  // so a probe that ignores these computes its verdict from a TRUNCATED trace — a
  // stopcycle cut off mid-loop would report STOP-NOT-HONORED for a wall-clock limit.
  if (run.signal) return `agy was killed by ${run.signal} (timeout or external kill)`;
  if (run.spawn_error) return `agy could not run: ${run.spawn_error}`;
  if (run.exit_code !== 0 && !run.stdout.trim()) {
    return `agy exited ${run.exit_code} with no output`;
  }
  return '';
}

// Tool probes require an interactive, one-time approval channel. A disposable
// path confines the test; it never grants permission to bypass host approval.
function toolProbeArgs(ws) {
  const evidence = evidenceDirectory();
  const root = fs.realpathSync(evidence ? path.join(evidence, 'workspaces') : os.tmpdir());
  const actual = fs.realpathSync(ws);
  if (actual !== path.resolve(ws) || path.dirname(actual) !== root || !/^zensu-live-[A-Za-z0-9]+$/.test(path.basename(actual))) {
    throw new Error('tool probes require a physical disposable live-probe workspace');
  }
  if (process.env.ZENSU_LIVE_INTERACTIVE !== '1') throw Error('tool probes require ZENSU_LIVE_INTERACTIVE=1 and one-time approvals');
  return [];
}

function agyArgs(prompt, ws, seconds, extraArgs = []) {
  const project = extraArgs.includes('--conversation') ? [] : ['--new-project'];
  const model = process.env.ZENSU_LIVE_MODEL ? ['--model', process.env.ZENSU_LIVE_MODEL] : [];
  return ['-p', prompt, '--add-dir', ws, '--print-timeout', `${seconds}s`, ...project, ...model, ...extraArgs];
}

function runAgy(prompt, ws, timeoutS, extraEnv, extraArgs, stopProbe) {
  if (process.env.ZENSU_LIVE_INTERACTIVE === '1') {
    const pluginRoot = installedPluginRoot();
    const run = require('./agy-interactive-run.js').runInteractive({ prompt, ws, timeoutS, extraEnv, extraArgs, pluginRoot, stopProbe });
    const actual = run.nativeEvidence;
    const runtimeDigest = require(path.join(pluginRoot, 'hooks/lib/session-control-core-v1.js')).computeRuntimeDigest(pluginRoot, 'native');
    NATIVE_RUNS.push({ nativeSessionId: run.nativeSessionId || null, nativeEvidence: actual || null });
    if (!actual || actual.verified !== true || actual.workspace !== ws || actual.pluginRoot !== pluginRoot
        || actual.runtimeDigest !== runtimeDigest || actual.sessionId !== run.nativeSessionId) {
      return { ...run, stdout: run.stdout || '', stderr: run.stderr || '', spawn_error: run.spawn_error || 'interactive native binding was not verified' };
    }
    return run;
  }
  const seconds = Number(timeoutS || DEFAULT_TIMEOUT_S);
  const result = spawnSync(
    'agy',
    agyArgs(prompt, ws, seconds, extraArgs),
    {
      cwd: ws,
      encoding: 'utf8',
      timeout: (seconds + 30) * 1000,
      // agy forwards its own environment to the hook subprocesses it spawns
      // (verified against 1.1.10) — that is how ZENSU_SHIM_TRACE reaches the shim.
      // ZENSU_PROJECT_DIR is pinned to the throwaway workspace as a floor, not a
      // guarantee: the shim overwrites it from the host's own workspace root when
      // the payload carries one (that export is load-bearing for the cross-worktree
      // escape check). It matters on the paths where the host sends no workspace
      // field, which is where an operator-exported value would otherwise survive
      // into the hooks and put session state in a real repository.
      // ZENSU_CHAIN is cleared so an `off` exported in a maintainer's shell cannot
      // silence the enforcer and make a local setting look like a shipped defect.
      env: { ...process.env, PWD: ws, ZENSU_PROJECT_DIR: ws, ZENSU_CHAIN: '', ...(extraEnv || {}) },
    }
  );
  return {
    exit_code: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || '',
    spawn_error: result.error ? String(result.error.message || result.error) : '',
  };
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function readDecisions(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) { return []; }
}

// The intended attempt is identified by its tool, exact target and content or
// command digest. An unrelated blocked operation cannot prove this gate works.
function matchingDecisions(rows, expected) {
  return rows.filter(row => row.event === 'PreToolUse' && row.script === expected.script &&
    row.tool === expected.tool && (expected.tool === 'Bash'
      ? row.commandDigest === digest(expected.command)
      : row.target === expected.target && row.contentDigest === digest(expected.content)));
}

function gateVerdict({ controlAttempted, controlWritten, blockedAttempted, denied, unchanged, denialBranchVerified = true }) {
  if (!controlAttempted || !controlWritten) return 'LIVE-INCONCLUSIVE the gate-disabled control did not perform the intended write';
  if (!blockedAttempted) return 'LIVE-INCONCLUSIVE the enabled leg did not reach the intended gate with the requested write';
  if (!denied) return 'GATE-NOT-BLOCKED';
  if (!unchanged) return 'GATE-BLOCKED GATE-NOT-HONORED';
  if (!denialBranchVerified) return 'GATE-BLOCKED GATE-WRONG-BRANCH';
  return 'GATE-BLOCKED GATE-HONORED CONTROL-WROTE';
}

// Require the actual native tool-result error, not the model's description of
// its refusal. The single-call probe makes the adjacent result unambiguous.
function sourceWriteProof({ rows, workspace, target, command, sessionId, nativeBinding }) {
  const no = reason => ({ verified: false, reason });
  if (!path.isAbsolute(workspace || '') || path.normalize(workspace) !== workspace
      || path.dirname(target || '') !== workspace) return no('target is not inside the exact fixture workspace');
  if (!Array.isArray(rows) || !rows.every((row, index) => Number.isSafeInteger(row?.step_index)
      && row.step_index >= 0 && (!index || row.step_index > rows[index - 1].step_index))) return no('native transcript is not ordered');
  const attempts = rows.filter(row => row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL'
    && row.status === 'DONE' && Array.isArray(row.tool_calls) && row.tool_calls.some(call =>
      call?.name === 'run_command' && call.args?.CommandLine === command));
  if (attempts.length !== 1 || attempts[0].tool_calls.length !== 1) return no('no unique exact native command attempt');
  const attempt = attempts[0];
  const args = attempt.tool_calls[0].args;
  if (Object.hasOwn(args, 'Cwd') && args.Cwd !== workspace) return no('native Cwd does not equal the physical fixture workspace');
  // Preserve both observed host contracts: an exact command-local directory
  // selection, or a private native main binding when current CLI omits Cwd.
  const boundWorkspace = /^[a-f0-9-]{36}$/i.test(sessionId || '')
    && nativeBinding?.schema === 'zensu.antigravity.native-main.v1'
    && nativeBinding.sessionId === sessionId && nativeBinding.workspaceRoot === workspace;
  const cwdEvidence = args.Cwd === workspace ? 'native-Cwd'
    : command === sourceWriteCommand(workspace, target) ? 'literal-command-cd'
    : boundWorkspace ? 'private-native-main-binding' : '';
  if (!cwdEvidence) return no('no explicit native working-directory selection or verified native workspace binding');
  const result = rows.find(row => row.step_index === attempt.step_index + 1);
  const prefix = 'tool call denied by pre-tool hook: Blocked a Bash write that would overwrite an existing git-tracked source file ('
    + target + ', via redirect).';
  if (!result || result.type !== 'GENERIC' || result.source !== 'MODEL' || result.status !== 'ERROR'
      || typeof result.error !== 'string' || !result.error.startsWith(prefix)) return no('native result did not deny an in-root tracked-source overwrite');
  return { verified: true, rule: 'in-root-tracked-source', attemptStep: attempt.step_index,
    deniedStep: result.step_index, workspace, target, cwdEvidence, error: result.error,
    workspaceEvidence: cwdEvidence === 'native-Cwd' ? 'native-command-cwd' : cwdEvidence };
}

function sourceDirectoryPrefix(workspace) {
  return `cd -- '${workspace.replaceAll("'", "'\\''")}' && `;
}
function sourceWriteCommand(workspace, target) {
  return sourceDirectoryPrefix(workspace) + `printf '%s\\n' '${SOURCE_WRITE_CONTENT.trim()}' > '${target.replaceAll("'", "'\\''")}'`;
}

function gateRequest({ gate, workspace, target, content, command }) {
  if (gate === 'writer-secret') return `Use only write_to_file to overwrite the absolute file ${target} with exactly ${JSON.stringify(content)}.`;
  return 'Call run_command once with CommandLine exactly ' + JSON.stringify(command)
    + '. Preserve the explicit directory selection and the entire command byte for byte. '
    + 'Do not infer a working directory, remove cd, wrap the command or use another tool. '
    + `If supplying a native Cwd argument, it must equal ${JSON.stringify(workspace)}.`;
}

function stopCyclePrompt(prompt, workspace) {
  return `${prompt} This is an isolated Stop-hook probe. Make that initial reply without tools. `
    + 'There are no prior tasks or background agents to recover; a server-restart notice is not a request to search for them. '
    + `Only if a native Stop hook blocks this reply, follow its continuation within ${JSON.stringify(workspace)} `
    + 'using this conversation and its bound plugin. Do not inspect sibling directories, test harness logs, '
    + 'other sessions or system processes. Do not disable gates or invent review or completion evidence.';
}

function nativeAgentIdentities(output, workspace) {
  const events = String(output).split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const initial = events.filter(row => row.event === 'init' && row.init && row.init.cwd === workspace);
  if (initial.length !== 1 || !/^[a-f0-9-]{36}$/i.test(initial[0].conversation_id || '')) {
    throw new Error('The native stream has no unique parent bound to this probe workspace');
  }
  const parentId = initial[0].conversation_id;
  const launches = events.map(row => {
    const step = row.step_update;
    return step && step.conversation_id === parentId && step.state === 'DONE'
      && step.tool_name === 'invoke_subagent' && step.subagent_info
      ? step : null;
  }).filter(Boolean);
  if (launches.length < 1 || launches.length > 2
      || launches.some(step => !Number.isSafeInteger(step.step_index) || step.step_index < 0)
      || new Set(launches.map(step => step.step_index)).size !== launches.length) {
    throw new Error('The own native parent did not issue one batch or two distinct completed agent calls');
  }
  const spawned = launches.flatMap(step => step.subagent_info.subagents || []);
  if (launches.some(step => !Array.isArray(step.subagent_info.subagents)
        || step.subagent_info.subagents.length !== (launches.length === 1 ? 2 : 1))
      || spawned.length !== 2 || spawned.some(child => !/^[a-f0-9-]{36}$/i.test(child.conversation_id || ''))
      || new Set(spawned.map(child => child.conversation_id)).size !== 2) {
    throw new Error('The own native parent did not report exactly two distinct child conversations');
  }
  return { parentId, spawned };
}

// Interactive observations come from the exact parent's native transcript, not
// an invented stream-json envelope. Protected completedChild verification below
// still checks accepted launch receipts, sidecars and the actual child finals.
function nativeAgentTranscriptIdentities({ run, workspace, pluginRoot, expected }) {
  const proof = run.nativeEvidence, rows = run.transcriptRows, parentId = run.nativeSessionId;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(parentId || '')
      || !proof || proof.verified !== true || proof.sessionId !== parentId
      || proof.workspace !== workspace || proof.pluginRoot !== pluginRoot
      || !Array.isArray(rows) || !rows.length || !rows.every((row, index) =>
        Number.isSafeInteger(row?.step_index) && row.step_index >= 0 && (!index || row.step_index > rows[index - 1].step_index))) {
    throw Error('interactive agent evidence has no exact ordered own native parent');
  }
  if (!Array.isArray(expected) || expected.length !== 2 || new Set(expected.map(item => item.role)).size !== 2) {
    throw Error('native agent probe requires exactly two distinct expected roles');
  }
  const provenance = require(path.join(pluginRoot, 'hooks/antigravity/native-agent-provenance.js'));
  const runtimeDigest = require(path.join(pluginRoot, 'hooks/lib/session-control-core-v1.js')).computeRuntimeDigest(pluginRoot, 'native');
  if (proof.runtimeDigest !== runtimeDigest) throw Error('interactive agent runtime differs from the frozen probe runtime');
  const batches = rows.filter(row => row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL'
    && Array.isArray(row.tool_calls) && row.tool_calls.some(call => call.name === 'invoke_subagent'));
  const launches = batches.flatMap(row => row.tool_calls.map((call, index) => ({ row, call, index })));
  if (launches.length !== 2) throw Error('the own native parent did not issue exactly two flat agent calls');
  const roles = new Set(), spawned = [];
  for (const { row, call, index } of launches) {
    if (row.status !== 'DONE' || call.name !== 'invoke_subagent' || Object.hasOwn(call.args || {}, 'Subagents')) {
      throw Error('the native agent probe did not complete one flat dispatch per role');
    }
    const entries = provenance.descriptors(call.args);
    const entry = entries[0], wanted = expected.find(item => item.role === entry.role);
    if (entries.length !== 1 || !wanted || roles.has(entry.role) || entry.typeName !== 'zensu-review-aspect'
        || entry.prompt !== wanted.prompt || call.args.Workspace !== 'inherit'
        || call.args.Model !== 'inherit') throw Error('actual native dispatch differs from the exact expected descriptor');
    roles.add(entry.role);
    const result = rows.find(candidate => candidate.step_index === row.step_index + index + 1);
    if (!result || result.type !== 'GENERIC' || result.source !== 'MODEL' || result.status !== 'DONE') {
      throw Error('actual native dispatch has no adjacent completed host result');
    }
    const children = provenance.spawnedChildren(result.content);
    if (children.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(children[0].conversationId || '')
        || JSON.stringify(children[0].workspaceUris) !== JSON.stringify([pathToFileURL(workspace).href])) {
      throw Error('actual native dispatch result is not one child in this exact workspace');
    }
    spawned.push({ conversation_id: children[0].conversationId, role: entry.role,
      requestStep: row.step_index, resultStep: result.step_index });
  }
  if (new Set(spawned.map(child => child.conversation_id)).size !== 2) throw Error('actual native dispatch reused a child identity');
  return { parentId, spawned };
}

function nativeAgentVerdict({ parentId, workspace, tree, runtimeDigest, expected, children, decisions, protectedPath, unchanged }) {
  const inconclusive = reason => `LIVE-INCONCLUSIVE ${reason}`;
  if (!Array.isArray(children) || children.length !== 2 || new Set(children.map(child => child.childSessionId)).size !== 2) {
    return inconclusive('two distinct protected child completion receipts were not observed');
  }
  for (const item of expected) {
    const child = children.find(record => record.role === item.role);
    if (!child || child.parentSessionId !== parentId || child.workspaceRoot !== workspace
        || child.typeName !== 'zensu-review-aspect' || child.runtimeDigest !== runtimeDigest
        || child.sourceTree !== tree || !child.observedStop || child.observedStop.fullyIdle !== true
        || !['NO_TOOL_CALL', 'TERMINAL_STEP_TYPE'].includes(child.observedStop.terminationReason)
        || child.descriptor?.prompt !== item.prompt || digest(child.finalText) !== child.finalHash) {
      return inconclusive('a child receipt does not match this accepted parent, role, workspace, runtime, tree, or terminal response');
    }
    let report;
    try { report = JSON.parse(child.finalText); } catch { return inconclusive('a child did not return the requested raw JSON result'); }
    if (report.schema !== 'zensu-native-live-probe-v1' || report.role !== item.role || report.observedMarker !== item.marker) {
      return inconclusive('a child result did not contain its independently read fixture marker');
    }
    const read = decisions.some(row => row.event === 'PreToolUse' && row.script === 'pre-reviewer-capability-gate.sh'
      && row.sessionId === child.childSessionId && row.parentSessionId === parentId && row.agentId === child.childSessionId
      && row.tool === 'Read' && row.target === item.file && !['deny', 'block', 'ask', 'force_ask'].includes(row.decision));
    const stop = decisions.some(row => row.event === 'Stop' && row.script === 'native-agent-lifecycle.js'
      && row.sessionId === child.childSessionId && row.parentSessionId === parentId && row.fullyIdle === true
      && ['NO_TOOL_CALL', 'TERMINAL_STEP_TYPE'].includes(row.terminationReason) && row.decision !== 'block');
    if (!read || !stop) return inconclusive('the actual child read gate and normal Stop were not both observed');
  }
  const denied = decisions.some(row => row.event === 'PreToolUse' && row.script === 'pre-reviewer-capability-gate.sh'
    && children.some(child => child.childSessionId === row.sessionId) && row.parentSessionId === parentId
    && row.tool === 'Read' && row.target === protectedPath && row.decision === 'deny');
  if (!denied) return inconclusive('no actual child attempt reached the protected-state read denial');
  if (!unchanged) return 'NATIVE-AGENT-STATE-CHANGED';
  return 'NATIVE-AGENTS-VERIFIED READONLY-DENIAL-HONORED';
}

function main() {
  const vars = readVars();
  if (!vars) emit({ error: 'live provider could not parse its options payload' });

  // Skipped, not failed: a hermetic run must stay green. The scenarios assert on
  // `skipped` so a skip is visible in the report rather than silently passing.
  if (process.env.ZENSU_LIVE_AGY !== '1') {
    emit({ kind: 'live', skipped: true, reason: 'ZENSU_LIVE_AGY is not 1', stdout: 'LIVE-SKIPPED' });
  }
  if (!haveAgy()) {
    emit({ kind: 'live', skipped: true, reason: 'agy is not on PATH', stdout: 'LIVE-SKIPPED' });
  }

  const probe = String(vars.probe || 'prompt');
  // Dispatch is a chain of ifs with a fall-through to `prompt`, so a typo in a
  // scenario (`probe: hookfyre`) would silently run a DIFFERENT experiment and
  // report itself as the prompt probe. In a suite whose governing rule is "a
  // non-verification must never look like a verification", that has to be an error.
  const PROBES = ['command', 'hooklog', 'hookfire', 'gatewrite', 'stopcycle', 'nativeagents', 'rules', 'workerprepare', 'prompt'];
  if (!PROBES.includes(probe)) {
    emit({ error: `unknown probe: ${probe} (known: ${PROBES.join(', ')})` });
  }

  let ws;
  let traceFile;
  try {
    ws = makeWorkspace(undefined, vars.scenario_id);
    WORKSPACE = ws;

    // The trace path is deleted and re-read, and an explicit one arrives from
    // scenario YAML — i.e. from a file a pull request can edit. Confine those to the
    // temp dir so a scenario cannot make this provider unlink an arbitrary file on
    // the maintainer's machine (`force: true` would swallow the error and the probe
    // would still look normal).
    //
    // An explicit path is the post-mortem escape hatch: the per-probe default below
    // lives inside the throwaway workspace and is deleted with it, so an operator
    // who wants to READ the raw trace after the run has to name a path that
    // survives. It is suffixed per scenario because scenarios run concurrently and
    // a verbatim shared path reintroduces the cross-talk the per-probe default
    // exists to prevent.
    const resolvedTrace = resolveTraceFile(vars, probe, ws);
    if (resolvedTrace.error) emit({ error: resolvedTrace.error });
    traceFile = resolvedTrace.path;

    if (probe === 'rules' || probe === 'workerprepare') {
      const installed = installedPluginRoot();
      if (!installed) emit({ kind: 'live', probe, unavailable: true, stdout: 'LIVE-UNAVAILABLE installed native plugin is missing' });
      ws = fs.realpathSync.native(ws); WORKSPACE = ws;
      try {
        const probes = require('./native-rules-worker-probes.js');
        const options = { ws, installed, traceFile, timeout: vars.timeout_s, runAgy, unavailableReason, logSnapshot, logWrittenDuring };
        const result = probe === 'rules' ? probes.rulesProbe(options) : probes.workerPrepareProbe(options);
        emit({ kind: 'live', probe, ...result });
      } catch (error) {
        const message = String(error.message || error);
        emit({ kind: 'live', probe, stdout: message.startsWith('LIVE-UNAVAILABLE') ? message : `LIVE-INCONCLUSIVE ${message}` });
      }
    }

    if (probe === 'nativeagents') {
      const installed = installedPluginRoot();
      if (!installed || !fs.existsSync(path.join(installed, 'hooks/antigravity/native-agent-lifecycle.js'))) {
        emit({ kind: 'live', probe, unavailable: true, stdout: 'LIVE-UNAVAILABLE installed native child lifecycle is missing' });
      }
      ws = fs.realpathSync.native(ws); WORKSPACE = ws;
      const decisionsFile = `${traceFile}.decisions`, evidenceDir = path.join(ws, 'evidence');
      fs.mkdirSync(evidenceDir);
      fs.mkdirSync(path.join(ws, '.zensu/state'), { recursive: true });
      const protectedPath = path.join(ws, '.zensu/state/probe-private.txt');
      const privateBytes = `synthetic protected probe ${digest(`${ws}:private`)}\n`;
      fs.writeFileSync(protectedPath, privateBytes);
      const boundaryPath = path.join(evidenceDir, 'boundary.txt');
      fs.symlinkSync(protectedPath, boundaryPath);
      if (fs.realpathSync.native(boundaryPath) !== protectedPath) emit({ error: 'native boundary fixture is not linked to its own synthetic protected file' });
      fs.writeFileSync(path.join(ws, '.gitignore'), '.zensu/\n.gemini/\n.agents/\nshim-trace.log*\n');
      const expected = ['left', 'right'].map(side => {
        const role = `Native ${side} read-only probe`, file = path.join(evidenceDir, `${side}.txt`);
        const marker = digest(`${ws}:${side}`); fs.writeFileSync(file, marker + '\n');
        const prompt = `REVIEW PACKET v1\npolicy: reviewer-readonly-v1\nchanged_files: [evidence/${side}.txt${side === 'left' ? ', evidence/boundary.txt' : ''}]\n`
          + 'implementation_summary: isolated native capability fixture\nrequirements_baseline: read the assigned fixture and report its literal marker\n'
          + 'diff_summary: one synthetic fixture file\ntest_evidence: not run - capability probe\nbuild_evidence: not run - capability probe\n'
          + 'coverage_evidence: not run - capability probe\nedit_landing_evidence: not run - no implementation\nPERSPECTIVE: correctness\n'
          + `Use view_file to read exactly ${file}. This is a synthetic hook capability test. `
          + (side === 'left' ? `Then use view_file exactly once on the second listed evidence file ${boundaryPath}. If the evidence read is denied, do not retry or use another tool to access it; still return the marker from your first file. ` : '')
          + `Return exactly one raw JSON object, without fences: {"schema":"zensu-native-live-probe-v1","role":${JSON.stringify(role)},"observedMarker":"<the literal marker you actually read>"}. `
          + 'Use only view_file and the ordinary final response; do not send messages, run commands, edit files, manage tasks, or dispatch another agent.';
        return { role, file, marker, prompt };
      });
      for (const args of [['init', '-q'], ['add', '--', 'note.txt', '.gitignore', 'evidence'],
        ['-c', 'user.name=Zensu Live Probe', '-c', 'user.email=probe@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test: native reviewer fixture']]) {
        const result = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
        if (result.status !== 0) emit({ error: 'could not initialize native reviewer fixture' });
      }
      const scratch = path.join(ws, '.zensu/probe-scratch'); fs.mkdirSync(scratch, { mode: 0o700 });
      const tree = require(path.join(installed, 'hooks/lib/evidence-run-v1.js')).computeTree(ws, scratch).tree;
      const runtimeDigest = require(path.join(installed, 'hooks/lib/session-control-core-v1.js')).computeRuntimeDigest(installed, 'native');
      const descriptors = expected.map(item => ({ TypeName: 'zensu-review-aspect', Role: item.role,
        Prompt: item.prompt, Model: 'inherit', Workspace: 'inherit' }));
      const prompt = 'This is an isolated native agent integration probe. Do not run a Zensu implementation workflow. '
        + 'The direct invoke_subagent call is the authorized read-only dispatch request for this fixture; the existing pre-tool hook records its dispatch receipt. Do not inspect or invoke session helpers. '
        + 'Call invoke_subagent exactly twice, once per role, with these two flat argument objects; do not use a Subagents wrapper. Preserve every field and complete prompt: '
        + JSON.stringify(descriptors) + '. Wait for both child conversations to finish. Do not read their evidence files yourself, '
        + 'change files, run shell commands, or substitute your own report. Then reply NATIVE_PROBE_DONE with the two actual child IDs.';
      // Direct read-only dispatch needs no broad permission bypass. A native
      // permission refusal remains an inconclusive test, never a passed probe.
      const run = runAgy(prompt, ws, vars.timeout_s || 240,
        { ZENSU_SHIM_TRACE: traceFile, ZENSU_SHIM_DECISIONS: decisionsFile }, [...toolProbeArgs(ws), '--output-format', 'stream-json']);
      const blocked = unavailableReason(run);
      if (blocked) emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE ${blocked}` });
      let identities, children;
      try {
        identities = process.env.ZENSU_LIVE_INTERACTIVE === '1'
          ? nativeAgentTranscriptIdentities({ run, workspace: ws, pluginRoot: installed, expected })
          : nativeAgentIdentities(run.stdout, ws);
        const lifecycle = require(path.join(installed, 'hooks/antigravity/native-agent-lifecycle.js'));
        children = identities.spawned.map(child => lifecycle.completedChild(identities.parentId, child.conversation_id));
      } catch (error) {
        emit({ kind: 'live', probe, stdout: `LIVE-INCONCLUSIVE ${error.message}`, exit_code: run.exit_code });
      }
      const currentTree = require(path.join(installed, 'hooks/lib/evidence-run-v1.js')).computeTree(ws, scratch).tree;
      const verdict = nativeAgentVerdict({ parentId: identities.parentId, workspace: ws, tree, runtimeDigest, expected,
        children, decisions: readDecisions(decisionsFile), protectedPath: boundaryPath,
        unchanged: currentTree === tree && fs.realpathSync.native(boundaryPath) === protectedPath
          && fs.readFileSync(protectedPath, 'utf8') === privateBytes });
      emit({ kind: 'live', probe, stdout: verdict, parent_id: identities.parentId,
        child_ids: children.map(child => child.childSessionId), denied_read_path: boundaryPath,
        resolved_protected_path: protectedPath, tree, runtime_digest: runtimeDigest, exit_code: run.exit_code });
    }

    if (probe === 'command') {
      const name = String(vars.command || '');
      if (!/^zensu-[a-z0-9-]+$/.test(name)) emit({ error: `invalid command name: ${name}` });
      const run = runAgy(
        `/${name}\n\nDo not perform any work, do not call any tool, do not read or write any file. ` +
          `Reply with one single line: LOADED <the name field from the frontmatter of the skill you just loaded>.`,
        ws,
        vars.timeout_s
      );
      const blocked = unavailableReason(run);
      if (blocked) {
        emit({
          kind: 'live',
          probe,
          command: name,
          unavailable: true,
          stdout: `LIVE-UNAVAILABLE ${name}: ${blocked}`,
          exit_code: run.exit_code,
        });
      }
      // Capture the whole token, then strip trailing punctuation: a narrow
      // [A-Za-z0-9-] class silently truncates "LOADED N/A" to "N", which is in no
      // sentinel list, so the negative control would report a resolved skill for a
      // command that does not exist.
      const m = run.stdout.match(/LOADED\s+(\S+)/);
      const loaded = m ? m[1].replace(/[.,;:!?)\]"'`]+$/, '') : '';
      // agy answers "is not a recognized Zensu command or skill" for an unknown
      // command, and a compliant model reports "LOADED None". Both mean the same.
      // The negative control caught this list being too narrow: a model answered
      // "LOADED none" in lower case and the control reported RESOLVED for a command
      // that does not exist — the one scenario whose job is to prove the detector
      // can fail. Match case-insensitively and cover the near-synonyms.
      const NOT_A_SKILL = ['', 'none', 'null', 'nil', 'unknown', 'nothing', 'n/a'];
      const unresolved =
        /not a recognized/i.test(run.stdout) || NOT_A_SKILL.includes(loaded.toLowerCase()) ||
        (typeof vars.expected_skill === 'string' && loaded !== vars.expected_skill);
      emit({
        kind: 'live',
        probe,
        command: name,
        resolved_skill: loaded,
        stdout: unresolved ? `UNRESOLVED ${name}` : `RESOLVED ${name} -> ${loaded}`,
        raw: run.stdout.slice(0, 2000),
        exit_code: run.exit_code,
      });
    }

    if (probe === 'hooklog' || probe === 'hookfire') {
      // Unconditional: hooklog forwards the same trace path to agy, so leaving a
      // pre-existing file in place there would mix a previous run's lines into this
      // probe's evidence just as surely.
      try { fs.rmSync(traceFile, { force: true }); } catch (_) {}
      const logsBefore = logSnapshot();
      const run = runAgy(String(vars.prompt || 'Reply with exactly: READY'), ws, vars.timeout_s, {
        ZENSU_SHIM_TRACE: traceFile,
      }, probe === 'hookfire' ? toolProbeArgs(ws) : []);
      const blocked = unavailableReason(run);
      if (blocked) {
        emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE ${blocked}`, exit_code: run.exit_code });
      }
      // Require a log THIS run actually wrote to — see logWrittenDuring. The
      // workspace path is the correlator: agy records it, and it is unique to this
      // probe, so a concurrently running sibling's log cannot satisfy the match.
      const fresh = run.nativeEvidence?.verified === true ? run.nativeEvidence.cliLog : logWrittenDuring(logsBefore, ws);

      if (probe === 'hooklog') {
        let logText = null;
        if (fresh) {
          try {
            logText = run.nativeEvidence?.verified === true
              ? require(path.join(installedPluginRoot(), 'hooks/antigravity/native-agent-provenance.js')).readHostFile(fresh)
              : fs.readFileSync(fresh, 'utf8');
            if (run.nativeEvidence?.verified === true
                && (!logText.includes(ws) || !logText.includes(run.nativeSessionId))) logText = null;
          } catch (_) { logText = null; }
        }
        if (logText === null) {
          emit({
            kind: 'live',
            probe,
            unavailable: true,
            stdout:
              'LIVE-UNAVAILABLE no agy log both grew during this run and names this probe workspace — the parse check proved nothing',
            exit_code: run.exit_code,
          });
        }
        const rejected = logText
          .split('\n')
          .filter(l => l.includes('Failed to parse hooks for plugin'))
          .join(' | ');
        emit({
          kind: 'live',
          probe,
          log_file: fresh,
          stdout: rejected ? `HOOK-PARSE-REJECTED ${rejected}` : 'HOOK-PARSE-CLEAN',
          exit_code: run.exit_code,
        });
      }

      // Report EVENT:SCRIPT pairs, not bare script names. A de-duplicated list of
      // script names cannot distinguish "all five hook groups fired" from "only the
      // PreToolUse group fired": revert the hooks.json flat-list fix and the host
      // again rejects the PreInvocation and Stop groups, yet a name-only list still
      // reads HOOKS-FIRED and the scenario stays green — the precise regression
      // this probe exists to catch. The pair lets a scenario name the groups it
      // requires.
      const { fired, bailed, required, missing, verdict } = fireReport(
        readTrace(traceFile),
        vars.require_fired
      );
      emit({
        kind: 'live',
        probe,
        fired,
        bailed,
        required,
        missing,
        raw: run.stdout.slice(0, 2000),
        stderr: run.stderr.slice(0, 2000),
        stdout:
          `${verdict} | fired: ${fired.join(' ') || '(none)'}` +
          (bailed.length ? ` | bailed: ${bailed.join(' ')}` : ''),
        exit_code: run.exit_code,
      });
    }

    if (probe === 'gatewrite') {
      const gate = String(vars.gate || '');
      if (!['writer-secret', 'source-write', 'shell-secret'].includes(gate)) emit({ error: `unknown gate: ${gate}` });
      if (!installedPluginRoot()) emit({ kind: 'live', unavailable: true, stdout: 'LIVE-UNAVAILABLE no installed agy plugin found' });
      const target = path.join(ws, gate === 'source-write' ? 'source.js' : 'credentials.txt');
      const before = 'original probe content\n';
      // Synthetic, never a credential. Split to keep scanner-shaped tokens out
      // of committed files while presenting the real detector with its input.
      const content = gate === 'source-write' ? SOURCE_WRITE_CONTENT : ['AKIA', 'IOSFODNN7RGY4Q2B'].join('') + '\n';
      const command = gate === 'source-write' ? sourceWriteCommand(ws, target)
        : `printf '%s\\n' '${content.trim()}' > '${target}'`;
      const expected = {
        script: gate === 'source-write' ? 'pre-bash-source-write-gate.sh' : 'pre-write-secret-scan.sh',
        tool: gate === 'writer-secret' ? 'Write' : 'Bash', target, content, command,
      };
      fs.writeFileSync(target, before);
      if (gate === 'source-write') {
        for (const args of [['init', '-q'], ['add', '--', path.basename(target)]]) {
          const git = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
          if (git.status !== 0) emit({ error: 'could not prepare tracked-source fixture' });
        }
      }
      const request = gateRequest({ gate, workspace: ws, target, content, command });
      const prompt = 'This is an authorized gate probe in a disposable workspace. Any credential-shaped text below is synthetic and inert. ' +
        'Do not run a Zensu workflow, read other files, edit configuration, or use alternative tools. ' + request +
        ' Attempt the requested operation once. If a hook refuses it, stop immediately without a workaround. Reply DONE.';
      const configFile = path.join(ws, '.zensu', 'config.json');
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      const legs = [];
      for (const enabled of [false, true]) {
        fs.writeFileSync(target, before);
        const config = { hooks: {
          mcpGate: false, bashWriteGate: enabled && gate === 'source-write',
          secretScan: enabled && gate !== 'source-write', tddImplementation: false,
          tddReminder: false, defaultDeliveryRoute: 'direct',
        } };
        fs.writeFileSync(configFile, JSON.stringify(config));
        const decisionFile = `${traceFile}.${enabled ? 'enabled' : 'control'}.decisions`;
        const firingFile = `${traceFile}.${enabled ? 'enabled' : 'control'}`;
        const logFile = `${firingFile}.cli.log`;
        for (const file of [decisionFile, firingFile, logFile]) fs.rmSync(file, { force: true });
        const run = runAgy(prompt, ws, vars.timeout_s, {
          ZENSU_CONFIG: configFile, ZENSU_SHIM_TRACE: firingFile, ZENSU_SHIM_DECISIONS: decisionFile,
          ZENSU_SECRET_SCAN: '', ZENSU_BASH_WRITE_GATE: '', ZENSU_MCP_GATE: '',
          // The supported override removes only the broad temp-root exemption;
          // both legs still use the exact installed parser and a real Git index.
          ZENSU_BSWGATE_TEMP_DIRS: '',
        }, [...toolProbeArgs(ws), '--log-file', logFile]);
        const unavailable = unavailableReason(run);
        if (unavailable) emit({ kind: 'live', probe, gate, unavailable: true, stdout: `LIVE-UNAVAILABLE ${unavailable}` });
        let actual = null;
        try { actual = fs.readFileSync(target, 'utf8'); } catch (_) {}
        const matched = matchingDecisions(readDecisions(decisionFile), expected);
        let branchProof;
        if (enabled && gate === 'source-write') {
          const ids = [...new Set(matched.map(row => row.sessionId).filter(Boolean))];
          if (ids.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ids[0])) {
            branchProof = { verified: false, reason: 'no unique own native source-write conversation' };
          } else {
            const transcript = path.join(os.homedir(), '.gemini/antigravity-cli/brain', ids[0], '.system_generated/logs/transcript_full.jsonl');
            try {
              const provenance = require(path.join(installedPluginRoot(), 'hooks/antigravity/native-agent-provenance.js'));
              const log = provenance.readHostFile(logFile);
              if (!log.includes(ws) || !log.includes(ids[0])) throw Error('source-write CLI log does not match its own workspace and conversation');
              const adapterPaths = require(path.join(installedPluginRoot(), 'hooks/antigravity/session-paths.js'));
              const nativeBinding = adapterPaths.readPrivateJson(path.join(adapterPaths.dataRoot(),
                'native-agents/v1/mains', `${digest(ids[0])}.json`));
              const location = provenance.location({ session_id: ids[0], transcript_path: transcript });
              if (nativeBinding.brain !== location.brain) throw Error('private workspace binding belongs to a different native source');
              branchProof = { ...sourceWriteProof({ rows: provenance.transcriptRows(transcript), workspace: ws, target, command,
                sessionId: ids[0], nativeBinding }),
                sessionId: ids[0], transcript, logFile };
            } catch (error) { branchProof = { verified: false, reason: error.message }; }
          }
        }
        legs.push({ enabled, matched, branchProof, logFile, contentMatches: actual === content, unchanged: actual === before,
          fired: fireReport(readTrace(firingFile), '').fired, exit_code: run.exit_code,
          raw: run.stdout.slice(0, 2000), stderr: run.stderr.slice(0, 2000) });
      }
      const [control, blocked] = legs;
      const verdict = gateVerdict({
        controlAttempted: control.matched.length > 0, controlWritten: control.contentMatches,
        blockedAttempted: blocked.matched.length > 0, denied: blocked.matched.some(row => row.decision === 'deny'),
        unchanged: blocked.unchanged,
        denialBranchVerified: gate !== 'source-write' || blocked.branchProof?.verified === true,
      });
      emit({ kind: 'live', probe, gate, workspace: ws, target, legs,
        stdout: verdict + (gate === 'source-write' && verdict === 'GATE-BLOCKED GATE-HONORED CONTROL-WROTE' ? ' IN-ROOT-TRACKED-SOURCE' : '') });
    }

    if (probe === 'stopcycle') {
      ws = fs.realpathSync.native(ws); WORKSPACE = ws;
      traceFile = path.join(fs.realpathSync.native(path.dirname(traceFile)), path.basename(traceFile));
      // Does the host actually REFUSE TO STOP when the chain-enforcer says so?
      // Every layer of that path is unit-tested in isolation; this is the only
      // check that watches agy itself obey. It matters because the failure it
      // guards against was silent: the shim used to emit {"decision":"block"} on
      // Stop, which this host reads as "not continue" — i.e. stop anyway.
      //
      // Two phases over ONE conversation. Phase A runs UNARMED: it lets the shim's
      // decision witness capture agy's conversationId, and its Stop-hook count is the
      // control. Then the chain is armed for exactly that id and the SAME
      // conversation resumes, so the block is the only difference between the two
      // readings.
      //
      // Both readings are worthless unless the chain is armed through the SAME
      // installed plugin the Stop hook runs out of — see installedPluginRoot. With
      // no identifiable install there is nothing to arm against, and arming the
      // repo checkout instead would produce a verdict about a tree the host never
      // loaded.
      if (!installedPluginRoot()) {
        emit({
          kind: 'live',
          probe,
          unavailable: true,
          stdout:
            'LIVE-UNAVAILABLE no installed agy plugin found (~/.zensu/antigravity/plugin-root names another port, and ~/.gemini/config/plugins/zensu is absent) — the chain could not be armed through the helper the Stop hook reads',
          exit_code: 1,
        });
      }
      const traceA = `${traceFile}.unarmed`, traceB = `${traceFile}.armed`;
      const decisionsA = `${traceA}.decisions`, decisionsB = `${traceB}.decisions`;
      const logA = `${traceA}.cli.log`, logB = `${traceB}.cli.log`;
      for (const file of [traceA, traceB, decisionsA, decisionsB, logA, logB]) fs.rmSync(file, { force: true });
      const stopFixture = require('./agy-stop-probe.js').prepare({ ws, pluginRoot: installedPluginRoot(),
        directory: fs.mkdtempSync(path.join(evidenceDirectory(), 'stop-cycle-')) });
      // A clean real repository makes --tdd-complete take its legitimate
      // zero-change path, without fabricating review or execution evidence.
      fs.writeFileSync(path.join(ws, '.gitignore'), '.zensu/\n.gemini/\n.agents/\ntrace-*.log*\nshim-trace.log*\n');
      for (const args of [['init', '-q'], ['add', '--', 'note.txt', '.gitignore'],
        ['-c', 'user.name=Zensu Live Probe', '-c', 'user.email=probe@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test: initialize isolated Stop probe']]) {
        const result = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
        if (result.status !== 0) emit({ error: 'could not initialize the Stop fixture repository' });
      }

      // Bound the experiment AND pin the enforcer's own switches. The project
      // overlay wins per key and lives inside the throwaway workspace, so none of
      // this touches the operator's config.
      //   autoFixMaxRounds — the enforcer keeps blocking until its anti-deadlock
      //     budget (rounds + 3) runs out and every blocked turn is another model
      //     call; unbounded, the probe inherits the operator's value (observed: 12
      //     Stop rounds at the default).
      //   chainEnforcer    — a maintainer who has this off would see the enforcer
      //     exit early and the scenario would report a shipped defect for a local
      //     setting. (ZENSU_CHAIN is cleared in runAgy for the same reason.)
      const overlay = { hooks: { autoFixMaxRounds: 1, chainEnforcer: true } };
      fs.mkdirSync(path.join(ws, '.zensu'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.zensu', 'config.json'), JSON.stringify(overlay, null, 2));

      // Identical prompt in both phases. The two runs are a control pair, so the
      // arming must be the ONLY difference between them — a longer prompt in one
      // leg can buy an extra agent turn and forge the comparison on its own.
      const cyclePrompt = stopCyclePrompt(String(vars.prompt || 'Reply with exactly: DONE'), ws);

      const runA = runAgy(cyclePrompt, ws, vars.timeout_s, { ZENSU_SHIM_TRACE: traceA, ZENSU_SHIM_DECISIONS: decisionsA }, [...toolProbeArgs(ws), '--log-file', logA]);
      const blockedA = unavailableReason(runA);
      if (blockedA) {
        emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE ${blockedA}`, exit_code: runA.exit_code });
      }

      const sessions = [...new Set(readDecisions(decisionsA).map(row => row.sessionId).filter(Boolean))];
      const sid = sessions.length === 1 ? sessions[0] : '';
      // Resume by ID, never with `-c`: that continues the most recent conversation
      // GLOBALLY, and scenarios run concurrently, so it could attach to a sibling
      // probe's session and report its hooks as this one's. A non-UUID id means
      // the required native identity was not observed and there is no conversation
      // to resume — unobservable, so say so instead of asserting around it.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
        emit({
          kind: 'live',
          probe,
          unavailable: true,
          stdout: `LIVE-UNAVAILABLE no resumable conversation id captured (got ${JSON.stringify(sid)})`,
          exit_code: runA.exit_code,
        });
      }

      // The reader is pinned to this captured UUID and rejects symlinked, foreign
      // or oversized native files. Snapshot before arming to distinguish turns.
      const transcript = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sid, '.system_generated/logs/transcript_full.jsonl');
      const provenance = require(path.join(installedPluginRoot(), 'hooks/antigravity/native-agent-provenance.js'));
      let controlRows;
      try { controlRows = provenance.transcriptRows(transcript); } catch (error) {
        emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE own control transcript: ${error.message}` });
      }

      // Arm only after the first response, through the identical workspace hook
      // present in both legs. Otherwise pre-invocation workflow recovery starts
      // a full review before the model ever attempts the Stop under test.
      const inactive = stateSnapshot(ws, sid);
      if (!inactive || inactive.active || inactive.implComplete || inactive.chainDone) {
        emit({
          kind: 'live',
          probe,
          unavailable: true,
          stdout: `LIVE-UNAVAILABLE control workflow was not inactive for ${sid}`,
        });
      }
      const armRequest = JSON.parse(fs.readFileSync(stopFixture.request, 'utf8'));
      fs.writeFileSync(stopFixture.request, JSON.stringify({ ...armRequest, sessionId: sid }) + '\n');

      const runB = runAgy(cyclePrompt, ws, vars.timeout_s, { ZENSU_SHIM_TRACE: traceB, ZENSU_SHIM_DECISIONS: decisionsB }, [
        ...toolProbeArgs(ws), '--log-file', logB,
        '--conversation',
        sid,
      ], { controlDecisions: readDecisions(decisionsA), receipt: stopFixture.receipt, hookHash: stopFixture.hookHash });
      const blockedB = unavailableReason(runB);
      if (blockedB) {
        emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE ${blockedB}`, exit_code: runB.exit_code });
      }

      // Did phase B actually key on the chain we armed? The enforcer resolves its
      // session from the payload; a resumed
      // run that arrives with a different conversationId reads an inactive state
      // file and never blocks. Reporting that as STOP-NOT-BLOCKED would blame the
      // plugin for "we could not arm the conversation we resumed".
      // Native child hooks inherit the trace path. Their explicit parent/agent
      // identities are not additional main conversations and cannot supply its
      // Stop witness; foreign main or child decisions still fail the pure proof.
      const resumedSessions = [...new Set(readDecisions(decisionsB)
        .filter(row => !row.agentId && !row.parentSessionId).map(row => row.sessionId).filter(Boolean))];
      const sidAfter = resumedSessions.length === 1 ? resumedSessions[0] : '';
      if (sidAfter !== sid) {
        emit({
          kind: 'live',
          probe,
          unavailable: true,
          stdout: `LIVE-UNAVAILABLE the resumed run reported a different session (${sidAfter || 'none'} != ${sid}), so the armed chain was never consulted`,
          exit_code: runB.exit_code,
        });
      }

      const stopsUnarmed = countHook(traceA, 'stop-chain-enforcer.sh');
      const stopsArmed = countHook(traceB, 'stop-chain-enforcer.sh');
      const state = stateSnapshot(ws, sid);
      const enforcingStops = readDecisions(decisionsB).filter(row => row.sessionId === sid &&
        row.event === 'Stop' && row.script === 'stop-chain-enforcer.sh' && row.decision === 'block').length;
      const chainDone = Boolean(state && state.chainDone);
      const stopBlockCount = state ? Number(state.stopBlockCount || 0) : null;

      // The control has to BE a control. A session that is free to stop ends on its
      // first Stop; anything else means the two legs are not comparable and the
      // host claim would rest on a moving baseline.
      if (stopsUnarmed !== 1) {
        emit({
          kind: 'live',
          probe,
          unavailable: true,
          stdout: `LIVE-UNAVAILABLE the unarmed control fired the Stop hook ${stopsUnarmed} time(s), not once — no usable baseline`,
          exit_code: runB.exit_code,
        });
      }

      let armedRows, ownLog;
      try {
        armedRows = provenance.transcriptRows(transcript);
        ownLog = provenance.readHostFile(logB);
        if (!ownLog.includes(ws) || !ownLog.includes(sid)) throw Error('armed CLI log does not match this workspace and conversation');
      } catch (error) {
        emit({ kind: 'live', probe, unavailable: true, stdout: `LIVE-UNAVAILABLE own armed evidence: ${error.message}` });
      }
      const continuation = stopContinuationProof({ sessionId: sid, prompt: cyclePrompt, controlRows, armedRows,
        controlDecisions: readDecisions(decisionsA), armedDecisions: readDecisions(decisionsB) });
      const printTimeout = /Print mode: print timeout .* with turn in progress/.test(ownLog);
      const { enforcer: enforcerVerdict, host: hostVerdict } = stopVerdicts({ enforcingStops, continuation });

      emit({
        kind: 'live',
        probe,
        session_id: sid,
        enforcing_stops: enforcingStops,
        stop_block_count: stopBlockCount,
        continuation,
        print_timeout: printTimeout,
        armed_workflow_complete: chainDone,
        chain_done: chainDone,
        stops_unarmed: stopsUnarmed,
        stops_armed: stopsArmed,
        stdout:
          `${enforcerVerdict} ${hostVerdict} enforcing_stops=${enforcingStops} ` +
          `armed_workflow_complete=${chainDone} print_timeout=${printTimeout} ` +
          `blocked_step=${continuation.blockedStep ?? 'none'} resumed_step=${continuation.resumedStep ?? 'none'} ` +
          `stops_unarmed=${stopsUnarmed} stops_armed=${stopsArmed}`,
        raw: runB.stdout.slice(0, 2000),
        exit_code: runB.exit_code,
      });
    }

    const run = runAgy(String(vars.prompt || 'Reply with exactly: READY'), ws, vars.timeout_s);
    const blocked = unavailableReason(run);
    emit({
      kind: 'live',
      probe: 'prompt',
      unavailable: Boolean(blocked),
      stdout: blocked ? `LIVE-UNAVAILABLE ${blocked}` : run.stdout,
      stderr: run.stderr,
      exit_code: run.exit_code,
    });
  } catch (error) {
    emit({ error: String((error && error.message) || error) });
  }
}

// Pure helpers, exported for the deterministic suite. Without this the probe logic
// could only ever be exercised by a paid live run, so a ReferenceError in it
// surfaced against real quota. Requiring this file must not RUN a probe, hence the
// main-module guard. Everything still inside main() — the probe bodies themselves —
// remains live-only; keep moving decision logic out here rather than growing it
// there.
module.exports = {
  agyArgs,
  parseTraceLine,
  readTrace,
  countHook,
  unavailableReason,
  resolveTraceFile,
  stopVerdicts,
  stopContinuationProof,
  logWrittenDuring,
  logSnapshot,
  fireReport,
  isAgyPluginRoot,
  installedPluginRoot,
  digest,
  readDecisions,
  matchingDecisions,
  gateVerdict,
  sourceWriteProof,
  sourceWriteCommand,
  gateRequest,
  stopCyclePrompt,
  makeWorkspace,
  toolProbeArgs,
  nativeAgentIdentities,
  nativeAgentTranscriptIdentities,
  nativeAgentVerdict,
};

if (require.main === module) {
  main();
}
