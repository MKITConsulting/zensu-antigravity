'use strict';

// Disposable fixture driver, never part of the shipped plugin. Arm after the
// first model response so pre-invocation recovery cannot consume the experiment.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function prepare({ ws, pluginRoot, directory }) {
  for (const value of [ws, pluginRoot, directory]) {
    if (!path.isAbsolute(value) || fs.realpathSync.native(value) !== value) throw Error('Noncanonical Stop fixture path');
  }
  const request = path.join(directory, 'stop-arm-request.json');
  const receipt = path.join(directory, 'stop-arm-receipt.json');
  fs.writeFileSync(request, JSON.stringify({ ws, pluginRoot, receipt, sessionId: null }) + '\n', { flag: 'wx', mode: 0o600 });
  const hooks = path.join(ws, '.agents/hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ 'zensu-live-stop-arm': { PostInvocation: [{ type: 'command',
    command: `${quote(process.execPath)} ${quote(__filename)} --arm ${quote(request)}`, timeout: 30 }] } }) + '\n',
  { flag: 'wx', mode: 0o600 });
  return { request, receipt, hookHash: hash(fs.readFileSync(hooks)) };
}

function arm(request, payload) {
  if (request.sessionId === null) return null; // Identical hook is inert in the control leg.
  if (!UUID.test(request.sessionId || '') || payload.conversationId !== request.sessionId
      || !Number.isSafeInteger(payload.invocationNum) || payload.invocationNum < 0
      || !Array.isArray(payload.workspacePaths) || payload.workspacePaths.length !== 1
      || payload.workspacePaths[0] !== request.ws) throw Error('Stop fixture hook identity mismatch');
  if (fs.existsSync(request.receipt)) return null; // One attempt, including a failed attempt.
  const root = request.pluginRoot;
  const paths = require(path.join(root, 'hooks/antigravity/session-paths.js'));
  const core = require(path.join(root, 'hooks/lib/session-control-core-v1.js'));
  const runtime = core.computeRuntimeDigest(root, 'native');
  const context = core.readContext({ recordsDir: path.join(paths.dataRoot(), 'session-control/v1/records'),
    sessionId: request.sessionId, expectedHost: 'native' });
  if (context.project_root !== request.ws || context.plugin_root !== root || context.runtime_digest !== runtime) {
    throw Error('Stop fixture hook has no matching immutable native context');
  }
  const before = core.readWorkflowState({ projectRoot: request.ws, sessionId: request.sessionId });
  if (before?.active || before?.implComplete || before?.chainDone) throw Error('Stop fixture was armed before the first response');
  const receipt = { sessionId: request.sessionId, workspace: request.ws, pluginRoot: root, runtimeDigest: runtime,
    invocationNum: payload.invocationNum, initialNumSteps: payload.initialNumSteps, before, success: false, calls: [] };
  fs.writeFileSync(request.receipt, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
  for (const flag of ['--tdd-begin', '--tdd-complete']) {
    const result = spawnSync('bash', [path.join(root, 'hooks/lib/zensu-log.sh'), flag], {
      cwd: request.ws, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ZENSU_PLUGIN_ROOT: root, ZENSU_PLUGIN_DATA: paths.dataRoot(),
        ZENSU_HOST_SESSION_ID: request.sessionId, ZENSU_PROJECT_DIR: request.ws,
        ZENSU_CONFIG: path.join(request.ws, '.zensu/config.json') },
    });
    receipt.calls.push({ flag, status: result.status, signal: result.signal, error: result.error?.message || '',
      stdout: result.stdout, stderr: result.stderr });
    if (result.status !== 0 || result.signal || result.error) break;
  }
  receipt.after = core.readWorkflowState({ projectRoot: request.ws, sessionId: request.sessionId });
  receipt.success = receipt.calls.length === 2 && receipt.calls.every(call => call.status === 0 && !call.signal && !call.error)
    && receipt.after?.active === true && receipt.after.implComplete === true && receipt.after.chainDone === false;
  fs.writeFileSync(request.receipt, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

function continuationProof({ sessionId, prompt, rows, priorRows, decisions, controlDecisions, armReceipt }) {
  const no = reason => ({ verified: false, reason });
  const continuation = require('./agy-live-provider.js').stopContinuationProof({ sessionId, prompt,
    controlRows: priorRows, armedRows: rows, controlDecisions, armedDecisions: decisions });
  if (!continuation.verified) return continuation;
  if (!armReceipt?.success || armReceipt.sessionId !== sessionId || armReceipt.before?.active !== false
      || !Number.isSafeInteger(armReceipt.invocationNum) || armReceipt.invocationNum < 0
      || armReceipt.calls?.length !== 2 || armReceipt.calls.some((call, index) =>
        call.flag !== ['--tdd-begin', '--tdd-complete'][index] || call.status !== 0 || call.signal || call.error)
      || armReceipt.after?.active !== true || armReceipt.after.implComplete !== true
      || armReceipt.after.chainDone !== false) return no('no fresh post-response arming receipt');
  const first = rows.find(row => row.step_index > continuation.armedUserStep && row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL');
  if (!first || first.status !== 'DONE' || first.step_index >= continuation.blockedStep
      || first.tool_calls?.length || !first.content?.trim()) return no('armed leg did not first attempt a tool-free Stop');
  if (continuation.activity === 'tool-call' && continuation.completedToolResults < 1) {
    return no('resumed tool has not completed');
  }
  return { verified: true, kind: 'stop-continuation', continuation,
    response: rows.find(row => row.step_index === continuation.resumedStep)?.content || '',
    transcriptHash: hash(JSON.stringify(rows)), decisionsHash: hash(JSON.stringify(decisions)) };
}

module.exports = { prepare, arm, continuationProof };
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--arm') throw Error('Expected --arm <fixture request>');
    arm(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), JSON.parse(fs.readFileSync(0, 'utf8')));
  } catch (error) { process.stderr.write(`Stop fixture arming failed: ${error.message}\n`); process.exitCode = 1; }
  // No injected prompt, permission decision, termination override or plugin edit.
  process.stdout.write('{}\n');
}
