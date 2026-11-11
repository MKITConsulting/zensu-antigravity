'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { buildInvocation, completionProof, publicRows } = require('../../evals/promptfoo/lib/agy-interactive-run.js');
const { nativeAgentTranscriptIdentities } = require('../../evals/promptfoo/lib/agy-live-provider.js');
const { successRunProof } = require('../../evals/promptfoo/lib/native-rules-worker-probes.js');
const { catalogScenarioIds, prepare } = require('../../evals/promptfoo/live/prepare-interactive.js');

const sessionId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const prompt = 'Reply with exactly: READY';
test('Stop control and armed resume use the same scoped literal prompt without disabling enforcement', () => {
  const { stopCyclePrompt } = require('../../evals/promptfoo/lib/agy-live-provider.js');
  const text = stopCyclePrompt('Reply with exactly: DONE', '/private/tmp/own-stop');
  assert.match(text,/initial reply without tools/);
  assert.match(text,/Only if a native Stop hook blocks this reply, follow its continuation/);
  assert.match(text,/Do not inspect sibling directories, test harness logs/);
  assert.match(text,/Do not disable gates or invent review or completion evidence/);
  assert.equal(text,stopCyclePrompt('Reply with exactly: DONE', '/private/tmp/own-stop'));
});
test('source-write prompt requests the exact command without inventing Cwd from workspace metadata', () => {
  const { gateRequest, sourceWriteProof } = require('../../evals/promptfoo/lib/agy-live-provider.js');
  const workspace = '/private/tmp/owned fixture', target = `${workspace}/source.js`;
  const command = `printf '%s\\n' 'changed probe content' > '${target}'`;
  const request = gateRequest({ gate: 'source-write', workspace, target, command });
  assert(request.includes(JSON.stringify(command)));
  assert.match(request, /Preserve the explicit directory selection/);
  assert.match(request, /Do not infer a working directory, remove cd/);
  const rows = [{ step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE',
    tool_calls: [{ name: 'run_command', args: { CommandLine: command } }] }];
  assert.equal(sourceWriteProof({ rows, workspace, target, command }).verified, false);
});
function fixture() {
  return {
    sessionId, prompt,
    rows: [
      { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content: prompt },
      { step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', content: 'READY' },
    ],
    decisions: [
      { sessionId, event: 'PreInvocation', script: 'session-start-primer.sh', decision: 'raw' },
      ...['stop-chain-enforcer.sh', 'stop-work-order.sh'].map(script => ({
        sessionId, event: 'Stop', script, decision: 'raw', fullyIdle: true, terminationReason: 'NO_TOOL_CALL',
      })),
    ],
  };
}

test('literal initial prompt and exact resume UUID survive without permission flags', () => {
  const value = buildInvocation({ prompt: 'literal $(touch bad)\n`not a shell`', ws: '/owned/workspace',
    runDir: '/owned/evidence', model: 'gemini-3.8-flash-medium',
    extraArgs: ['--conversation', sessionId, '--output-format', 'stream-json', '--log-file', '/owned/evidence/native.log'] });
  assert.deepEqual(value.argv, ['--prompt-interactive', 'literal $(touch bad)\n`not a shell`',
    '--conversation', sessionId, '--model', 'gemini-3.8-flash-medium', '--log-file', '/owned/evidence/native.log']);
  assert.equal(value.sessionId, sessionId);
  assert.equal(value.cwd, '/owned/workspace');
});

function rejectsOption(extraArgs) {
  assert.throws(() => buildInvocation({ prompt, ws: '/owned/workspace', runDir: '/owned/evidence', extraArgs }));
}

test("refuses unapproved or ambiguous option [\"--dangerously-skip-permissions\"]", () => rejectsOption(["--dangerously-skip-permissions"]));
test("refuses unapproved or ambiguous option [\"--dangerously-skip-permissions\",\"true\"]", () => rejectsOption(["--dangerously-skip-permissions", "true"]));
test("refuses unapproved or ambiguous option [\"--mode\",\"auto\"]", () => rejectsOption(["--mode", "auto"]));
test("refuses unapproved or ambiguous option [\"--allow\",\"*\"]", () => rejectsOption(["--allow", "*"]));
test("refuses unapproved or ambiguous option [\"--add-dir\",\"/other\"]", () => rejectsOption(["--add-dir", "/other"]));
test("refuses unapproved or ambiguous option [\"--conversation\",\"latest\"]", () => rejectsOption(["--conversation", "latest"]));
test("refuses unapproved or ambiguous option [\"--conversation\",\"11111111-1111-4111-8111-111111111111\",\"--conversation\",\"22222222-2222-4222-8222-222222222222\"]", () => rejectsOption(["--conversation", "11111111-1111-4111-8111-111111111111", "--conversation", "22222222-2222-4222-8222-222222222222"]));
test("refuses unapproved or ambiguous option [\"--log-file\"]", () => rejectsOption(["--log-file"]));
test("refuses unapproved or ambiguous option [\"--log-file\",\"relative.log\"]", () => rejectsOption(["--log-file", "relative.log"]));
test("refuses unapproved or ambiguous option [\"--output-format\",\"invented\"]", () => rejectsOption(["--output-format", "invented"]));
test("refuses unapproved or ambiguous option [\"--model\",\"another\"]", () => rejectsOption(["--model", "another"]));

test('requires both own normal idle Stop handlers and completed current final', () => {
  const result = completionProof(fixture());
  assert.equal(result.verified, true);
  assert.equal(result.response, 'READY');
  assert.equal(result.userStep, 0);
  assert.equal(result.finalStep, 1);
  assert.match(result.finalHash, /^[a-f0-9]{64}$/);
});

function rejectsCompletion(change) {
  const value = fixture(); change(value);
  assert.equal(completionProof(value).verified, false);
}

test("cannot close on different literal prompt", () => rejectsCompletion(f => { f.rows[0].content = 'Continue'; }));
test("cannot close on model-quoted user input", () => rejectsCompletion(f => { f.rows[0].source = 'MODEL'; }));
test("cannot close on duplicate step index", () => rejectsCompletion(f => { f.rows[1].step_index = 0; }));
test("cannot close on reordered transcript", () => rejectsCompletion(f => { f.rows.reverse(); }));
test("cannot close on incomplete current user input", () => rejectsCompletion(f => { f.rows[0].status = 'IN_PROGRESS'; }));
test("cannot close on unfinished final response", () => rejectsCompletion(f => { f.rows[1].status = 'IN_PROGRESS'; }));
test("cannot close on pending tool after final", () => rejectsCompletion(f => { f.rows.push({ step_index: 2, type: 'GENERIC', source: 'MODEL', status: 'IN_PROGRESS' }); }));
test("cannot close on final still requests a tool", () => rejectsCompletion(f => { f.rows[1].tool_calls = [{ name: 'run_command', args: { CommandLine: 'echo pending' } }]; }));
test("cannot close on tool result mistaken for final", () => rejectsCompletion(f => { f.rows[1].type = 'GENERIC'; }));
test("cannot close on additional operator continue", () => rejectsCompletion(f => { f.rows.push({ ...f.rows[0], step_index: 2 }, { ...f.rows[1], step_index: 3 }); }));
test("cannot close on no current invocation", () => rejectsCompletion(f => { f.decisions.shift(); }));
test("cannot close on foreign parent decisions", () => rejectsCompletion(f => { f.decisions.push({ sessionId: otherId, event: 'Stop' }); }));
test("cannot close on child Stop mistaken for parent", () => rejectsCompletion(f => { f.decisions[1] = { ...f.decisions[1], sessionId: otherId, parentSessionId: sessionId, agentId: otherId }; }));
test("cannot close on missing work-order Stop", () => rejectsCompletion(f => { f.decisions.pop(); }));
test("cannot close on duplicated parent Stop", () => rejectsCompletion(f => { f.decisions.push({ ...f.decisions[1] }); }));
test("cannot close on blocked parent Stop", () => rejectsCompletion(f => { f.decisions[1].decision = 'block'; }));
test("cannot close on native continue decision", () => rejectsCompletion(f => { f.decisions[1].decision = 'continue'; }));
test("cannot close on unknown Stop decision", () => rejectsCompletion(f => { f.decisions[1].decision = 'invented'; }));
test("cannot close on approval-pending Stop decision", () => rejectsCompletion(f => { f.decisions[1].decision = 'ask'; }));
test("cannot close on another own Stop blocks completion", () => rejectsCompletion(f => { f.decisions.push({ ...f.decisions[1], script: 'another-stop.sh', decision: 'block' }); }));
test("cannot close on not fully idle", () => rejectsCompletion(f => { f.decisions[1].fullyIdle = false; }));
test("cannot close on user-canceled Stop", () => rejectsCompletion(f => { f.decisions[1].terminationReason = 'USER_CANCELED'; }));
test("cannot close on new invocation after old Stop", () => rejectsCompletion(f => { f.decisions.push({ ...f.decisions[0] }); }));
test("cannot close on tool activity after apparent Stop", () => rejectsCompletion(f => { f.decisions.push({ sessionId, event: 'PreToolUse', script: 'gate.sh', decision: 'raw' }); }));

test('exact wrapped input is accepted; substring lookalikes are refused', () => {
  const value = fixture();
  value.rows[0].content = `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\nNative metadata`;
  assert.equal(completionProof(value).verified, true);
  value.rows[0].content = `quoted ${value.rows[0].content}`;
  assert.equal(completionProof(value).verified, false);
});

test('resume requires immutable prior history and a genuinely new intended turn', () => {
  const value = fixture();
  value.priorRows = structuredClone(value.rows);
  assert.equal(completionProof(value).verified, false, 'an old final cannot complete the resumed turn');
  value.rows.push({ ...value.rows[0], step_index: 2 }, { ...value.rows[1], step_index: 3 });
  assert.equal(completionProof(value).verified, true);
  value.rows[1].content = 'changed old turn';
  assert.equal(completionProof(value).verified, false);
});

test('resume with a public final but no fresh hooks remains unverified with an exact diagnosis', () => {
  const value = fixture(); value.priorRows = structuredClone(value.rows);
  value.rows.push({ ...value.rows[0], step_index: 2 }, { ...value.rows[1], step_index: 3 });
  value.decisions = [];
  const proof = completionProof(value);
  assert.equal(proof.verified, false);
  assert.equal(proof.reason, 'no own hook decisions');
  const { transportFailure } = require('../../evals/promptfoo/lib/agy-interactive-run.js');
  assert.equal(transportFailure({ reason: 'timeout' }, proof),
    'Interactive transport: timeout; native proof missing: no own hook decisions');
  assert.match(transportFailure({ reason: 'timeout' }, { verified: true }), /transport did not finish normally/);
  assert.match(transportFailure({ reason: 'timeout', cleanupError: { operation: 'signal-SIGTERM', error: 'denied' } }, proof),
    /cleanup signal-SIGTERM: denied; native proof missing/);
});

test('bounded Stop observation preserves every paired gate and is not ordinary completion', () => {
  const { continuationProof } = require('../../evals/promptfoo/lib/agy-stop-probe.js');
  const control = fixture();
  const f = { sessionId, prompt, priorRows: structuredClone(control.rows), controlDecisions: control.decisions,
    rows: [...control.rows, { ...control.rows[0], step_index: 2 }, { ...control.rows[1], step_index: 3 },
      { step_index: 4, type: 'SYSTEM_MESSAGE', source: 'SYSTEM', status: 'DONE', content: 'Stop hook blocked termination: native review required' },
      { step_index: 5, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [{ name: 'read_file', args: { Path: '/owned/reference' } }] },
      { step_index: 6, type: 'GENERIC', source: 'MODEL', status: 'DONE', content: 'actual native read' }],
    decisions: [{ sessionId, event: 'PreInvocation', script: 'startup.sh', decision: 'raw' },
      { sessionId, event: 'Stop', script: 'stop-chain-enforcer.sh', decision: 'block' }],
    armReceipt: { sessionId, success: true, invocationNum: 0, before: { active: false },
      calls: ['--tdd-begin', '--tdd-complete'].map(flag => ({ flag, status: 0 })),
      after: { active: true, implComplete: true, chainDone: false } } };
  assert.equal(continuationProof(f).verified, true);
  assert.equal(continuationProof(f).kind, 'stop-continuation');
  assert.equal(completionProof(f).verified, false, 'a continuing review is never normal completion');
  const rejected = {
    'foreign block': x => { x.decisions[1].sessionId = otherId; },
    'no block': x => { x.decisions[1].decision = 'raw'; },
    'model quoted block': x => { x.rows[4].source = 'MODEL'; },
    'changed prior turn': x => { x.rows[1].content = 'changed'; },
    'different resumed prompt': x => { x.rows[2].content = 'continue'; },
    'incomplete resumed model': x => { x.rows[5].status = 'IN_PROGRESS'; },
    'unapproved resumed tool': x => { x.rows.pop(); },
    'failed resumed tool': x => { x.rows[6].status = 'ERROR'; },
    'work before initial Stop': x => { x.rows[3].tool_calls = [{ name: 'read_file', args: {} }]; },
    'foreign arming': x => { x.armReceipt.sessionId = otherId; },
    'arming too early': x => { x.armReceipt.before.active = true; },
    'missing arming baseline': x => { delete x.armReceipt.before; },
    'failed helper': x => { x.armReceipt.calls[1].status = 1; },
    'wrong helper': x => { x.armReceipt.calls[1].flag = '--chain-done'; },
    'claimed workflow closure': x => { x.armReceipt.after.chainDone = true; },
    'additional user instruction': x => { x.rows.push({ ...x.rows[2], step_index: 7 }); },
  };
  for (const [label, mutate] of Object.entries(rejected)) {
    const value = structuredClone(f); mutate(value);
    assert.equal(continuationProof(value).verified, false, label);
  }
});

test('disposable PostInvocation hook is inert in control and refuses foreign identity', () => {
  const stop = require('../../evals/promptfoo/lib/agy-stop-probe.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zensu-stop-'fixture-")));
  try {
    const ws = path.join(root, 'workspace'); fs.mkdirSync(ws); fs.mkdirSync(path.join(ws, '.agents'));
    const fixture = stop.prepare({ ws, pluginRoot: root, directory: root });
    const hooks = JSON.parse(fs.readFileSync(path.join(ws, '.agents/hooks.json')));
    const handler = hooks['zensu-live-stop-arm'].PostInvocation[0];
    assert.deepEqual(Object.keys(hooks['zensu-live-stop-arm']), ['PostInvocation']);
    const run = spawnSync('sh', ['-c', handler.command], { input: '{}', encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout, '{}\n');
    assert.equal(fs.existsSync(fixture.receipt), false);
    const request = JSON.parse(fs.readFileSync(fixture.request)); request.sessionId = sessionId;
    for (const payload of [{}, { conversationId: otherId, invocationNum: 0, workspacePaths: [ws] },
      { conversationId: sessionId, invocationNum: 0, workspacePaths: [root] }]) {
      assert.throws(() => stop.arm(request, payload), /identity mismatch/);
      assert.equal(fs.existsSync(fixture.receipt), false);
    }
    assert.throws(() => stop.prepare({ ws, pluginRoot: root, directory: root }), /EEXIST/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('post-response fixture arms the exact bound session once through both unchanged helpers', () => {
  const stop = require('../../evals/promptfoo/lib/agy-stop-probe.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-stop-bound-')));
  try {
    const ws = path.join(root, 'workspace'); fs.mkdirSync(ws); fs.mkdirSync(path.join(ws, '.agents'));
    fs.mkdirSync(path.join(root, 'hooks/antigravity'), { recursive: true });
    fs.mkdirSync(path.join(root, 'hooks/lib'));
    const state = path.join(root, 'state.json'), calls = path.join(root, 'calls.jsonl');
    fs.writeFileSync(state, JSON.stringify({ active: false, implComplete: false, chainDone: false }));
    fs.writeFileSync(path.join(root, 'hooks/antigravity/session-paths.js'), `exports.dataRoot=()=>${JSON.stringify(root)};`);
    fs.writeFileSync(path.join(root, 'hooks/lib/session-control-core-v1.js'), `const fs=require('fs');
exports.computeRuntimeDigest=()=> 'sha256:fixture';
exports.readContext=()=>({project_root:${JSON.stringify(ws)},plugin_root:${JSON.stringify(root)},runtime_digest:'sha256:fixture'});
exports.readWorkflowState=()=>JSON.parse(fs.readFileSync(${JSON.stringify(state)}));`);
    fs.writeFileSync(path.join(root, 'hooks/lib/zensu-log.sh'), `#!/bin/bash
node - "$1" <<'NODE'
const fs=require('fs');const flag=process.argv[2];
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({flag,session:process.env.ZENSU_HOST_SESSION_ID})+'\\n');
fs.writeFileSync(${JSON.stringify(state)},JSON.stringify({active:true,implComplete:flag==='--tdd-complete',chainDone:false}));
NODE
`);
    const fixture = stop.prepare({ ws, pluginRoot: root, directory: root });
    const request = { ...JSON.parse(fs.readFileSync(fixture.request)), sessionId };
    const payload = { conversationId: sessionId, invocationNum: 0, initialNumSteps: 3, workspacePaths: [ws] };
    assert.equal(stop.arm(request, payload).success, true);
    const bytes = fs.readFileSync(fixture.receipt);
    assert.equal(stop.arm(request, payload), null);
    assert.deepEqual(fs.readFileSync(fixture.receipt), bytes);
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
      ['--tdd-begin', '--tdd-complete'].map(flag => ({ flag, session: sessionId })));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('public evidence omits nested private reasoning while preserving public tool arguments', () => {
  const rows = [{ step_index: 0, content: 'public', thinking: 'private',
    metadata: { reasoning: 'nested private', useful: 'retained' },
    tool_calls: [{ name: 'view_file', args: { AbsolutePath: '/owned/file' }, thought: 'private' }] }];
  const result = publicRows(rows);
  assert.deepEqual(result, [{ step_index: 0, content: 'public', metadata: { useful: 'retained' },
    tool_calls: [{ name: 'view_file', args: { AbsolutePath: '/owned/file' } }] }]);
  assert.equal(rows[0].thinking, 'private', 'the native source is not mutated');
});

function agentFixture() {
  const pluginRoot = path.resolve(__dirname, '../..'), workspace = '/private/tmp/own-agent-fixture';
  const runtimeDigest = require('../../hooks/lib/session-control-core-v1.js').computeRuntimeDigest(pluginRoot, 'native');
  const expected = ['left', 'right'].map(role => ({ role, prompt: `Read exactly ${role}` }));
  const children = [otherId, '33333333-3333-4333-8333-333333333333'];
  return { workspace, pluginRoot, expected, run: { nativeSessionId: sessionId,
    nativeEvidence: { verified: true, sessionId, workspace, pluginRoot, runtimeDigest },
    transcriptRows: expected.flatMap((entry, index) => [
      { step_index: index * 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [{
        name: 'invoke_subagent', args: { TypeName: 'zensu-review-aspect', Role: entry.role,
          Prompt: entry.prompt, Workspace: 'inherit', Model: 'inherit' },
      }] },
      { step_index: index * 2 + 1, type: 'GENERIC', source: 'MODEL', status: 'DONE',
        content: 'Created the following subagent:\n' + JSON.stringify({
          conversationId: children[index], workspaceUris: [pathToFileURL(workspace).href],
        }) + '\nThe subagent will send you a message when finished.' },
    ]),
  } };
}

test('actual ordered flat parent requests and singular results identify two distinct fixture children', () => {
  const result = nativeAgentTranscriptIdentities(agentFixture());
  assert.equal(result.parentId, sessionId);
  assert.deepEqual(result.spawned.map(child => [child.role, child.requestStep, child.resultStep]),
    [['left', 0, 1], ['right', 2, 3]]);
  assert.equal(new Set(result.spawned.map(child => child.conversation_id)).size, 2);
});

test('interactive child parser rejects forged binding, drifted prompts and incomplete native results', () => {
  for (const mutate of [
    f => { f.run.nativeEvidence.verified = false; },
    f => { f.run.nativeEvidence.sessionId = otherId; },
    f => { f.run.nativeEvidence.workspace += '/foreign'; },
    f => { f.run.nativeEvidence.pluginRoot += '/foreign'; },
    f => { f.run.nativeEvidence.runtimeDigest = 'sha256:' + '0'.repeat(64); },
    f => { f.run.transcriptRows.reverse(); },
    f => { f.run.transcriptRows[1].step_index = 0; },
    f => { f.run.transcriptRows[0].status = 'IN_PROGRESS'; },
    f => { f.run.transcriptRows[0].tool_calls[0].args.Subagents = []; },
    f => { f.run.transcriptRows[0].tool_calls[0].args.Prompt = 'Different'; },
    f => { f.run.transcriptRows[0].tool_calls[0].args.Role = 'unknown'; },
    f => { f.run.transcriptRows[0].tool_calls[0].args.Workspace = 'share'; },
    f => { f.run.transcriptRows[0].tool_calls[0].args.Model = 'another'; },
    f => { f.run.transcriptRows[0].tool_calls.push({ name: 'view_file', args: {} }); },
    f => { f.run.transcriptRows[1].status = 'ERROR'; },
    f => { f.run.transcriptRows[1].source = 'USER_EXPLICIT'; },
    f => { f.run.transcriptRows[1].content = 'Created the following subagent:\n{"conversationId":"invented"}'; },
    f => { f.run.transcriptRows[1].content = f.run.transcriptRows[1].content.replace('file:///private/tmp/own-agent-fixture', 'file:///foreign'); },
    f => { f.run.transcriptRows[3].content = f.run.transcriptRows[1].content; },
    f => { f.run.transcriptRows.pop(); },
  ]) {
    const value = agentFixture(); mutate(value);
    assert.throws(() => nativeAgentTranscriptIdentities(value));
  }
});

test('two flat calls in one model response retain separate exact native result steps', () => {
  const value = agentFixture(), rows = value.run.transcriptRows;
  rows[0].tool_calls.push(rows[2].tool_calls[0]);
  rows.splice(2,1); rows[2].step_index = 2;
  const result = nativeAgentTranscriptIdentities(value);
  assert.deepEqual(result.spawned.map(child => [child.role,child.requestStep,child.resultStep]),
    [['left',0,1],['right',0,2]]);
  for (const mutate of [
    f => { f.run.transcriptRows[0].tool_calls.push(f.run.transcriptRows[0].tool_calls[0]); },
    f => { f.run.transcriptRows[0].tool_calls[1].name = 'view_file'; },
    f => { f.run.transcriptRows[0].tool_calls[1].args.Prompt = 'Different'; },
    f => { f.run.transcriptRows[2].content = f.run.transcriptRows[1].content; },
    f => { f.run.transcriptRows[2].step_index = 3; },
    f => { f.run.transcriptRows[2].status = 'IN_PROGRESS'; },
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => nativeAgentTranscriptIdentities(changed));
  }
});

test('rules proof accepts real interactive final text only with matching tool-free native identity', () => {
  const workspace = '/private/tmp/rules-fixture', pluginRoot = '/private/tmp/frozen-plugin';
  const rows = fixture().rows, log = `workspace ${workspace} conversation ${sessionId}`;
  const run = { exit_code: 0, stdout: 'READY', nativeSessionId: sessionId, nativeEvidence: {
    verified: true, workspace, pluginRoot, sessionId, runtimeDigest: 'sha256:' + 'a'.repeat(64),
  } };
  const check = value => successRunProof(value, log, rows, workspace, prompt, 'READY', pluginRoot);
  assert.equal(check(run), sessionId);
  for (const mutate of [
    f => { f.exit_code = 1; }, f => { f.signal = 'SIGTERM'; },
    f => { f.spawn_error = 'timeout'; }, f => { f.stdout = '{"status":"SUCCESS","response":"READY"}'; },
    f => { f.nativeEvidence.verified = false; }, f => { f.nativeEvidence.sessionId = otherId; },
    f => { f.nativeEvidence.workspace = '/foreign'; }, f => { f.nativeEvidence.pluginRoot = '/foreign'; },
    f => { delete f.nativeEvidence; }, f => { f.nativeEvidence.runtimeDigest = 'invented'; },
  ]) {
    const value = structuredClone(run); mutate(value); assert.equal(check(value), null);
  }
  rows[1].tool_calls = [{ name: 'view_file', args: { AbsolutePath: '/file' } }];
  assert.equal(check(run), null);
});

test('without a controlling terminal the bridge refuses before launching the native executable', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-no-tty-')));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    const marker = path.join(root, 'must-not-launch');
    fs.writeFileSync(path.join(root, 'bin/agy'), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o700 });
    const specFile = path.join(root, 'request.json');
    fs.writeFileSync(specFile, JSON.stringify({ runDir: root, ws: root, argv: [], seconds: 1 }));
    const result = spawnSync('python3', [path.resolve(__dirname, '../../evals/promptfoo/lib/agy-interactive-pty.py'), specFile],
      { detached: true, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(marker), false);
    const transport = JSON.parse(fs.readFileSync(path.join(root, 'transport.json'), 'utf8'));
    assert.deepEqual(transport.automaticInputs, []);
    assert.equal(transport.operatorBytes, 0);
    assert.notEqual(transport.reason, 'completed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PTY bridge relays explicit one-time keys and only generates exit after stable proof', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-relay-')));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin/agy'), `#!/usr/bin/env python3
import json,os,pathlib,sys,tty
p=pathlib.Path.cwd()
tty.setraw(sys.stdin.fileno())
print("CONFIRM_ONE_TIME",flush=True)
first=os.read(sys.stdin.fileno(),1).decode()
(p/"first.json").write_text(json.dumps(first))
if first!="y": sys.exit(8)
print("CONFIRM_ONE_TIME_ENTER",flush=True)
confirmation=os.read(sys.stdin.fileno(),1).decode()
(p/"confirmation.json").write_text(json.dumps(confirmation))
if confirmation!="\\r": sys.exit(10)
print("ONE_TIME_ACCEPTED",flush=True)
second=""
while not second.endswith("\\r"):
 second+=os.read(sys.stdin.fileno(),1).decode()
(p/"second.json").write_text(json.dumps(second))
sys.exit(0 if second=="/exit\\r" else 9)
`, { mode: 0o700 });
    const observer = path.join(root, 'observer.js');
    fs.writeFileSync(observer, `const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.argv[2]));
const done=fs.existsSync(s.ws+'/confirmation.json');
process.stdout.write(JSON.stringify(done?{verified:true,sessionId:'fixture-only',completion:{transcriptHash:'same',decisionsHash:'same'}}:{verified:false}));`);
    const specFile = path.join(root, 'request.json');
    fs.writeFileSync(specFile, JSON.stringify({ runDir: root, ws: root, argv: [], seconds: 8,
      node: process.execPath, observer }));
    const controller = path.join(root, 'controller.py');
    fs.writeFileSync(controller, `import fcntl,json,os,pathlib,pty,select,signal,subprocess,sys,termios,time
root=pathlib.Path(sys.argv[1])
master,slave=pty.openpty()
def attach():
 os.setsid()
 fcntl.ioctl(slave,termios.TIOCSCTTY,0)
child=subprocess.Popen([sys.executable,sys.argv[2],str(root/"request.json")],stdin=slave,stdout=slave,stderr=slave,preexec_fn=attach,close_fds=True)
os.close(slave)
seen=b"";sent=False;confirmed=False;refused=False;deadline=time.monotonic()+12
try:
 while child.poll() is None and time.monotonic()<deadline:
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try: data=os.read(master,65536)
   except OSError: break
   if not data: break
   seen+=data
   if b"CONFIRM_ONE_TIME" in seen and not refused:
    os.write(master,b"2\\r");refused=True
   if b"Only y, n, inspected one-time Enter" in seen and not sent:
    os.write(master,b"y");sent=True
   if b"CONFIRM_ONE_TIME_ENTER" in seen and not confirmed:
    os.write(master,b"\\r");confirmed=True
 child.wait(timeout=3)
finally:
 if child.poll() is None:
  os.kill(child.pid,signal.SIGINT);child.wait(timeout=7)
 os.close(master)
(root/"controller.json").write_text(json.dumps({"sentOnce":sent,"confirmedOnce":confirmed,"exit":child.returncode}))
sys.exit(0 if sent and confirmed and child.returncode==0 else 1)
`);
    const result = spawnSync('python3', [controller, root, path.resolve(__dirname, '../../evals/promptfoo/lib/agy-interactive-pty.py')],
      { detached: true, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, timeout: 20000 });
    const transportPath = path.join(root, 'transport.json');
    assert.equal(result.status, 0, result.stderr + (fs.existsSync(transportPath) ? fs.readFileSync(transportPath, 'utf8') : ''));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'first.json'), 'utf8')), 'y');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'confirmation.json'), 'utf8')), '\r');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'second.json'), 'utf8')), '/exit\r');
    const transport = JSON.parse(fs.readFileSync(path.join(root, 'transport.json'), 'utf8'));
    assert.equal(transport.operatorBytes, 2);
    assert.deepEqual(transport.automaticInputs, ['/exit']);
    assert.equal(transport.reason, 'completed');
    assert.equal(transport.exitCode, 0);
    assert.match(fs.readFileSync(path.join(root, 'terminal.raw'), 'utf8'), /ONE_TIME_ACCEPTED/);
    const inputs = fs.readFileSync(path.join(root, 'operator-input.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(inputs.length, 3);
    assert.equal(inputs[0].refused, true);
    assert.equal(inputs[0].byteCount, 2);
    assert.equal(inputs[1].input, 'y');
    assert.equal(inputs[2].input, '\r');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PTY Stop observation cancels only after stable continuation proof and preserves one-time input', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-relay-')));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin/agy'), `#!/usr/bin/env python3
