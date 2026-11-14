'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { completionProof, observeRun } = require('../../evals/promptfoo/lib/agy-interactive-run.js');
const sessionId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const taskId = sessionId + '/task-2';
const logFile = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sessionId, '.system_generated/tasks/task-2.log');
const logURL = pathToFileURL(logFile).href;
const command = "printf '%s\\n' 'fixture'";
const prompt = 'Run the fixture and report its actual result.';

// AGY 1.5.9 retains the original RUNNING row after delivering a task result.
function fixture(exitCode = 0) {
  return { sessionId, prompt, rows: [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: prompt },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE',
      tool_calls: [{ name: 'run_command', args: { CommandLine: command, WaitMsBeforeAsync: 5000 } }] },
    { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'RUNNING', created_at: '2026-11-14T16:31:10Z',
      content: 'Created At: 2026-11-14T17:31:10+01:00\nTool is running as a background task with task id: ' + taskId +
        '\nTask Description: ' + command + '\nTask logs are available at: ' + logURL + '\nNative pending task reference.' },
    { step_index: 3, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: '2026-11-14T16:31:52Z',
      content: 'The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n' +
        '[Message] timestamp=2026-11-14T16:31:49Z sender=' + taskId +
        ' priority=MESSAGE_PRIORITY_HIGH content=Task id "' + taskId + '" finished with result:\nCommand exited with code ' +
        exitCode + '.\n\nNo output from the command.\nLog: ' + logURL + '\n</SYSTEM_MESSAGE>' },
    { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'The command finished.' },
  ], decisions: [
    { sessionId, event: 'PreInvocation', script: 'session-start-primer.sh', decision: 'raw' },
    ...['stop-chain-enforcer.sh', 'stop-work-order.sh'].map(script => ({
      sessionId, event: 'Stop', script, decision: 'raw', fullyIdle: true, terminationReason: 'NO_TOOL_CALL',
    })),
  ] };
}
test('a correlated host result closes its historical RUNNING row without rewriting it', () => {
  const f = fixture(), before = JSON.stringify(f), result = completionProof(f);
  assert.equal(result.verified, true, result.reason);
  assert.equal(result.backgroundTasks.length, 1);
  const task = result.backgroundTasks[0];
  assert.equal(task.taskId, taskId); assert.equal(task.startedStep, 2); assert.equal(task.completedStep, 3);
  assert.equal(task.exitCode, 0); assert.equal(task.logFile, logFile);
  assert.equal(JSON.stringify(f), before);
});
test('missing, foreign, ambiguous and model-authored completion stays pending', () => {
  const mutations = {
    missing: f => f.rows.splice(3, 1),
    model: f => { f.rows[3].source = 'MODEL'; },
    user: f => { f.rows[3].source = 'USER_EXPLICIT'; },
    tool: f => { f.rows[3].type = 'GENERIC'; },
    unfinished: f => { f.rows[3].status = 'RUNNING'; },
    sender: f => { f.rows[3].content = f.rows[3].content.replace('sender=' + sessionId, 'sender=' + otherId); },
    completedTask: f => { f.rows[3].content = f.rows[3].content.replace('Task id "' + taskId, 'Task id "' + otherId + '/task-2'); },
    startedTask: f => { f.rows[2].content = f.rows[2].content.replace(taskId, sessionId + '/task-8'); },
    resultLog: f => { f.rows[3].content = f.rows[3].content.replace(logURL, logURL.replace(sessionId, otherId)); },
    startLog: f => { f.rows[2].content = f.rows[2].content.replace(logURL, logURL.replace(sessionId, otherId)); },
    remoteLog: f => { f.rows[3].content = f.rows[3].content.replace(logURL, 'https://example.test/task.log'); },
    logQuery: f => { f.rows[3].content = f.rows[3].content.replace(logURL, logURL + '?other'); },
    command: f => { f.rows[1].tool_calls[0].args.CommandLine = 'different command'; },
    mixedCalls: f => { f.rows[1].tool_calls.push({ name: 'read_file', args: { Path: '/other' } }); },
    parentTool: f => { f.rows[1].tool_calls[0].name = 'read_file'; },
    pendingKind: f => { f.rows[2].type = 'PLANNER_RESPONSE'; },
    pendingStatus: f => { f.rows[2].status = 'IN_PROGRESS'; },
    changedStartTime: f => { f.rows[2].created_at = '2026-11-14T16:31:11Z'; },
    missingStartTime: f => { delete f.rows[2].created_at; },
    missingResultTime: f => { delete f.rows[3].created_at; },
    earlyResult: f => { f.rows[3].content = f.rows[3].content.replace('16:31:49Z', '16:30:00Z'); },
    futureResult: f => { f.rows[3].content = f.rows[3].content.replace('16:31:49Z', '16:32:49Z'); },
    unknownExit: f => { f.rows[3].content = f.rows[3].content.replace('code 0.', 'code unknown.'); },
    duplicate: f => { f.rows[4].step_index = 5; f.rows.splice(4, 0, { ...f.rows[3], step_index: 4 }); },
    anotherPending: f => { f.rows[4].step_index = 5; f.rows.splice(4, 0, { step_index: 4, source: 'MODEL', type: 'GENERIC', status: 'RUNNING' }); },
    quoted: f => { f.rows[3].content = 'Quoted output:\n' + f.rows[3].content; },
  };
  for (const [label, change] of Object.entries(mutations)) {
    const f = fixture(); change(f); assert.equal(completionProof(f).verified, false, label);
  }
});
test('background completion still requires the final and both normal fully idle Stops', () => {
  for (const change of [
    f => f.decisions.pop(),
    f => { f.decisions[1].fullyIdle = false; },
    f => { f.decisions[1].decision = 'block'; },
    f => { f.decisions[2].terminationReason = 'USER_CANCELED'; },
    f => { f.decisions[2].sessionId = otherId; },
    f => { f.rows[4].status = 'RUNNING'; },
    f => { f.rows[4].tool_calls = [{ name: 'run_command', args: { CommandLine: 'still working' } }]; },
  ]) { const f = fixture(); change(f); assert.equal(completionProof(f).verified, false); }
});
test('completed nonzero commands retain their exit code instead of becoming successful commands', () => {
  const result = completionProof(fixture(2));
  assert.equal(result.verified, true, result.reason); assert.equal(result.backgroundTasks[0].exitCode, 2);
});
test('observation reads the exact protected task log and preserves runtime verification', t => {
  const pluginRoot = path.resolve(__dirname, '../..'), ws = '/owned/native-fixture';
  const provenance = require('../../hooks/antigravity/native-agent-provenance.js');
  const paths = require('../../hooks/antigravity/session-paths.js');
  const core = require('../../hooks/lib/session-control-core-v1.js');
  const f = fixture(), reads = [];
  let taskLog = 'fixture output\n', runtimeDigest = 'sha256:fixture';
  t.mock.method(provenance, 'transcriptRows', () => f.rows);
  t.mock.method(provenance, 'readHostFile', file => {
    reads.push(file);
    if (file === '/owned/decisions.jsonl') return f.decisions.map(x => JSON.stringify(x)).join('\n');
    if (file === '/owned/cli.log') return ws + '\n' + sessionId;
    if (file === logFile && taskLog !== null) return taskLog;
    throw Error('unsafe or missing host evidence');
  });
  t.mock.method(paths, 'dataRoot', () => '/owned/private');
  t.mock.method(paths, 'readPrivateJson', () => ({ host: 'native', project_root: ws, plugin_root: pluginRoot,
    runtime_digest: runtimeDigest, session_id_hash: 'sha256:' + core.sessionKey(sessionId).slice(5) }));
  t.mock.method(core, 'computeRuntimeDigest', () => 'sha256:fixture');
  const spec = { ws, pluginRoot, prompt, sessionId, decisionsFile: '/owned/decisions.jsonl', cliLog: '/owned/cli.log' };
  const result = observeRun(spec);
  assert.equal(result.verified, true, result.reason); assert(reads.includes(logFile));
  assert.equal(result.completion.backgroundTasks[0].logHash, createHash('sha256').update(taskLog).digest('hex'));
  const initialHash = result.completion.backgroundTasksHash;
  taskLog = 'changed task log\n'; assert.notEqual(observeRun(spec).completion.backgroundTasksHash, initialHash);
  taskLog = null; assert.throws(() => observeRun(spec), /missing host evidence/);
  taskLog = 'fixture output\n'; runtimeDigest = 'sha256:foreign';
  assert.throws(() => observeRun(spec), /does not match/);
});


test('a same-task completion before dispatch cannot hide a contradictory completion', () => {
  const f = fixture();
  for (const row of f.rows.slice(1)) {
    row.step_index += 3;
    if (row.content) row.content = row.content.replaceAll('task-2', 'task-5');
  }
  const early = { ...f.rows[3], step_index: 1 };
  f.rows.splice(1, 0, early);
  assert.equal(completionProof(f).verified, false, 'all current-turn candidates must participate in uniqueness');
  f.rows.splice(4, 1);
  assert.equal(completionProof(f).verified, false, 'a sole completion must follow dispatch');
});
