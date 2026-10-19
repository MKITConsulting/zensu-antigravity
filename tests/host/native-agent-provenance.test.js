'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { pathToFileURL } = require('node:url');
const api = require('../../hooks/antigravity/native-agent-provenance.js');
function fixture(t, filename = 'transcript.jsonl') {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-native-provenance-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parent = crypto.randomUUID(), child = crypto.randomUUID(), sibling = crypto.randomUUID();
  const workspace = path.join(tmp, 'workspace'), data = path.join(tmp, 'data'), brain = path.join(tmp, 'brain');
  for (const dir of [workspace, data, brain]) fs.mkdirSync(dir, { mode: 0o700 });
  const transcript = (session) => path.join(brain, session, '.system_generated', 'logs', filename);
  const writeRows = (session, rows) => {
    const file = transcript(session); fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    fs.writeFileSync(file, bytes);
    if (filename === 'transcript_full.jsonl') fs.writeFileSync(path.join(path.dirname(file), 'transcript.jsonl'), bytes);
  };
  const prompt = 'Read the approved evidence and report exact findings.', role = 'Correctness reviewer';
  const descriptor = { TypeName: 'zensu-review-aspect', Role: role, Prompt: prompt, Model: 'inherit', Workspace: 'inherit' };
  const parentRows = [{ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content: 'Review the fixture.' },
    { step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [
      { name: 'invoke_subagent', args: { Subagents: JSON.stringify([descriptor]) } }] },
    { step_index: 3, type: 'GENERIC', source: 'MODEL', status: 'DONE', content: 'Created the following subagents:\n'
      + JSON.stringify({ conversationId: child, logAbsoluteUri: pathToFileURL(path.join(path.dirname(transcript(child)), 'transcript.jsonl')).href,
        workspaceUris: [pathToFileURL(workspace).href] }) + '\nThe subagents will send you a message.' }];
  const childRows = [{ step_index: 0, source: 'SYSTEM_SDK', type: 'EPHEMERAL_MESSAGE', status: 'DONE', content: 'Bootstrap pending.' },
    { step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', content: 'Host message\n<SYSTEM_MESSAGE>\n'
      + `[Message] timestamp=2026-10-18T21:10:07Z sender=${parent} priority=MESSAGE_PRIORITY_HIGH content=${prompt}\n</SYSTEM_MESSAGE>` },
    { step_index: 5, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: '{"findings":[]}' }];
  writeRows(parent, parentRows); writeRows(child, childRows);
  const sidecarFile = path.join(brain, parent, '.system_generated', 'subagents', `${child}.json`);
  const sidecar = { conversationId: child, subagentDescriptor: { typeName: descriptor.TypeName, role },
    state: 'SUBAGENT_STATE_ALIVE', spawnStepIndex: 3, workspaceUris: [pathToFileURL(workspace).href] };
  fs.mkdirSync(path.dirname(sidecarFile), { recursive: true }); fs.writeFileSync(sidecarFile, JSON.stringify(sidecar));
  const binding = { projectRoot: workspace, pluginRoot: path.join(tmp, 'plugin'), sessionKey: 'parent-key', context: { runtime_digest: 'digest-fixture' } };
  const options = { pluginData: data, now: 100000, computeTree: () => ({ tree: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    binder: { resolveHookSession: (payload) => { assert.equal(payload.session_id, parent); return binding; } } };
  const parentPayload = { session_id: parent, workspace_root: workspace, transcript_path: transcript(parent),
    step_idx: 3, native_tool_name: 'invoke_subagent', native_tool_input: { Subagents: [descriptor] }, tool_name: 'invoke_subagent' };
  const childPayload = { session_id: child, workspace_root: workspace, cwd: workspace, transcript_path: transcript(child), tool_name: 'Read', tool_input: {} };
  return { tmp, parent, child, sibling, workspace, data, brain, transcript, writeRows, parentRows, childRows,
    descriptor, sidecar, sidecarFile, binding, options, parentPayload, childPayload,
    authorize: () => api.authorizeLaunch(parentPayload, options) };
}
test('accepted launch correlates immutable native child and final response', (t) => {
  for (const filename of ['transcript.jsonl', 'transcript_full.jsonl']) {
  const f = fixture(t, filename); f.authorize(); const prepared = api.prepare(f.childPayload, f.options);
  assert.equal(prepared.status, 'child'); assert.equal(prepared.skipMainLifecycle, true);
  assert.equal(prepared.payload.session_id, f.parent); assert.equal(prepared.payload.host_session_id, f.child);
  assert.equal(prepared.payload.agent_type, 'zensu-review-aspect');
  assert.equal(prepared.provenance.sourceTree, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const final = api.latestChildResponse(f.childPayload, f.options);
  assert.equal(final.text, '{"findings":[]}'); assert.equal(final.stepIndex, 5);
  assert.deepEqual(final.tool_calls, []); assert.equal(final.provenance.runtimeDigest, 'digest-fixture');
  assert.deepEqual(api.prepare(f.childPayload, f.options), prepared);
  for (const wrong of [f.childPayload.transcript_path.replace(f.child, f.sibling),
    path.join(path.dirname(f.childPayload.transcript_path), 'unrelated.jsonl')]) {
    assert.equal(api.prepare({ ...f.childPayload, transcript_path: wrong }, f.options).status, 'deny');
  }
  }
});
test('a native child without an accepted receipt cannot fall back to main', (t) => {
  const f = fixture(t); const result = api.prepare(f.childPayload, f.options);
  assert.equal(result.status, 'deny'); assert.equal(result.skipMainLifecycle, true);
});
test('empty first invocation is pending and does not manufacture a main principal', (t) => {
  const f = fixture(t); f.writeRows(f.child, f.childRows.slice(0, 1));
  assert.equal(api.prepare(f.childPayload, f.options).status, 'pending');
  assert.equal(fs.existsSync(path.join(f.data, 'session-control')), false);
});
test('explicit main stays main after receiving child messages', (t) => {
  const f = fixture(t); f.parentRows.push({ ...f.childRows[1], step_index: 6 }); f.writeRows(f.parent, f.parentRows);
  assert.equal(api.prepare(f.parentPayload, f.options).status, 'main');
});
function assertRefusedBeforeChildAuthority(t, mutate) {
  const f = fixture(t); f.authorize(); mutate(f); assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
}
test('forged initial prompt is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.childRows[1].content += 'tampered'; f.writeRows(f.child, f.childRows); });
});
test('wrong role is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.sidecar.subagentDescriptor.role = 'Other role'; fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar)); });
});
test('wrong parent actual invocation is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.parentRows[1].tool_calls[0].args.Subagents = JSON.stringify([{ ...f.descriptor, Prompt: 'Different' }]); f.writeRows(f.parent, f.parentRows); });
});
test('unmatched actual child result is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.parentRows[2].content = f.parentRows[2].content.replaceAll(f.child, f.sibling); f.writeRows(f.parent, f.parentRows); });
});
test('changed runtime binding is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.binding.context.runtime_digest = 'changed'; });
});
test('wrong workspace is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.sidecar.workspaceUris = [pathToFileURL(f.tmp).href]; fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar)); });
});
test('expired accepted launch is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { f.options.now += 24 * 60 * 60 * 1000 + 1; });
});
test('sidecar symlink is refused before child authority', (t) => {
  assertRefusedBeforeChildAuthority(t, (f) => { const moved = `${f.sidecarFile}.real`; fs.renameSync(f.sidecarFile, moved); fs.symlinkSync(moved, f.sidecarFile); });
});
test('duplicate role names and changed dispatch step ownership are rejected', (t) => {
  const f = fixture(t); f.parentPayload.native_tool_input.Subagents.push(f.descriptor);
  assert.throws(() => f.authorize(), /unique/); f.parentPayload.native_tool_input.Subagents.pop();
  f.authorize(); f.parentPayload.native_tool_input.Subagents[0].Prompt = 'Changed';
  assert.throws(() => f.authorize(), /different invocation/);
});
test('nested dispatch and noninherit model/workspace are rejected', (t) => {
  const f = fixture(t);
  assert.throws(() => api.inspectLaunch({ ...f.parentPayload, agent_id: f.child }), /cannot dispatch/);
  for (const entry of [{ Model: 'pro' }, { Workspace: 'share' }, { TypeName: '../outside' },
    ...[false, null, 0, ''].flatMap(value => [{ Model: value }, { Workspace: value }])]) {
    assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: { Subagents: [{ ...f.descriptor, ...entry }] } }));
  }
});
test('tool-bearing or incomplete child response is not a completed handback', (t) => {
  const f = fixture(t); f.authorize(); f.childRows[2].tool_calls = [{ name: 'send_message' }]; f.writeRows(f.child, f.childRows);
  assert.throws(() => api.latestChildResponse(f.childPayload, f.options), /terminal/);
  delete f.childRows[2].tool_calls; f.childRows[2].status = 'ACTIVE'; f.writeRows(f.child, f.childRows);
  assert.throws(() => api.latestChildResponse(f.childPayload, f.options), /terminal/);
});
test('verified child cannot become main after a new explicit message', (t) => {
  const f = fixture(t); f.authorize(); assert.equal(api.prepare(f.childPayload, f.options).status, 'child');
  f.childRows.push({ step_index: 6, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content: 'Continue.' });
  f.writeRows(f.child, f.childRows); assert.equal(api.prepare(f.childPayload, f.options).status, 'child');
});
test('only a verified parent recipient becomes the canonical handback tool', (t) => {
  const f = fixture(t); f.authorize();
  const payload = { ...f.childPayload, tool_name: 'send_message', native_tool_name: 'send_message',
    native_tool_input: { Recipient: f.parent, Message: 'Complete.', toolAction: 'Sending result' } };
  const accepted = api.prepare(payload, f.options);
  assert.equal(accepted.payload.tool_name, 'SubagentHandback');
  assert.deepEqual(accepted.payload.tool_input, { message: 'Complete.' });
  payload.native_tool_input.Recipient = f.sibling;
  assert.equal(api.prepare(payload, f.options).payload.tool_name, 'send_message');
  assert.equal(api.prepare({ ...f.childPayload, tool_name: 'manage_task', native_tool_name: 'manage_task' }, f.options).payload.tool_name, 'manage_task');
});
test('native read arguments and Stop facts survive normalization without fabricated defaults', () => {
  const { normalize } = require('../../hooks/antigravity/normalize-payload.js');
  const base = { conversationId: crypto.randomUUID(), workspacePaths: ['/fixture'] };
  const grep = normalize({ ...base, toolCall: { name: 'grep_search', args: {
    SearchPath: '/fixture/evidence', Query: 'pattern', Includes: ['*.js', '../escape'] } } }, '', { correlate: false });
  assert.equal(grep.native_payload, true); assert.equal(grep.host_session_id, base.conversationId);
  assert.deepEqual(grep.tool_input, { path: '/fixture/evidence', pattern: 'pattern', include: ['*.js', '../escape'] });
  assert.equal(grep.native_tool_input.SearchPath, '/fixture/evidence');
  const glob = normalize({ ...base, toolCall: { name: 'find_by_name', args: {
    SearchDirectory: '/fixture/evidence', Pattern: '**/*.js', Excludes: ['vendor/*'] } } }, '', { correlate: false });
  assert.deepEqual(glob.tool_input, { path: '/fixture/evidence', pattern: '**/*.js', exclude: ['vendor/*'] });
  const stop = normalize({ ...base, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', executionNum: 2 }, 'Stop', { correlate: false });
  assert.equal(stop.fully_idle, true); assert.equal(stop.termination_reason, 'NO_TOOL_CALL'); assert.equal(stop.execution_num, 2);
  const absent = normalize(base, 'Stop', { correlate: false });
  assert.equal(Object.hasOwn(absent, 'fully_idle'), false); assert.equal(Object.hasOwn(absent, 'termination_reason'), false);
  assert.equal(Object.hasOwn(normalize({ session_id: 'fixture' }, '', { correlate: false }), 'native_payload'), false);
});
test('only an explicit nongit tree result may omit the source tree snapshot', (t) => {
  const f = fixture(t);
  f.options.computeTree = () => ({ tree: null, reason: 'snapshot failed' });
  assert.throws(() => f.authorize(), /snapshot is unavailable/);
  f.options.computeTree = () => ({ tree: null, reason: 'not a git work tree' });
  f.authorize(); assert.equal(api.prepare(f.childPayload, f.options).provenance.sourceTree, null);
});
function assertAuthenticatedNonMainPrincipal(t, typeName) {
  const f = fixture(t);
  f.descriptor.TypeName = typeName;
  f.parentRows[1].tool_calls[0].args.Subagents = JSON.stringify([f.descriptor]);
  f.writeRows(f.parent, f.parentRows);
  f.sidecar.subagentDescriptor.typeName = typeName;
  fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
  f.authorize();
  const child = api.prepare(f.childPayload, f.options);
  assert.equal(child.status, 'child'); assert.equal(child.payload.agent_type, typeName);
  assert.equal(child.provenance.readOnlyProfile, typeName === 'zensu-plm');
  assert.equal(child.payload.session_id, f.parent); assert.equal(child.payload.agent_id, f.child);
}
test('authenticated zensu-plm preserves its exact non-main principal', (t) => {
  assertAuthenticatedNonMainPrincipal(t, 'zensu-plm');
});
test('authenticated custom-native-auditor preserves its exact non-main principal', (t) => {
  assertAuthenticatedNonMainPrincipal(t, 'custom-native-auditor');
});
test('verified native child uses the real read-only gate and actual Stop result collector', (t) => {
  const f = fixture(t), pluginRoot = path.resolve(__dirname, '../..');
  const git = (args) => {
    const result = cp.spawnSync('git', args, { cwd: f.workspace, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  fs.writeFileSync(path.join(f.workspace, '.gitignore'), '.zensu/\n');
  fs.writeFileSync(path.join(f.workspace, 'source.txt'), 'Reviewed source.\n');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'test: native child fixture']);
  require('../../hooks/antigravity/session-bootstrap.js').bootstrap({ session_id: f.parent, workspace_root: f.workspace },
    { pluginRoot, pluginData: f.data });
  f.options.pluginRoot = pluginRoot;
  f.options.binder = require('../../hooks/lib/runtime-hook-session-v1.js');
  f.options.computeTree = require('../../hooks/lib/evidence-run-v1.js').computeTree;
  f.authorize();
  const child = api.prepare(f.childPayload, f.options);
  assert.equal(child.status, 'child', child.reason);
  const gate = (tool, input) => {
    const result = cp.spawnSync('bash', [path.join(pluginRoot, 'hooks/pre-reviewer-capability-gate.sh')], {
      cwd: f.workspace, env: { ...process.env, ZENSU_PLUGIN_ROOT: pluginRoot, ZENSU_PLUGIN_DATA: f.data },
      input: JSON.stringify({ ...child.payload, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }),
      encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? JSON.parse(result.stdout) : {};
  };
  const allowedRead = gate('Read', { file_path: path.join(f.workspace, 'source.txt') });
  assert.notEqual(allowedRead.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(allowedRead));
  assert.notEqual(gate('SubagentHandback', { message: 'Reviewed.' }).hookSpecificOutput?.permissionDecision, 'deny');
  for (const [tool, input] of [
    ['Write', { file_path: path.join(f.workspace, 'source.txt'), content: 'Forbidden.' }],
    ['Bash', { command: 'printf forbidden' }], ['send_message', { recipient: f.sibling, message: 'Forbidden.' }],
    ['manage_task', { Action: 'kill', TaskId: 'another-task' }],
    ['Read', { file_path: path.join(f.data, 'session-control/v1/records', 'private.json') }],
  ]) assert.equal(gate(tool, input).hookSpecificOutput?.permissionDecision, 'deny', tool);
  const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
  assert.equal(lifecycle.stopChild({ ...f.childPayload, termination_reason: 'USER_CANCELED', fully_idle: true }, f.options).captured, false);
  assert.equal(lifecycle.stopChild({ ...f.childPayload, termination_reason: 'NO_TOOL_CALL' }, f.options).status, 'pending');
  const completed = lifecycle.stopChild({ ...f.childPayload, termination_reason: 'NO_TOOL_CALL', fully_idle: true, execution_num: 1 }, f.options);
  assert.equal(completed.status, 'completed');
  const result = lifecycle.completedChild(f.parent, f.child, f.options);
  assert.equal(result.finalText, '{"findings":[]}');
  assert.equal(result.descriptor.typeName, 'zensu-review-aspect');
  assert.equal(result.sourceTree, child.provenance.sourceTree);
  assert.equal(result.observedStop.responseStep, 5);
});