import json,os,pathlib,sys,tty
p=pathlib.Path.cwd()
tty.setraw(sys.stdin.fileno())
print("CONFIRM_ONE_TIME",flush=True)
first=os.read(sys.stdin.fileno(),1).decode()
(p/"first.json").write_text(json.dumps(first))
if first!="y": sys.exit(8)
print("CONFIRM_ONE_TIME_ENTER",flush=True)
confirmation=os.read(sys.stdin.fileno(),1).decode()
(p/"confirmation.json").write_text(json.dumps(confirmation))
if confirmation!="\\r": sys.exit(10)
print("ONE_TIME_ACCEPTED",flush=True)
second=""
while not second.endswith("\\r"):
 second+=os.read(sys.stdin.fileno(),1).decode()
(p/"second.json").write_text(json.dumps(second))
sys.exit(0 if second=="\\x03/exit\\r" else 9)
`, { mode: 0o700 });
    const observer = path.join(root, 'observer.js');
    fs.writeFileSync(observer, `const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.argv[2]));
const done=fs.existsSync(s.ws+'/confirmation.json');
process.stdout.write(JSON.stringify(done?{verified:true,sessionId:'fixture-only',completion:{kind:'stop-continuation',transcriptHash:'same',decisionsHash:'same'}}:{verified:false}));`);
    const specFile = path.join(root, 'request.json');
    fs.writeFileSync(specFile, JSON.stringify({ runDir: root, ws: root, argv: [], seconds: 10, stopProbe: { fixture: true },
      node: process.execPath, observer }));
    const controller = path.join(root, 'controller.py');
    fs.writeFileSync(controller, `import fcntl,json,os,pathlib,pty,select,signal,subprocess,sys,termios,time
