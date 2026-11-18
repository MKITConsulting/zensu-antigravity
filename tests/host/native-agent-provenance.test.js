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
test('single-descriptor launches retain exact parent, role and completion binding', (t) => {
  const f = fixture(t);
  f.parentPayload.native_tool_input = { ...f.descriptor };
  f.parentRows[1].tool_calls[0].args = { ...f.descriptor };
  f.parentRows[2].content = f.parentRows[2].content.replace('following subagents:', 'following subagent:');
  f.writeRows(f.parent, f.parentRows);
  const receipt = f.authorize().receipt;
  assert.equal(receipt.entries.length, 1);
  assert.equal(receipt.entries[0].prompt, f.descriptor.Prompt);
  const child = api.prepare(f.childPayload, f.options);
  assert.equal(child.status, 'child');
  assert.equal(child.provenance.parentSessionId, f.parent);
  assert.equal(child.provenance.childSessionId, f.child);
  assert.equal(api.latestChildResponse(f.childPayload, f.options).text, '{"findings":[]}');
  f.parentRows[1].tool_calls[0].args.Role = 'Unaccepted role';
  f.writeRows(f.parent, f.parentRows);
  assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
});
test('single dispatch rejects mixed, extra, missing and noninherit selectors', (t) => {
  const f = fixture(t);
  for (const args of [null, [], {}, { ...f.descriptor, Subagents: [f.descriptor] },
    { Subagents: [f.descriptor], unexpected: true }, { ...f.descriptor, unexpected: true },
    { ...f.descriptor, Prompt: '' }, { ...f.descriptor, Model: 'other' },
    { ...f.descriptor, Workspace: 'other' }]) {
    assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: args }));
  }
  assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: f.descriptor, agent_id: f.child }), /cannot dispatch/);
  const child = JSON.stringify({ conversationId: f.child });
  assert.throws(() => api.spawnedChildren(`Created the following subagent:\n${child}\n${child}`), /count/);
  assert.throws(() => api.spawnedChildren(`Created the following subagent:\n${child}\nCreated the following subagents:\n${child}`), /ambiguous/);
});
test('multi-call sidecar drift binds only the exact child result and accepted role', (t) => {
  const f = fixture(t);
  f.parentPayload.native_tool_input = { ...f.descriptor };
  f.parentRows[1].tool_calls = [
    { name: 'invoke_subagent', args: { ...f.descriptor } },
    { name: 'invoke_subagent', args: { ...f.descriptor, Role: 'Other reviewer', Prompt: 'Different evidence' } },
  ];
  f.parentRows[2].content = f.parentRows[2].content.replace('following subagents:', 'following subagent:');
  f.writeRows(f.parent, f.parentRows);
  f.sidecar.spawnStepIndex = 4;
  fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
  f.authorize();
  const child = api.prepare(f.childPayload, f.options);
  assert.equal(child.status, 'child');
  assert.equal(child.provenance.spawnStepIndex, 3);
  assert.equal(child.provenance.childSessionId, f.child);
  assert.equal(child.provenance.role, f.descriptor.Role);
  for (const invalidStep of [2, 5, 999]) {
    fs.writeFileSync(f.sidecarFile, JSON.stringify({ ...f.sidecar, spawnStepIndex: invalidStep }));
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
  fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
  const original = structuredClone(f.parentRows);
  for (const mutate of [
    rows => rows[1].tool_calls.reverse(),
    rows => { rows[1].tool_calls[1].args.Role = f.descriptor.Role; },
    rows => { rows[1].tool_calls[0].args.Prompt = 'Other prompt'; },
    rows => { rows[1].tool_calls[0].args = { Subagents: [f.descriptor] }; },
    rows => rows.push({ ...rows[2], step_index: 4 }),
  ]) {
    const rows = structuredClone(original); mutate(rows); f.writeRows(f.parent, rows);
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
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

function useFlatArguments(f) {
  f.parentPayload.native_tool_input = { ...f.descriptor };
  f.parentRows[1].tool_calls[0].args = { ...f.descriptor };
  f.writeRows(f.parent, f.parentRows);
  return f;
}
test('flat native arguments and the legacy batch produce the same bounded descriptor without rewriting host input', (t) => {
  const f = fixture(t);
  const batch = api.inspectLaunch(f.parentPayload);
  useFlatArguments(f);
  const before = JSON.stringify(f.parentPayload);
  const flat = api.inspectLaunch(f.parentPayload);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat.map(({ canonicalPayload, ...entry }) => entry),
    batch.map(({ canonicalPayload, ...entry }) => entry));
  assert.deepEqual(flat[0].canonicalPayload.tool_input, batch[0].canonicalPayload.tool_input);
  assert.equal(JSON.stringify(f.parentPayload), before);
  assert.deepEqual(flat[0].canonicalPayload.native_tool_input, f.descriptor);
});
test('native dispatch refuses mixed forms and unknown wrapper or descriptor fields', (t) => {
  const f = fixture(t);
  for (const input of [
    { ...f.descriptor, Subagents: [f.descriptor] },
    { Subagents: [f.descriptor], Extra: true },
    { Subagents: [f.descriptor], Prompt: f.descriptor.Prompt },
    { ...f.descriptor, Extra: true },
    { Subagents: [{ ...f.descriptor, Extra: true }] },
  ]) assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: input }), /unsupported|mixed/);
});
test('flat and batch descriptors retain required fields and inheritance checks', (t) => {
  const f = fixture(t);
  const bad = [
    ...['TypeName', 'Role', 'Prompt'].flatMap(key => [undefined, null, '', false].map(value => ({ ...f.descriptor, [key]: value }))),
    ...['Model', 'Workspace'].flatMap(key => [null, false, '', 'other'].map(value => ({ ...f.descriptor, [key]: value }))),
    { ...f.descriptor, TypeName: '../outside' }, { ...f.descriptor, Role: 'line\nbreak' },
    { ...f.descriptor, Prompt: 'embedded\0byte' },
  ];
  for (const entry of bad) {
    for (const input of [entry, { Subagents: [entry] }]) {
      assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: input }));
    }
  }
  for (const input of [null, [], 'invalid', {}, { Subagents: null }, { Subagents: {} },
    { Subagents: [] }, { Subagents: '[invalid' }, { Subagents: Array(17).fill(f.descriptor) }]) {
    assert.throws(() => api.inspectLaunch({ ...f.parentPayload, native_tool_input: input }));
  }
});
test('accepted flat launch retains packet admission and exact actual child provenance', (t) => {
  const f = useFlatArguments(fixture(t, 'transcript_full.jsonl'));
  let checked = 0;
  f.options.validateReviewLaunch = ({ entries, binding, sourceTree, parentId }) => {
    checked += 1;
    assert.equal(entries.length, 1); assert.equal(entries[0].prompt, f.descriptor.Prompt);
    assert.equal(parentId, f.parent); assert.equal(binding, f.binding);
    assert.equal(sourceTree, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  };
  const accepted = f.authorize();
  assert.equal(checked, 1); assert.equal(accepted.authorized, true);
  const child = api.prepare(f.childPayload, f.options);
  assert.equal(child.status, 'child', child.reason);
  assert.equal(child.payload.agent_id, f.child); assert.equal(child.payload.session_id, f.parent);
  assert.equal(child.provenance.spawnStepIndex, 3);
  assert.equal(child.provenance.promptSha256, crypto.createHash('sha256').update(f.descriptor.Prompt).digest('hex'));
  assert.equal(child.provenance.runtimeDigest, f.binding.context.runtime_digest);
  assert.equal(child.provenance.sourceTree, accepted.receipt.sourceTree);
  const final = api.latestChildResponse(f.childPayload, f.options);
  assert.equal(final.text, '{"findings":[]}'); assert.equal(final.stepIndex, 5);
});
test('flat child authority still requires an exact valid actual parent invocation', (t) => {
  for (const mutate of [
    (f) => { f.parentRows[1].tool_calls[0].args.Prompt = 'Different prompt'; },
    (f) => { f.parentRows[1].tool_calls[0].args.Role = 'Different role'; },
    (f) => { f.parentRows[1].tool_calls[0].args.TypeName = 'zensu-plm'; },
    (f) => { f.parentRows[1].tool_calls[0].args.Workspace = 'share'; },
    (f) => { f.parentRows[1].tool_calls[0].args.Subagents = [f.descriptor]; },
    (f) => { f.parentRows[1].tool_calls[0].args.Extra = true; },
  ]) {
    const f = useFlatArguments(fixture(t)); f.authorize(); mutate(f); f.writeRows(f.parent, f.parentRows);
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
});
test('flat launch cannot bypass review packet admission or manufacture child completion', (t) => {
  const f = useFlatArguments(fixture(t));
  f.options.validateReviewLaunch = () => { throw new Error('Canonical review packet mismatch'); };
  assert.throws(() => f.authorize(), /Canonical review packet mismatch/);
  assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  delete f.options.validateReviewLaunch;
  f.authorize();
  const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
  assert.equal(lifecycle.stopChild({ ...f.childPayload, termination_reason: 'USER_CANCELED', fully_idle: true }, f.options).captured, false);
  assert.equal(lifecycle.stopChild({ ...f.childPayload, termination_reason: 'NO_TOOL_CALL' }, f.options).status, 'pending');
  f.childRows[2].tool_calls = [{ name: 'send_message' }]; f.writeRows(f.child, f.childRows);
  assert.throws(() => api.latestChildResponse(f.childPayload, f.options), /terminal/);
});

function useSingularResult(f) {
  f.parentRows[2].content = f.parentRows[2].content
    .replace('Created the following subagents:\n', 'Created the following subagent:\n')
    .replace('The subagents will', 'The subagent will');
  f.writeRows(f.parent, f.parentRows);
  return f;
}
test('flat dispatch with a singular host result binds the actual child and captures normal idle completion', (t) => {
  for (const filename of ['transcript.jsonl', 'transcript_full.jsonl']) {
    const f = useSingularResult(useFlatArguments(fixture(t, filename))); f.authorize();
    const child = api.prepare(f.childPayload, f.options);
    assert.equal(child.status, 'child', child.reason);
    assert.equal(child.provenance.childSessionId, f.child);
    assert.equal(child.provenance.parentSessionId, f.parent);
    assert.equal(child.provenance.spawnStepIndex, 3);
    const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
    assert.equal(lifecycle.stopChild({ ...f.childPayload, termination_reason: 'NO_TOOL_CALL', fully_idle: true, execution_num: 1 }, f.options).status, 'completed');
    const completed = lifecycle.completedChild(f.parent, f.child, f.options);
    assert.equal(completed.finalText, '{"findings":[]}');
    assert.equal(completed.runtimeDigest, f.binding.context.runtime_digest);
    assert.equal(completed.sourceTree, child.provenance.sourceTree);
  }
});
test('host result parser accepts singular one-child and legacy plural result forms', () => {
  const children = [crypto.randomUUID(), crypto.randomUUID()].map(conversationId => ({
    conversationId, logAbsoluteUri: `file:///fixture/${conversationId}/transcript.jsonl`, workspaceUris: ['file:///fixture'],
  }));
  const result = (label, values) => 'Created At: 2026-10-20T13:38:55+02:00\nCompleted At: 2026-10-20T13:38:59+02:00\n'
    + `Created the following ${label}:\n${values.map(value => JSON.stringify(value, null, 2)).join('\n')}\n`
    + `The ${label} will send you a message when finished.`;
  assert.deepEqual(api.spawnedChildren(result('subagent', children.slice(0, 1))), children.slice(0, 1));
  assert.deepEqual(api.spawnedChildren(result('subagents', children.slice(0, 1))), children.slice(0, 1));
  assert.deepEqual(api.spawnedChildren(result('subagents', children)), children);
});
test('host result parser rejects missing, ambiguous, malformed and singular multi-child results', () => {
  const child = JSON.stringify({ conversationId: crypto.randomUUID() });
  const singular = `Created the following subagent:\n${child}`;
  const plural = `Created the following subagents:\n${child}`;
  for (const value of [null, '', `prefix ${plural}`, `${plural}\n${plural}`, `${singular}\n${plural}`,
    `${plural}\n${singular}`, `${singular}\n${child}`, 'Created the following subagent:\n[]',
    'Created the following subagent:\n{"conversationId":', 'Created the following subagents:\n{broken}',
    `${plural}\n{`, 'Created the following subagents:\n' + Array(17).fill(child).join('\n')]) {
    assert.throws(() => api.spawnedChildren(value), undefined, String(value));
  }
});
test('singular host result still refuses substituted child identity, workspace, transcript and count', (t) => {
  for (const mutate of [
    (f) => { f.parentRows[2].content = f.parentRows[2].content.replaceAll(f.child, f.sibling); },
    (f) => { f.parentRows[2].content = f.parentRows[2].content.replace(pathToFileURL(f.workspace).href, pathToFileURL(f.tmp).href); },
    (f) => { f.parentRows[2].content = f.parentRows[2].content.replace('transcript.jsonl', 'unrelated.jsonl'); },
    (f) => { f.parentRows[2].content = f.parentRows[2].content.replace('\nThe subagent', '\n{"conversationId":"extra"}\nThe subagent'); },
  ]) {
    const f = useSingularResult(useFlatArguments(fixture(t))); f.authorize(); mutate(f);
    f.writeRows(f.parent, f.parentRows);
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
});

function parallelFixture(t) {
  const f = useSingularResult(useFlatArguments(fixture(t, 'transcript_full.jsonl')));
  f.otherDescriptor = { ...f.descriptor, Role: 'Second reviewer', Prompt: 'Read the other approved evidence.' };
  f.parentRows[1].tool_calls.push({ name: 'invoke_subagent', args: f.otherDescriptor });
  f.parentRows.push({ ...f.parentRows[2], step_index: 4,
    content: f.parentRows[2].content.replaceAll(f.child, f.sibling) });
  f.writeRows(f.parent, f.parentRows);
  f.writeRows(f.sibling, f.childRows.map(row => ({ ...row,
    content: row.content?.replace(f.descriptor.Prompt, f.otherDescriptor.Prompt) })));
  f.sidecar.spawnStepIndex = 4;
  fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
  f.otherSidecarFile = path.join(path.dirname(f.sidecarFile), `${f.sibling}.json`);
  fs.writeFileSync(f.otherSidecarFile, JSON.stringify({ ...f.sidecar, conversationId: f.sibling,
    subagentDescriptor: { typeName: f.otherDescriptor.TypeName, role: f.otherDescriptor.Role } }));
  f.authorizeBoth = () => {
    f.authorize();
    api.authorizeLaunch({ ...f.parentPayload, step_idx: 4, native_tool_input: f.otherDescriptor }, f.options);
  };
  return f;
}
test('parallel flat children sharing the final sidecar step bind separate exact accepted results', (t) => {
  const f = parallelFixture(t); f.authorizeBoth();
  for (const [child, step, descriptor] of [[f.child, 3, f.descriptor], [f.sibling, 4, f.otherDescriptor]]) {
    const payload = { ...f.childPayload, session_id: child, transcript_path: f.transcript(child) };
    const result = api.prepare(payload, f.options);
    assert.equal(result.status, 'child', result.reason);
    assert.equal(result.provenance.spawnStepIndex, step);
    assert.equal(result.provenance.role, descriptor.Role);
    assert.equal(result.provenance.prompt, descriptor.Prompt);
    assert.equal(result.provenance.launchReceiptId, crypto.createHash('sha256').update(`${f.parent}:${step}`).digest('hex'));
    const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
    assert.equal(lifecycle.stopChild({ ...payload, fully_idle: true, termination_reason: 'NO_TOOL_CALL' }, f.options).status, 'completed');
    assert.equal(lifecycle.completedChild(f.parent, child, f.options).finalText, '{"findings":[]}');
  }
});
test('a sibling receipt cannot authorize the child whose own dispatch was never accepted', (t) => {
  const f = parallelFixture(t);
  api.authorizeLaunch({ ...f.parentPayload, step_idx: 4, native_tool_input: f.otherDescriptor }, f.options);
  assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
});
test('parallel correlation rejects ambiguity, reordered calls and foreign batch anchors', (t) => {
  for (const mutate of [
    f => { f.parentRows[3].content = f.parentRows[2].content; },
    f => { f.parentRows[1].tool_calls.reverse(); },
    f => { f.parentRows[1].tool_calls[0].args.Prompt = 'Forged'; },
    f => { f.parentRows[3].status = 'IN_PROGRESS'; },
    f => { f.parentRows[3].source = 'SYSTEM'; },
    f => { f.parentRows.reverse(); },
    f => { f.sidecar.spawnStepIndex = 2; },
    f => { f.sidecar.spawnStepIndex = 8;
      f.parentRows.push({ ...f.parentRows[1], step_index: 7, tool_calls: [f.parentRows[1].tool_calls[1]] },
        { ...f.parentRows[3], step_index: 8 }); },
    f => { f.sidecar.subagentDescriptor.role = f.otherDescriptor.Role; },
    f => { f.binding.context.runtime_digest = 'changed'; },
    f => { f.options.now += 24 * 60 * 60 * 1000 + 1; },
    f => { f.parentRows[2].content = f.parentRows[2].content.replace(pathToFileURL(f.workspace).href, pathToFileURL(f.tmp).href); },
  ]) {
    const f = parallelFixture(t); f.authorizeBoth(); mutate(f);
    f.writeRows(f.parent, f.parentRows); fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
});

test('mixed planner batches bind each real child while the final file read is absent, running or done', t => {
  for (const status of [null, 'RUNNING', 'DONE', 'ERROR']) {
    const f = parallelFixture(t);
    f.parentRows[1].tool_calls.push({ name: 'read_file', args: { Path: path.join(f.workspace, 'README.md') } });
    if (status) f.parentRows.push({ step_index: 5, source: 'MODEL', type: 'GENERIC', status,
      content: status === 'DONE' ? 'Showing lines 1-1 of 1\n1: Fixture' : '' });
    f.sidecar.spawnStepIndex = 5;
    fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
    const other = JSON.parse(fs.readFileSync(f.otherSidecarFile, 'utf8'));
    other.spawnStepIndex = 5;
    fs.writeFileSync(f.otherSidecarFile, JSON.stringify(other));
    f.writeRows(f.parent, f.parentRows); f.authorizeBoth();
    for (const [child, step] of [[f.child, 3], [f.sibling, 4]]) {
      const payload = { ...f.childPayload, session_id: child, transcript_path: f.transcript(child) };
      const result = api.prepare(payload, f.options);
      assert.equal(result.status, 'child', result.reason);
      assert.equal(result.provenance.spawnStepIndex, step);
      const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
      assert.equal(lifecycle.stopChild({ ...payload, fully_idle: true, termination_reason: 'NO_TOOL_CALL' }, f.options).status, 'completed');
      assert.equal(lifecycle.completedChild(f.parent, child, f.options).finalText, '{"findings":[]}');
    }
  }
});

test('mixed batches still reject substituted positions, descriptors, parent boundaries and results', t => {
  for (const mutate of [
    f => { f.parentRows[1].tool_calls.reverse(); },
    f => { f.parentRows[1].tool_calls[0].args.Prompt = 'Unapproved replacement'; },
    f => { f.parentRows[2].status = 'RUNNING'; },
    f => { f.parentRows[4].source = 'SYSTEM'; },
    f => { f.parentRows[4].type = 'PLANNER_RESPONSE'; },
    f => { f.sidecar.spawnStepIndex = 6; },
    f => { f.parentRows[4].content = f.parentRows[2].content; },
  ]) {
    const f = parallelFixture(t);
    f.parentRows[1].tool_calls.push({ name: 'read_file', args: { Path: path.join(f.workspace, 'README.md') } });
    f.parentRows.push({ step_index: 5, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'File read' });
    f.sidecar.spawnStepIndex = 5;
    f.writeRows(f.parent, f.parentRows); f.authorizeBoth(); mutate(f);
    f.writeRows(f.parent, f.parentRows); fs.writeFileSync(f.sidecarFile, JSON.stringify(f.sidecar));
    assert.equal(api.prepare(f.childPayload, f.options).status, 'deny');
  }
});
