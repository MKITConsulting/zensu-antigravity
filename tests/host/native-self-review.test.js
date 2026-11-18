'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const native = require('../../hooks/antigravity/native-self-review.js');
const guard = require('../../hooks/antigravity/session-command-guard.js');
const helpers = require('../../hooks/antigravity/session-helper.js');
const paths = require('../../hooks/antigravity/session-paths.js');
const completed = require('../../hooks/lib/completed-review-v1.js');
const packet = require('../../hooks/lib/review-packet-v1.js');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-self-review-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sid = 'a1111111-1111-4111-8111-111111111111', key = require('../../hooks/lib/session-control-core-v1.js').sessionKey(sid);
  const data = path.join(root, 'private'); fs.mkdirSync(data, { mode: 0o700 });
  const transcript = path.join(root, 'brain', sid, '.system_generated/logs/transcript_full.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const binding = { projectRoot: root, pluginRoot: paths.pluginRoot(), pluginData: data, sessionKey: key, context: { runtime_digest: 'sha256:fixture-runtime' } };
  const state = { active: true, implComplete: true, codeReviewDone: true, chainDone: false, reviewTicketConsumed: true,
    reviewTicket: 'rt_' + 'a'.repeat(32), reviewGeneration: 'b1111111-1111-4111-8111-111111111111', reviewRound: 1 };
  const source = path.join(root, 'source.js'); fs.writeFileSync(source, 'export const value = 1;\n');
  const payload = { tool_name: 'Bash', session_id: sid, transcript_path: transcript, step_idx: 20,
    tool_input: { command: `${paths.helperPrefix(sid)} --helper log -- --chain-done --claimed-review-ticket ${state.reviewTicket}` } };
  const request = guard.inspectCommand(payload).request;
  const planner = (index, calls) => ({ step_index: index, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: calls });
  const result = (index, content) => ({ step_index: index, type: 'GENERIC', source: 'MODEL', status: 'DONE', content });
  const rows = [planner(1, [{ name: 'run_command', args: { CommandLine: `${paths.helperPrefix(sid)} --helper log -- --code-review-done --claimed-review-ticket ${state.reviewTicket}` } }]),
    result(2, 'Command exited with code 0.\n'),
    planner(3, [{ name: 'read_file', args: { Path: source } }]), result(4, 'Showing lines 1-1 of 1\n1: export const value = 1;')];
  const write = () => fs.writeFileSync(transcript, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); write();
  const lease = { schema: 'zensu-delegated-review-v1', execution: 'delegated', ticket: state.reviewTicket, tree: 'current-tree',
    sessionKey: key, runtimeDigest: binding.context.runtime_digest, generation: state.reviewGeneration, round: 1, roles: ['correctness'],
    primaryRequired: true, createdAt: 100, expiresAt: 1000 };
  const report = { schema: lease.schema, execution: lease.execution, ticket: lease.ticket, tree: lease.tree,
    perspectives: [{ role: 'correctness', summary: 'Inspected source', findings: [] }] };
  const packetPayload = { root, ticket: lease.ticket, tree: lease.tree, generation: lease.generation, round: 1, changed_files: ['source.js'] };
  lease.packet = { schema: packet.SCHEMA, payload: packetPayload, sha256: packet.hash(packetPayload) }; lease.packetHash = lease.packet.sha256;
  const resultRecord = { schema: lease.schema, execution: lease.execution, tree: lease.tree, report, reportHash: hash(JSON.stringify(report)), consumedAt: 500,
    assurance: { execution: 'delegated', reportHash: hash(JSON.stringify(report)), packetHash: lease.packetHash,
      children: [{ id: 'child-aspect', role: 'correctness', finalHash: 'a'.repeat(64) }],
      judges: [{ id: 'child-judge', role: 'judge', finalHash: 'b'.repeat(64) }],
      consumer: { id: 'child-consume', role: 'consume', finalHash: 'c'.repeat(64), verdict: 'PASS' } } };
  const dir = paths.privateDirectory(data, 'in-thread-review', 'v1', key);
  const leaseFile = path.join(dir, hash(lease.ticket) + '.json'), resultFile = path.join(dir, hash(lease.ticket) + '.result.json');
  const save = () => { fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2) + '\n', { mode: 0o600 }); fs.writeFileSync(resultFile, JSON.stringify(resultRecord), { mode: 0o600 }); }; save();
  const load = () => completed.load(binding, state, { now: 2000, fingerprint: () => 'current-tree' });
  const options = { pluginData: data, resolve: () => binding, readState: () => state, enabled: () => true, load };
  return { root, sid, source, state, binding, payload, request, rows, write, lease, resultRecord, leaseFile, resultFile, save, load, options, planner, result };
}
test('native terminal guard refuses premature closure before minting an authorization', t => {
  const f = fixture(t); f.rows.splice(2); f.write();
  const result = guard.guard(f.payload, f.options);
  assert.equal(result.kind, 'deny'); assert.match(result.reason, /SELF-REVIEW REQUIRED.*source.js/);
  assert.equal(fs.existsSync(path.join(f.binding.pluginData, 'helper-calls')), false);
});
test('current post-review native reads permit a one-use receipt and are rechecked before execution', t => {
  const f = fixture(t); assert.equal(guard.guard(f.payload, f.options).kind, 'helper');
  const receipt = helpers.consumeAuthorization(f.request, f.options);
  assert.deepEqual(receipt.terminalContext, { session_id: f.sid, transcript_path: f.payload.transcript_path, step_idx: 20 });
  assert.ok(native.verify(f.request, receipt.terminalContext, f.options));
  fs.writeFileSync(f.source, 'export const value = 2;\n');
  assert.throws(() => native.verify(f.request, receipt.terminalContext, f.options), /read the complete current files/);
  assert.throws(() => helpers.consumeAuthorization(f.request, f.options), /No current/);
});
test('old, incomplete, failed, forged and foreign reads cannot satisfy self-review', t => {
  for (const mutate of [
    f => { f.rows[2].step_index = 0; f.rows.splice(0, 0, f.rows.splice(2, 1)[0]); },
    f => { f.rows[3].status = 'RUNNING'; }, f => { f.rows[3].source = 'SYSTEM'; },
    f => { f.rows[3].content = 'Showing lines 1-1 of 2\n1: export const value = 1;'; },
    f => { f.rows[3].content = 'Showing lines 1-1 of 1\n1: export const value = 9;'; },
    f => { f.rows[2].tool_calls[0].args.Path += '.other'; },
    f => { f.rows[0].tool_calls[0].args.CommandLine = 'echo --code-review-done ' + f.state.reviewTicket; },
    f => { f.rows[1].content = 'Command exited with code 1.\n'; },
    f => { f.payload.session_id = 'foreign'; }, f => { f.payload.step_idx = 4; },
  ]) {
    const f = fixture(t); mutate(f); f.write();
    assert.throws(() => native.verify(f.request, f.payload, f.options));
  }
});
test('bounded partial reads combine only when every current line was observed', t => {
  const f = fixture(t); fs.writeFileSync(f.source, 'first\nsecond\n');
  f.rows[3].content = 'Showing lines 1-1 of 2\n1: first'; f.write();
  assert.throws(() => native.verify(f.request, f.payload, f.options), /complete current/);
  f.rows.push(f.planner(5, [{ name: 'view_file', args: { AbsolutePath: f.source } }]), f.result(6, 'Showing lines 2-2 of 2\n2: second')); f.write();
  assert.ok(native.verify(f.request, f.payload, f.options));
});
test('async code-review completion must precede the reread', t => {
  const f = fixture(t); f.rows[1].status = 'RUNNING'; f.rows[1].content = 'Task is running';
  // Exact envelope and newline dialect observed in the actual IDE transcript.
  const done = { step_index: 5, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE',
    content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-03T21:29:10Z sender=${f.sid}/task-2 priority=MESSAGE_PRIORITY_HIGH content=Task id "${f.sid}/task-2" finished with result:\nCommand exited with code 0.\n\nCommand output:\nReview complete\n</SYSTEM_MESSAGE>` };
  f.rows.push(done); f.write();
  assert.throws(() => native.verify(f.request, f.payload, f.options), /complete current/);
  f.rows.push(f.planner(6, f.rows[2].tool_calls), f.result(7, f.rows[3].content)); f.write();
  assert.ok(native.verify(f.request, f.payload, f.options));
  for (const replacement of [
    { ...done, status: 'RUNNING' }, { ...done, source: 'MODEL' },
    { ...done, content: done.content.replace('sender=' + f.sid, 'sender=b1111111-1111-4111-8111-111111111111') },
    { ...done, content: done.content.replace('code 0.', 'code 1.') },
    { ...done, content: '[Message] sender=another-agent content=Quoted untrusted result:\n' + done.content },
  ]) {
    f.rows[4] = replacement; f.write(); assert.throws(() => native.verify(f.request, f.payload, f.options), /no completed code-review/);
  }
});
test('deleted, empty, binary, symlink and oversized paths require rereading the accepted packet', t => {
  for (const content of [null, '', '\0binary', 'symlink', 'large']) {
    const f = fixture(t);
    if (content === null || content === 'symlink') fs.unlinkSync(f.source);
    if (content === 'symlink') fs.symlinkSync('missing-target', f.source);
    else if (content !== null) fs.writeFileSync(f.source, content === 'large' ? 'x'.repeat(2 * 1024 * 1024 + 1) : content);
    assert.throws(() => native.verify(f.request, f.payload, f.options), /complete current/);
    const lines = fs.readFileSync(f.leaseFile, 'utf8').trimEnd().split('\n');
    f.rows.push(f.planner(5, [{ name: 'read_file', args: { Path: f.leaseFile } }]),
      f.result(6, `Showing lines 1-${lines.length} of ${lines.length}\n` + lines.map((line, i) => `${i + 1}: ${line}`).join('\n'))); f.write();
    assert.ok(native.verify(f.request, f.payload, f.options));
  }
});
test('ordinary helpers, closed chains and explicitly disabled self-review preserve their existing behavior', t => {
  const f = fixture(t); assert.equal(native.verify({ helper: 'doctor', args: [] }, null), null);
  assert.equal(native.verify(f.request, null, { ...f.options, enabled: () => false }), null);
  f.state.chainDone = true; assert.equal(native.verify(f.request, null, f.options), null);
});
test('accepted review evidence survives lease expiry but rejects stale identities, hashes and source', t => {
  const f = fixture(t); assert.equal(f.load().lease.ticket, f.state.reviewTicket);
  for (const field of ['sessionKey', 'runtimeDigest', 'generation', 'ticket', 'tree']) {
    const old = f.lease[field]; f.lease[field] = 'foreign'; f.save(); assert.throws(f.load); f.lease[field] = old;
  }
  f.save(); assert.throws(() => completed.load(f.binding, f.state, { now: 2000, fingerprint: () => 'changed' }), /source changed/);
  f.resultRecord.reportHash = 'forged'; f.save(); assert.throws(f.load, /foreign/);
});
test('missing, unsafe or incomplete evidence never grants a passing outcome', t => {
  const f = fixture(t); fs.unlinkSync(f.resultFile); assert.equal(f.load(), null); assert.equal(completed.outcome(null), null);
  f.save(); fs.chmodSync(f.resultFile, 0o644); assert.throws(f.load, /unsafe/);
  fs.chmodSync(f.resultFile, 0o600); f.resultRecord.consumedAt = 1001; f.save(); assert.throws(f.load, /foreign/);
});

function bindFixture(f) {
  const { spawnSync } = require('node:child_process');
  const core = require('../../hooks/lib/session-control-core-v1.js');
  fs.writeFileSync(path.join(f.root, '.gitignore'), '.zensu/\nprivate/\nbrain/\n');
  assert.equal(spawnSync('git', ['-C', f.root, 'init', '-q']).status, 0);
  require('../../hooks/antigravity/session-bootstrap.js').bootstrap({ session_id: f.sid, workspace_root: f.root },
    { pluginRoot: paths.pluginRoot(), pluginData: f.binding.pluginData });
  const config = path.join(f.root, '.zensu/config.json');
  fs.writeFileSync(config, JSON.stringify({ hooks: { selfReview: true, zenMode: true, zenModeDefault: true } }));
  const env = helpers.helperEnvironment({ sessionId: f.sid }, { pluginData: f.binding.pluginData }); env.ZENSU_CONFIG = config;
  const binding = require('../../hooks/lib/runtime-hook-session-v1.js').resolveHookSession({ session_id: f.sid }, env);
  Object.assign(f.binding, binding); f.lease.runtimeDigest = binding.context.runtime_digest;
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'implementation_complete', event: 'fixture-reviewed' }, state => Object.assign(state, f.state));
  const tree = packet.fingerprint(f.root); f.lease.tree = tree; f.resultRecord.tree = tree; f.resultRecord.report.tree = tree;
  f.lease.packet.payload.tree = tree; f.lease.packet.sha256 = packet.hash(f.lease.packet.payload); f.lease.packetHash = f.lease.packet.sha256;
  f.resultRecord.reportHash = hash(JSON.stringify(f.resultRecord.report)); f.resultRecord.assurance.reportHash = f.resultRecord.reportHash;
  f.resultRecord.assurance.packetHash = f.lease.packetHash; f.save();
  return { env, core, config, spawnSync };
}
function commitFixtureBaseline(f) {
  const { spawnSync } = require('node:child_process');
  fs.writeFileSync(path.join(f.root, '.gitignore'), '.zensu/\nprivate/\nbrain/\n');
  for (const args of [['init', '-q'], ['add', '.gitignore', 'source.js'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture baseline']]) {
    const result = spawnSync('git', ['-C', f.root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  f.lease.packet.payload.baseline = spawnSync('git', ['-C', f.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
}
test('no-review closure reaches the canonical zero-change gate without granting changed work a terminus', t => {
  for (const dirty of [true, false]) {
    const f = fixture(t); commitFixtureBaseline(f);
    const { env, core, spawnSync } = bindFixture(f);
    core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'implementation_complete', event: 'fixture-no-review' }, state => {
      state.reviewTicket = ''; state.reviewTicketConsumed = true; state.codeReviewDone = false; state.reviewRound = 0; return state;
    });
    if (dirty) fs.writeFileSync(f.source, 'changed without review\n');
    const payload = { ...f.payload, tool_input: { command: `${paths.helperPrefix(f.sid)} --helper log -- --chain-done` } };
    const admitted = guard.guard(payload, { pluginData: f.binding.pluginData });
    assert.equal(admitted.kind, 'helper', admitted.reason);
    const preload = path.join(f.root, 'brain/zero-preload.cjs');
    fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('../../hooks/antigravity/session-paths.js'))}).dataRoot = () => ${JSON.stringify(f.binding.pluginData)};`);
    const result = spawnSync(process.execPath, ['--require', preload, require.resolve('../../hooks/antigravity/session-helper.js'),
      '--session', f.sid, '--helper', 'log', '--', '--chain-done'], { encoding: 'utf8', env });
    assert.equal(result.status, dirty ? 1 : 0, result.stdout + result.stderr);
    assert.equal(core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }).chainDone, !dirty);
  }
});
test('the permitted self-review fix uses fresh cumulative audit evidence and rereads newly added files', t => {
  const f = fixture(t); commitFixtureBaseline(f);
  const { env, core, spawnSync } = bindFixture(f);
  fs.writeFileSync(f.source, 'export const value = 2;\n');
  const extra = path.join(f.root, 'extra.js'); fs.writeFileSync(extra, 'new fix coverage\n');
  f.rows[3].content = 'Showing lines 1-1 of 1\n1: export const value = 2;'; f.write();
  const options = { environment: env };
  assert.throws(() => native.verify(f.request, f.payload, options), /source changed/);
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'implementation_complete', event: 'fixture-self-review-fix' }, state => {
    state.selfReviewFixed = true; return state;
  });
  assert.throws(() => native.verify(f.request, f.payload, options), /current receipt/);
  const log = path.join(f.root, '.zensu/logs/fix.log'); fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'SR1 IMPL completed — files: source.js, extra.js\n');
  const result = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'),
    '--project', f.root, '--session', f.sid, '--log', log, '--baseline', f.lease.packet.payload.baseline], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.throws(() => native.verify(f.request, f.payload, options), /extra.js/);
  f.rows.push(f.planner(5, [{ name: 'read_file', args: { Path: extra } }]), f.result(6, 'Showing lines 1-1 of 1\n1: new fix coverage')); f.write();
  assert.ok(native.verify(f.request, f.payload, options));
  const state = core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid });
  assert.throws(() => completed.load(f.binding, state), /source changed/);
  fs.writeFileSync(extra, 'unverified later change\n');
  assert.throws(() => native.verify(f.request, f.payload, options), /changed after|differs from/);
  fs.writeFileSync(extra, '\0binary fix');
  const proofs = path.join(f.root, '.zensu/fix-proofs.json');
  fs.writeFileSync(proofs, JSON.stringify({ schema: 'edit-landing-predicates-v1', claims: ['source.js', 'extra.js'].map(file => ({
    step: 'SR1', path: file, sha256: hash(fs.readFileSync(path.join(f.root, file))),
    present: [fs.readFileSync(path.join(f.root, file), 'utf8')],
  })) }));
  const refreshed = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'),
    '--project', f.root, '--session', f.sid, '--log', log, '--predicates', proofs], { encoding: 'utf8', env });
  assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
  const auditFile = path.join(f.root, '.zensu/state', `edit-landing-${f.binding.sessionKey}.json`);
  const reread = (file, index) => {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    f.rows.push(f.planner(index, [{ name: 'read_file', args: { Path: file } }]),
      f.result(index + 1, `Showing lines 1-${lines.length} of ${lines.length}\n` + lines.map((line, i) => `${i + 1}: ${line}`).join('\n'))); f.write();
  };
  reread(f.leaseFile, 7);
  assert.throws(() => native.verify(f.request, f.payload, options), /edit-landing-/);
  reread(auditFile, 9);
  assert.ok(native.verify(f.request, f.payload, options));
  const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8')); audit.auditScope.baseline = '';
  fs.writeFileSync(auditFile, JSON.stringify(audit));
  assert.throws(() => native.verify(f.request, f.payload, options), /original review baseline/);
});
test('the real hook renders verified standalone self-review, failure and closed states without changing workflow schema', t => {
  const f = fixture(t), { env, core, spawnSync } = bindFixture(f);
  const chain = require('../../hooks/lib/chain-recovery-v1.js'), anchor = require('../../hooks/lib/zen-anchor-v1.js');
  const hookEnv = { ...env }; delete hookEnv.ZENSU_HOST_SESSION_ID;
  const run = () => spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/user-prompt-zen-mode.sh')], {
    cwd: f.root, env: hookEnv, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: f.sid, cwd: f.root, prompt: 'Report progress.' }), encoding: 'utf8', timeout: 30000,
  });
  for (const verdict of ['PASS', 'PASS WITH SUGGESTIONS', 'NEEDS CHANGES', undefined]) {
    f.resultRecord.assurance.consumer.verdict = verdict; f.save();
    const actual = completed.outcomeForState(f.state, env);
    assert.equal(actual, verdict ?? null);
    const state = core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid });
    assert.equal(Object.hasOwn(state, 'chainOutcome'), false);
    const token = anchor.anchorToken(chain.classifyChain(state, { reviewVerdict: actual }));
    if (verdict?.startsWith('PASS')) assert.match(token, /✓review ▶self-review/);
    else if (verdict) assert.match(token, /✗review/);
    else assert.equal(token, 'none');
    const result = run(); assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`ZENSU CHAIN ANCHOR: ${token}`), result.stderr + result.stdout);
    assert.doesNotMatch(result.stderr, /unavailable/);
  }
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'complete', event: 'fixture-closed' }, state => { state.chainDone = true; return state; });
  const closed = run(); assert.equal(closed.status, 0, closed.stderr); assert.match(closed.stdout, /ZENSU CHAIN ANCHOR: none/);
});
test('the actual helper entrypoint rechecks source after authorization and refuses mutation', t => {
  const f = fixture(t), { config, core, spawnSync } = bindFixture(f);
  t.mock.method(paths, 'dataRoot', () => f.binding.pluginData);
  const old = process.env.ZENSU_CONFIG; process.env.ZENSU_CONFIG = config;
  t.after(() => { if (old === undefined) delete process.env.ZENSU_CONFIG; else process.env.ZENSU_CONFIG = old; });
  const admitted = guard.guard(f.payload, { pluginData: f.binding.pluginData });
  assert.equal(admitted.kind, 'helper', admitted.reason);
  const preload = path.join(f.root, 'brain/helper-preload.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('../../hooks/antigravity/session-paths.js'))}).dataRoot = () => ${JSON.stringify(f.binding.pluginData)};`);
  fs.writeFileSync(f.source, 'export const value = 2;\n');
  const result = spawnSync(process.execPath, ['--require', preload, require.resolve('../../hooks/antigravity/session-helper.js'),
    '--session', f.sid, '--helper', 'log', '--', ...f.request.args], { encoding: 'utf8', env: { ...process.env, ZENSU_CONFIG: config } });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /source changed/);
  assert.equal(core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }).chainDone, false);
});
test('the actual authorization entrypoint rejects early closure and admits completed native rereads', t => {
  const f = fixture(t), { env, core, spawnSync } = bindFixture(f);
  const preload = path.join(f.root, 'brain/guard-preload.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('../../hooks/antigravity/session-paths.js'))}).dataRoot = () => ${JSON.stringify(f.binding.pluginData)};`);
  const run = () => spawnSync(process.execPath, ['--require', preload,
    require.resolve('../../hooks/antigravity/session-command-guard.js'), '--authorize'], {
    input: JSON.stringify(f.payload), encoding: 'utf8', env,
  });
  const reads = f.rows.splice(2); f.write();
  const denied = run();
  assert.equal(denied.status, 0, denied.stderr);
  const verdict = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(verdict.permissionDecision, 'deny');
  assert.match(verdict.permissionDecisionReason, /SELF-REVIEW REQUIRED.*source.js/);
  assert.equal(fs.existsSync(path.join(f.binding.pluginData, 'helper-calls')), false);
  assert.equal(core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }).chainDone, false);
  f.rows.push(...reads); f.write();
  const admitted = run();
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.deepEqual(JSON.parse(admitted.stdout), {});
  const receipt = helpers.consumeAuthorization(f.request, { pluginData: f.binding.pluginData });
  assert.equal(receipt.terminalContext.step_idx, f.payload.step_idx);
  assert.equal(receipt.terminalContext.session_id, f.sid);
});