root=pathlib.Path(sys.argv[1])
master,slave=pty.openpty()
def attach():
 os.setsid()
 fcntl.ioctl(slave,termios.TIOCSCTTY,0)
child=subprocess.Popen([sys.executable,sys.argv[2],str(root/"request.json")],stdin=slave,stdout=slave,stderr=slave,preexec_fn=attach,close_fds=True)
os.close(slave)
seen=b"";sent=False;confirmed=False;refused=False;deadline=time.monotonic()+12
try:
 while child.poll() is None and time.monotonic()<deadline:
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try: data=os.read(master,65536)
   except OSError: break
   if not data: break
   seen+=data
   if b"CONFIRM_ONE_TIME" in seen and not refused:
    os.write(master,b"2\\r");refused=True
   if b"Only y, n, inspected one-time Enter" in seen and not sent:
    os.write(master,b"y");sent=True
   if b"CONFIRM_ONE_TIME_ENTER" in seen and not confirmed:
    os.write(master,b"\\r");confirmed=True
 child.wait(timeout=3)
finally:
 if child.poll() is None:
  os.kill(child.pid,signal.SIGINT);child.wait(timeout=7)
 os.close(master)
(root/"controller.json").write_text(json.dumps({"sentOnce":sent,"confirmedOnce":confirmed,"exit":child.returncode}))
sys.exit(0 if sent and confirmed and child.returncode==0 else 1)
`);
    const result = spawnSync('python3', [controller, root, path.resolve(__dirname, '../../evals/promptfoo/lib/agy-interactive-pty.py')],
      { detached: true, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, timeout: 20000 });
    const transportPath = path.join(root, 'transport.json');
    assert.equal(result.status, 0, result.stderr + (fs.existsSync(transportPath) ? fs.readFileSync(transportPath, 'utf8') : ''));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'first.json'), 'utf8')), 'y');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'confirmation.json'), 'utf8')), '\r');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'second.json'), 'utf8')), '\x03/exit\r');
    const transport = JSON.parse(fs.readFileSync(path.join(root, 'transport.json'), 'utf8'));
    assert.equal(transport.operatorBytes, 2);
    assert.deepEqual(transport.automaticInputs, ['cancel-observed-probe', '/exit']);
    assert.equal(transport.reason, 'stop-continuation-observed');
    assert.equal(transport.exitCode, 0);
    assert.match(fs.readFileSync(path.join(root, 'terminal.raw'), 'utf8'), /ONE_TIME_ACCEPTED/);
    const inputs = fs.readFileSync(path.join(root, 'operator-input.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(inputs.length, 3);
    assert.equal(inputs[0].refused, true);
    assert.equal(inputs[0].byteCount, 2);
    assert.equal(inputs[1].input, 'y');
    assert.equal(inputs[2].input, '\r');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PTY timeout preserves owned process identity and signal denial without claiming completion', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-cleanup-')));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin/agy'), `#!/usr/bin/env python3
