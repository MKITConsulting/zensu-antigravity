'use strict';

// Interactive transport for the existing live assertions. Terminal output is
// displayed to the operator, never interpreted as a model result or approval.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');

function canonicalDirectory(value) {
  if (!path.isAbsolute(value || '') || fs.realpathSync.native(value) !== value
      || !fs.lstatSync(value).isDirectory()) throw Error('A canonical existing directory is required');
  return value;
}

function buildInvocation({ prompt, ws, extraArgs = [], runDir, model }) {
  if (typeof prompt !== 'string' || !prompt || prompt.includes('\0')) throw Error('A literal prompt is required');
  const argv = ['--prompt-interactive', prompt];
  let sessionId = '', cliLog = path.join(runDir, 'cli.log');
  const seen = new Set();
  for (let index = 0; index < extraArgs.length; index += 2) {
    const name = extraArgs[index], value = extraArgs[index + 1];
    if (seen.has(name) || typeof value !== 'string') throw Error('Duplicate or incomplete native option');
    seen.add(name);
    if (name === '--conversation' && UUID.test(value)) { sessionId = value; argv.push(name, value); }
    else if (name === '--log-file' && path.isAbsolute(value)) cliLog = value;
    else if (name === '--output-format' && ['json', 'stream-json', 'text'].includes(value)) {
      // Print-mode formatting has no interactive equivalent. Consumers receive
      // the actual native transcript and final text, not manufactured stream events.
    } else throw Error(`Interactive live transport refuses option ${name}`);
  }
  if (model) {
    if (!/^[a-zA-Z0-9_.:-]+$/.test(model)) throw Error('Invalid model identifier');
    argv.push('--model', model);
  }
  argv.push('--log-file', cliLog);
  return { argv, cwd: ws, sessionId, cliLog };
}

function publicRows(rows) {
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/thinking|reasoning|thought/i.test(key))
      .map(([key, item]) => [key, clean(item)]));
  };
  return rows.map(clean);
}

function transportFailure(transport, observation) {
  const cleanup = transport.cleanupError
    ? `; cleanup ${transport.cleanupError.operation}: ${transport.cleanupError.error}` : '';
  const proof = observation?.verified === true ? 'native proof observed; transport did not finish normally'
    : `native proof missing: ${observation?.reason || 'observer unavailable'}`;
  return `Interactive transport: ${transport.reason}${cleanup}; ${proof}`;
}