import os,pathlib,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
signal.signal(signal.SIGHUP,signal.SIG_IGN)
(pathlib.Path.cwd()/"fake-native.pid").write_text(str(os.getpid()))
while True: time.sleep(0.1)
`, { mode: 0o700 });
    const observer = path.join(root, 'observer.js');
    fs.writeFileSync(observer, 'process.stdout.write(JSON.stringify({verified:false,reason:"fixture still pending"}));');
    fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify({ runDir: root, ws: root, argv: [],
      seconds: 1, node: process.execPath, observer }));
    const bridge = path.resolve(__dirname, '../../evals/promptfoo/lib/agy-interactive-pty.py');
    const faultWrapper = path.join(root, 'fault-wrapper.py');
    fs.writeFileSync(faultWrapper, `import errno,importlib.util,json,os,pathlib,signal,sys
root=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("bridge",sys.argv[2])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
real_killpg=os.killpg
def denied_kill(group,number):
 if number==signal.SIGKILL: raise PermissionError(errno.EPERM,"fixture signal denial")
 return real_killpg(group,number)
os.killpg=denied_kill
sys.argv=[sys.argv[2],str(root/"request.json")]
try:
 status=module.main()
finally:
 # Fault injection is fixture-only. Reap the exact fake native child so this
 # test itself leaves no orphan, without changing the bridge's failure record.
 pid=int((root/"fake-native.pid").read_text())
 os.kill(pid,0)
 os.kill(pid,signal.SIGKILL)
 waited,wait_status=os.waitpid(pid,0)
 (root/"fixture-recovery.json").write_text(json.dumps({"pid":waited,"signal":os.WTERMSIG(wait_status)}))
sys.exit(status)
`);
    const controller = path.join(root, 'controller.py');
    fs.writeFileSync(controller, `import fcntl,os,pty,select,signal,subprocess,sys,termios,time
master,slave=pty.openpty()
def attach():
 os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
child=subprocess.Popen([sys.executable,sys.argv[1],sys.argv[2],sys.argv[3]],stdin=slave,stdout=slave,stderr=slave,preexec_fn=attach,close_fds=True)
os.close(slave)
deadline=time.monotonic()+15
try:
 while child.poll() is None and time.monotonic()<deadline:
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try:
    if not os.read(master,65536): break
   except OSError: break
 child.wait(timeout=3)
finally:
 if child.poll() is None:
  os.kill(child.pid,signal.SIGTERM);child.wait(timeout=3)
 os.close(master)
sys.exit(child.returncode)
`);
    const result = spawnSync('python3', [controller, faultWrapper, root, bridge], {
      detached: true, encoding: 'utf8', timeout: 22000,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.signal, null);
    const transport = JSON.parse(fs.readFileSync(path.join(root, 'transport.json'), 'utf8'));
    const nativePid = Number(fs.readFileSync(path.join(root, 'fake-native.pid'), 'utf8'));
    assert.equal(transport.pid, nativePid);
    assert.equal(transport.reason, 'timeout');
    assert.equal(transport.exitCode, null);
    assert.equal(transport.processExitConfirmed, false);
    assert.equal(transport.cleanupError.operation, 'signal-SIGKILL');
    assert.match(transport.cleanupError.error, /PermissionError.*fixture signal denial/);
    assert.deepEqual(transport.automaticInputs, []);
    assert.equal(transport.operatorBytes, 0);
    assert.equal(fs.readFileSync(path.join(root, 'operator-input.jsonl'), 'utf8'), '');
    const recovery = JSON.parse(fs.readFileSync(path.join(root, 'fixture-recovery.json'), 'utf8'));
    assert.equal(recovery.pid, nativePid);
    assert.equal(recovery.signal, 9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('interactive preparation retains the actual 45 scenario IDs and source hashes', () => {
  const catalog = catalogScenarioIds();
  assert.equal(catalog.ids.length, 45);
  assert.equal(new Set(catalog.ids).size, 45);
  assert.equal(catalog.files.length, 4);
  assert.equal(Object.keys(catalog.hashes).length, 5);
  for (const hash of Object.values(catalog.hashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(catalog.ids.includes('live-stop-block-and-resume'));
  assert.ok(catalog.ids.includes('live-native-agent-delegation'));
});

test('preparation creates only 45 exact disposable workspaces without trust or native execution', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-prepare-')));
  const priorPath = process.env.PATH;
  const settingsFile = path.join(os.homedir(), '.gemini/antigravity-cli/settings.json');
  const settingsHash = () => fs.existsSync(settingsFile) ? createHash('sha256').update(fs.readFileSync(settingsFile)).digest('hex') : null;
  const settingsBefore = settingsHash();
  try {
    const pluginRoot = path.join(root, 'frozen', 'zensu');
    fs.mkdirSync(path.join(pluginRoot, 'hooks/antigravity'), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, 'hooks/lib'), { recursive: true });
    for (const file of ['plugin.json', 'hooks.json', 'hooks/antigravity/antigravity-shim.sh', 'hooks/lib/zensu-log.sh']) {
      fs.writeFileSync(path.join(pluginRoot, file), '{}\n');
    }
    const runtimeDigest = 'sha256:' + 'b'.repeat(64);
    fs.writeFileSync(path.join(pluginRoot, 'hooks/lib/session-control-core-v1.js'),
      `exports.computeRuntimeDigest=()=>${JSON.stringify(runtimeDigest)};`);
    fs.mkdirSync(path.join(root, 'bin'));
    const marker = path.join(root, 'must-not-launch');
    fs.writeFileSync(path.join(root, 'bin/agy'), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o700 });
    process.env.PATH = `${root}/bin:${priorPath}`;
    const value = prepare(pluginRoot, root);
    assert.equal(value.scenarioCount, 45);
    assert.equal(value.trustChanged, false);
    assert.equal(value.nativeStarted, false);
    assert.equal(value.runtimeDigest, runtimeDigest);
    assert.equal(settingsHash(), settingsBefore);
    assert.equal(fs.existsSync(marker), false);
    const manifest = JSON.parse(fs.readFileSync(value.manifest, 'utf8'));
    assert.equal(manifest.schema, 'zensu-live-workspaces-v1');
    assert.equal(new Set(manifest.entries.map(entry => entry.workspace)).size, 45);
    assert.deepEqual(manifest.entries.map(entry => entry.scenarioId), catalogScenarioIds().ids);
    for (const { workspace } of manifest.entries) {
      assert.equal(fs.realpathSync(workspace), workspace);
      assert.equal(path.dirname(workspace), path.join(value.evidenceDir, 'workspaces'));
      assert.match(path.basename(workspace), /^zensu-live-[a-f0-9]+$/);
      assert.deepEqual(fs.readdirSync(workspace).sort(), ['.agents', 'note.txt']);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, '.agents/plugins.json'), 'utf8')),
        { entries: [{ path: path.dirname(pluginRoot), include_only: ['zensu'] }] });
    }
    const provider = path.resolve(__dirname, '../../evals/promptfoo/lib/agy-live-provider.js');
    const claimed = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
      const provider = require(process.argv[1]), entries = JSON.parse(process.argv[2]);
      const stage = process.env.ZENSU_LIVE_PLUGIN_ROOT;
      for (const entry of entries.slice(0, 2)) {
        const ws = provider.makeWorkspace(undefined, entry.scenarioId);
        const installed = provider.installedPluginRoot();
        assert.equal(installed, path.join(ws, '.agents/plugins/zensu'));
        assert.notEqual(installed, stage);
        assert.deepEqual(fs.readFileSync(path.join(installed, 'hooks.json')), fs.readFileSync(path.join(stage, 'hooks.json')));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ws, '.agents/plugins.json'))),
          { entries: [{ path: path.dirname(installed), include_only: ['zensu'] }] });
      }
      fs.symlinkSync(path.join(stage, 'hooks.json'), path.join(stage, 'unsafe-link'));
      assert.throws(() => provider.makeWorkspace(undefined, entries[2].scenarioId), /symbolic link/);
      assert.equal(fs.existsSync(path.join(entries[2].workspace, '.agents/plugins/zensu')), false);
      fs.unlinkSync(path.join(stage, 'unsafe-link'));
      console.log('local copies verified; unsafe stage refused');
    `, provider, JSON.stringify(manifest.entries)], {
      env: { ...process.env, ...value.env }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.match(claimed.stdout, /local copies verified; unsafe stage refused/);
    assert.equal(settingsHash(), settingsBefore);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preparation refuses duplicated, incomplete or escaping scenario catalogs', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-interactive-catalog-')));
  try {
    fs.mkdirSync(path.join(root, 'scenarios'));
    const config = path.join(root, 'promptfooconfig.yaml'), catalog = path.join(root, 'scenarios/test.yaml');
    fs.writeFileSync(config, 'tests:\n  - file://scenarios/test.yaml\n');
    const rows = Array.from({ length: 45 }, (_, index) => ({ vars: { scenario_id: `fixture-${index}` } }));
    fs.writeFileSync(catalog, JSON.stringify(rows));
    assert.equal(catalogScenarioIds(root).ids.length, 45);
    fs.writeFileSync(catalog, JSON.stringify(rows.slice(1)));
    assert.throws(() => catalogScenarioIds(root), /45/);
    fs.writeFileSync(catalog, JSON.stringify([...rows.slice(1), rows[1]]));
    assert.throws(() => catalogScenarioIds(root), /Duplicate/);
    fs.writeFileSync(config, 'tests:\n  - file://scenarios/test.yaml\n  - file://scenarios/test.yaml\n');
    assert.throws(() => catalogScenarioIds(root), /repeats/);
    fs.writeFileSync(config, 'tests:\n  - file://../outside.yaml\n');
    assert.throws(() => catalogScenarioIds(root), /unsupported/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