function completionProof({ sessionId, prompt, rows, priorRows = [], decisions }) {
  const no = reason => ({ verified: false, reason });
  const ordered = list => Array.isArray(list) && list.every((row, index) =>
    Number.isSafeInteger(row?.step_index) && row.step_index >= 0
    && (!index || row.step_index > list[index - 1].step_index));
  if (!UUID.test(sessionId || '') || !ordered(rows) || !ordered(priorRows)) return no('missing ordered native transcript');
  if (JSON.stringify(rows.slice(0, priorRows.length)) !== JSON.stringify(priorRows)) return no('prior transcript prefix changed');
  const fresh = rows.slice(priorRows.length);
  const users = fresh.filter(row => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT');
  if (users.length !== 1 || users[0].status !== 'DONE') return no('not exactly one completed intended user turn');
  const content = users[0].content;
  if (content !== prompt && !(typeof content === 'string'
      && content.startsWith(`<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\n`))) return no('native user prompt does not match');
  const turn = fresh.filter(row => row.step_index > users[0].step_index);
  if (!turn.length || turn.some(row => !['DONE', 'ERROR'].includes(row.status))) return no('native turn is still pending');
  const last = turn.at(-1);
  if (last.type !== 'PLANNER_RESPONSE' || last.source !== 'MODEL' || last.status !== 'DONE'
      || (last.tool_calls && last.tool_calls.length) || typeof last.content !== 'string'
      || !last.content.trim()) return no('no terminal public model response');
  if (!Array.isArray(decisions) || !decisions.length) return no('no own hook decisions');
  if (decisions.some(row => row.sessionId !== sessionId && row.parentSessionId !== sessionId)) return no('foreign hook decision');
  const own = decisions.filter(row => row.sessionId === sessionId && !row.agentId && !row.parentSessionId);
  const lastInvocation = own.findLastIndex(row => row.event === 'PreInvocation');
  const tail = own.slice(lastInvocation + 1);
  if (lastInvocation < 0 || !tail.length || tail.some(row => row.event !== 'Stop')) return no('current invocation has not stopped');
  if (tail.some(row => row.decision !== 'raw' || row.fullyIdle !== true
      || !['NO_TOOL_CALL', 'TERMINAL_STEP_TYPE'].includes(row.terminationReason))) {
    return no('an own Stop is blocked, pending or unrecognized');
  }
  for (const script of ['stop-chain-enforcer.sh', 'stop-work-order.sh']) {
    const stops = tail.filter(row => row.script === script);
    if (stops.length !== 1) return no('no normal idle parent Stop');
  }
  return { verified: true, userStep: users[0].step_index, finalStep: last.step_index,
    response: last.content, finalHash: hash(last.content), transcriptHash: hash(JSON.stringify(rows)),
    decisionsHash: hash(JSON.stringify(decisions)) };
}

function observeRun(spec) {
  const provenance = require(path.join(spec.pluginRoot, 'hooks/antigravity/native-agent-provenance.js'));
  const decisions = provenance.readHostFile(spec.decisionsFile).split('\n').filter(Boolean).map(JSON.parse);
  const parents = [...new Set(decisions.filter(row => !row.agentId && !row.parentSessionId).map(row => row.sessionId))];
  if (parents.length !== 1 || !UUID.test(parents[0] || '')
      || (spec.sessionId && spec.sessionId !== parents[0])) throw Error('No unique own native parent');
  const sessionId = parents[0];
  const cliLog = provenance.readHostFile(spec.cliLog);
  if (!cliLog.includes(spec.ws) || !cliLog.includes(sessionId)) throw Error('CLI log lacks own workspace/session correlation');
  const transcript = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sessionId, '.system_generated/logs/transcript_full.jsonl');
  const rows = publicRows(provenance.transcriptRows(transcript));
  const priorRows = spec.priorRows || [];
  let proof;
  if (spec.stopProbe) {
    if (spec.sessionId !== sessionId || !priorRows.length) throw Error('Stop observation requires an exact resumed control');
    if (hash(provenance.readHostFile(path.join(spec.ws, '.agents/hooks.json'))) !== spec.stopProbe.hookHash) {
      throw Error('Disposable Stop fixture hook changed between paired legs');
    }
    const armReceipt = JSON.parse(provenance.readHostFile(spec.stopProbe.receipt));
    if (armReceipt.workspace !== spec.ws || armReceipt.pluginRoot !== spec.pluginRoot) throw Error('Foreign Stop arming receipt');
    proof = require('./agy-stop-probe.js').continuationProof({ sessionId, prompt: spec.prompt, rows, priorRows,
      decisions, controlDecisions: spec.stopProbe.controlDecisions, armReceipt });
  } else proof = completionProof({ sessionId, prompt: spec.prompt, rows, priorRows, decisions });
  if (!proof.verified) return proof;
  const core = require(path.join(spec.pluginRoot, 'hooks/lib/session-control-core-v1.js'));
  const paths = require(path.join(spec.pluginRoot, 'hooks/antigravity/session-paths.js'));
  const contextPath = path.join(paths.dataRoot(), 'session-control/v1/records', `${core.sessionKey(sessionId)}.json`);
  const context = paths.readPrivateJson(contextPath);
  const runtimeDigest = core.computeRuntimeDigest(spec.pluginRoot, 'native');
  if (spec.stopProbe && JSON.parse(provenance.readHostFile(spec.stopProbe.receipt)).runtimeDigest !== runtimeDigest) {
    throw Error('Stop arming receipt belongs to a different runtime');
  }
  if (context.host !== 'native' || context.project_root !== spec.ws || context.plugin_root !== spec.pluginRoot
      || context.runtime_digest !== runtimeDigest || context.session_id_hash !== `sha256:${core.sessionKey(sessionId).slice(5)}`) {
    throw Error('Native context does not match the frozen workspace/runtime/session');
  }
  return { verified: true, sessionId, workspace: spec.ws, pluginRoot: spec.pluginRoot, runtimeDigest,
    transcript, cliLog: spec.cliLog, decisionsFile: spec.decisionsFile, contextPath,
    hostHookParseRejected: /Failed to parse hooks for plugin/.test(cliLog),
    completion: proof, transcriptRows: rows };
}

function runInteractive({ prompt, ws, timeoutS, extraEnv = {}, extraArgs = [], pluginRoot, stopProbe }) {
  const evidence = canonicalDirectory(process.env.ZENSU_LIVE_EVIDENCE_DIR);
  canonicalDirectory(ws); canonicalDirectory(pluginRoot);
  if (!ws.startsWith(path.join(evidence, 'workspaces') + path.sep)) throw Error('Interactive workspace is outside this evidence run');
  const runs = path.join(evidence, 'runs'); fs.mkdirSync(runs, { recursive: true, mode: 0o700 });
  const runDir = fs.mkdtempSync(path.join(runs, 'turn-'));
  const invocation = buildInvocation({ prompt, ws, extraArgs, runDir, model: process.env.ZENSU_LIVE_MODEL });
  const settingsFile = path.join(os.homedir(), '.gemini/antigravity-cli/settings.json');
  const settingsBefore = fs.readFileSync(settingsFile);
  const settings = JSON.parse(settingsBefore);
  if (!Array.isArray(settings.trustedWorkspaces) || !settings.trustedWorkspaces.includes(ws)) {
    throw Error('The exact disposable workspace needs separately authorized temporary trust; the runner never grants it');
  }
  const decisionsFile = extraEnv.ZENSU_SHIM_DECISIONS || path.join(runDir, 'decisions.jsonl');
  for (const file of [invocation.cliLog, decisionsFile]) {
    if (!path.resolve(file).startsWith(evidence + path.sep) || fs.existsSync(file)) {
      throw Error('Native run evidence must use a fresh owned path');
    }
    canonicalDirectory(path.dirname(file));
  }
  let priorRows = [];
  if (invocation.sessionId) {
    const provenance = require(path.join(pluginRoot, 'hooks/antigravity/native-agent-provenance.js'));
    priorRows = publicRows(provenance.transcriptRows(path.join(os.homedir(), '.gemini/antigravity-cli/brain',
      invocation.sessionId, '.system_generated/logs/transcript_full.jsonl')));
  }
  const seconds = Number(process.env.ZENSU_LIVE_INTERACTIVE_TIMEOUT_S || Math.max(300, Number(timeoutS) || 120));
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw Error('Invalid bounded interactive timeout');
  const spec = { ...invocation, prompt, ws, pluginRoot, decisionsFile, priorRows, runDir,
    seconds, node: process.execPath, observer: __filename, settingsFile, settingsBeforeHash: hash(settingsBefore), stopProbe };
  const specFile = path.join(runDir, 'request.json');
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const result = spawnSync('python3', [path.join(__dirname, 'agy-interactive-pty.py'), specFile], {
    cwd: ws, encoding: 'utf8', timeout: (seconds + 30) * 1000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...extraEnv, PWD: ws, ZENSU_PROJECT_DIR: ws, ZENSU_CHAIN: '',
      ZENSU_SHIM_DECISIONS: decisionsFile },
  });
  const output = { exit_code: result.status ?? -1, stdout: '', stderr: result.stderr || '',
    signal: result.signal || '', spawn_error: result.error?.message || '', runDir };
  try {
    const transport = JSON.parse(fs.readFileSync(path.join(runDir, 'transport.json'), 'utf8'));
    output.exit_code = transport.exitCode ?? -1;
    const expectedReason = stopProbe ? 'stop-continuation-observed' : 'completed';
    if (transport.reason !== expectedReason || transport.cleanupError) {
      // A public final on resume is insufficient. Keep the current observer's
      // exact missing proof alongside transport/cleanup failure, so a lost hook
      // witness is not misreported as a generic timeout or successful Stop.
      const observed = observeRun(spec);
      output.nativeObservation = publicRows([observed])[0];
      throw Error(transportFailure(transport, observed));
    }
    if (hash(fs.readFileSync(settingsFile)) !== spec.settingsBeforeHash) throw Error('Native settings changed during the interactive turn');
    const observed = observeRun(spec);
    if (!observed.verified || output.exit_code !== 0 || result.status !== 0 || result.signal || result.error) {
      throw Error(observed.reason || 'Interactive process did not exit normally');
    }
    // Stop probes report an observation, never a fabricated model final or
    // completed workflow. Other callers keep the normal-idle completion gate.
    output.stdout = stopProbe ? JSON.stringify({ observation: 'stop-continuation',
      continuation: observed.completion.continuation }) : observed.completion.response;
    output.nativeSessionId = observed.sessionId;
    output.transcriptRows = observed.transcriptRows;
    const { transcriptRows, ...nativeEvidence } = observed;
    output.nativeEvidence = { ...nativeEvidence, runDir, transport };
    fs.writeFileSync(path.join(runDir, 'native-evidence.json'), JSON.stringify(observed, null, 2) + '\n', { mode: 0o600 });
  } catch (error) { output.spawn_error = String(error.message); }
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });
  return output;
}

module.exports = { buildInvocation, completionProof, publicRows, observeRun, runInteractive, transportFailure };
if (require.main === module) {
  try {
    const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(observeRun(spec)));
  } catch (error) { process.stdout.write(JSON.stringify({ verified: false, reason: error.message })); }
}
