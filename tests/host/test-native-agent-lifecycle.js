'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const lifecycle = require('../../hooks/antigravity/native-agent-lifecycle.js');
const paths = require('../../hooks/antigravity/session-paths.js');
const core = require('../../hooks/lib/session-control-core-v1.js');
const parent = 'e37ee05a-aa9c-4129-9732-d2a3a5525018';
const child = 'e813c65d-5ad4-4ed3-80a7-81c7e2c81d3a';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t, type = 'zensu-review-aspect') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-child-lifecycle-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = path.join(dir, 'private'); fs.mkdirSync(data, { mode: 0o700 });
  const p = { parentSessionId: parent, childSessionId: child, typeName: type, role: 'test-role',
    prompt: 'Read the assigned evidence and return a report.', sourceTree: 'a'.repeat(40),
    runtimeDigest: 'b'.repeat(64), launchReceiptId: 'launch-one', workspaceRoot: dir, spawnStepIndex: 3 };
  p.promptSha256 = hash(p.prompt);
  const payload = { session_id: parent, host_session_id: child, agent_id: child, agent_type: type,
    workspace_root: dir, cwd: dir, termination_reason: 'NO_TOOL_CALL', fully_idle: true, execution_num: 1 };
  let text = '{"report":"actual child result"}', step = 5, bound = 0, stored = 0, outcomes = [];
  const options = { paths, core, pluginData: data, pluginRoot: dir,
    binder: { resolveHookSession: () => ({ projectRoot: dir, context: { runtime_digest: p.runtimeDigest } }) },
    provenance: { prepare: () => ({ status: 'child', payload, provenance: p }),
      latestChildResponse: () => ({ provenance: p, text, stepIndex: step, responseSha256: hash(text),
        type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [] }) },
    leases: { kindForAgentType: name => name === 'zensu-plan-review-worker' ? 'plan-review' : null,
      bindWorker: () => { bound++; return 'lease-one'; },
      storeWorkerResult: value => { stored++; assert.equal(value.last_assistant_message, text);
        return outcomes.shift() || { action: 'stored', leaseId: 'lease-one' }; } } };
  return { dir, data, p, payload, options, counts: () => ({ bound, stored }),
    response(value, index) { text = value; step = index; }, outcomes(values) { outcomes = values; } };
}
test('only normal fully idle actual Stop captures a report, and replay is create-once', t => {
  const f = fixture(t);
  assert.equal(lifecycle.stopChild({ ...f.payload, fully_idle: false }, f.options).decision, 'continue');
  assert.equal(lifecycle.stopChild({ ...f.payload, fully_idle: undefined }, f.options).decision, 'continue');
  assert.equal(lifecycle.stopChild({ ...f.payload, termination_reason: 'USER_CANCELED' }, f.options).captured, false);
  assert.throws(() => lifecycle.completedChild(parent, child, f.options), /ENOENT/);
  assert.equal(lifecycle.stopChild(f.payload, f.options).captured, true);
  const result = lifecycle.completedChild(parent, child, f.options);
  assert.equal(result.parentId, parent); assert.equal(result.childId, child);
  assert.equal(result.finalHash, hash(result.finalText)); assert.equal(result.sourceTree, f.p.sourceTree);
  assert.equal(result.runtimeDigest, f.p.runtimeDigest); assert.equal(result.descriptor.typeName, 'zensu-review-aspect');
  assert.equal(lifecycle.stopChild(f.payload, f.options).captured, true);
  f.response('a different later response', 6);
  assert.throws(() => lifecycle.stopChild(f.payload, f.options), /create-once/);
  assert.throws(() => lifecycle.completedChild(child, parent, f.options), /ENOENT/);
});
test('evidence worker birth uses canonical lease once and actual response validation', t => {
  const f = fixture(t, 'zensu-plan-review-worker');
  assert.equal(lifecycle.bindChild(f.payload, f.options).leaseId, 'lease-one');
  assert.equal(lifecycle.bindChild(f.payload, f.options).leaseId, 'lease-one');
  assert.deepEqual(f.counts(), { bound: 1, stored: 0 });
  f.outcomes([{ action: 'block', reason: 'invalid schema' }, { action: 'stored', leaseId: 'lease-one' }]);
  assert.equal(lifecycle.stopChild(f.payload, f.options).decision, 'continue');
  assert.equal(lifecycle.stopChild(f.payload, f.options).decision, 'continue');
  assert.deepEqual(f.counts(), { bound: 1, stored: 1 }, 'same Stop result cannot spend the retry twice');
  f.response('{"kind":"plan-review","role":"test-role"}', 7);
  assert.equal(lifecycle.stopChild(f.payload, f.options).captured, true);
  assert.equal(lifecycle.completedChild(parent, child, f.options).evidenceLease.leaseId, 'lease-one');
  assert.deepEqual(f.counts(), { bound: 1, stored: 2 });
});
test('second invalid evidence result stays failed and cannot become a completion', t => {
  const f = fixture(t, 'zensu-plan-review-worker');
  f.outcomes([{ action: 'block', reason: 'first invalid' }, { action: 'failed', reason: 'second invalid' }]);
  assert.equal(lifecycle.stopChild(f.payload, f.options).status, 'retry');
  f.response('invalid again', 7);
  assert.equal(lifecycle.stopChild(f.payload, f.options).status, 'failed');
  f.response('{"now":"valid"}', 9);
  assert.equal(lifecycle.stopChild(f.payload, f.options).status, 'failed');
  assert.deepEqual(f.counts(), { bound: 1, stored: 2 });
  assert.throws(() => lifecycle.completedChild(parent, child, f.options), /ENOENT/);
});
test('mismatched identity, unobserved snapshot and nonterminal text never produce evidence', t => {
  const f = fixture(t);
  f.options.provenance.prepare = () => ({ status: 'pending', reason: 'birth not observed' });
  assert.throws(() => lifecycle.bindChild(f.payload, f.options), /birth not observed/);
  f.options.provenance.prepare = () => ({ status: 'child', payload: f.payload, provenance: { ...f.p, childSessionId: parent } });
  assert.throws(() => lifecycle.bindChild(f.payload, f.options), /selectors/);
  f.options.provenance.prepare = () => ({ status: 'child', payload: f.payload, provenance: { ...f.p, sourceTree: undefined } });
  assert.throws(() => lifecycle.bindChild(f.payload, f.options), /snapshot/);
  f.options.provenance.prepare = () => ({ status: 'child', payload: f.payload, provenance: f.p });
  f.options.provenance.latestChildResponse = () => ({ provenance: f.p, text: 'not final', stepIndex: 5,
    responseSha256: hash('not final'), type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [{}] });
  assert.throws(() => lifecycle.stopChild(f.payload, f.options), /terminal child response/);
  assert.throws(() => lifecycle.completedChild(parent, child, f.options), /ENOENT/);
});
test('private result integrity rejects altered final text', t => {
  const f = fixture(t); lifecycle.stopChild(f.payload, f.options);
  const dir = path.join(f.data, 'native-agents/v1/results'), file = path.join(dir, fs.readdirSync(dir)[0]);
  const record = JSON.parse(fs.readFileSync(file, 'utf8')); record.finalText = 'forged';
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => lifecycle.completedChild(parent, child, f.options), /receipt is invalid/);
});
test('native lifecycle binds, confines, retries and collects through the real canonical plan lease', t => {
  const f = fixture(t, 'zensu-plan-review-worker');
  const leases = require('../../hooks/lib/review-evidence-lease-v1.js');
  const project = path.join(f.dir, 'project'), plugin = path.join(f.dir, 'plugin'), packet = path.join(f.dir, 'packet');
  for (const dir of [project, plugin, packet]) fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(packet, 'plan.md'), outside = path.join(project, 'outside.md');
  fs.writeFileSync(file, 'A bounded plan with testable acceptance criteria.\n', { mode: 0o600 });
  fs.writeFileSync(outside, 'Unleased evidence.\n', { mode: 0o600 });
  const files = path.join(packet, 'files.txt'), roots = path.join(packet, 'roots.txt');
  fs.writeFileSync(files, `${file}\n`, { mode: 0o600 }); fs.writeFileSync(roots, '', { mode: 0o600 });
  f.p.workspaceRoot = project; f.p.runtimeDigest = `sha256:${'b'.repeat(64)}`;
  Object.assign(f.payload, { workspace_root: project, cwd: project });
  const binding = { projectRoot: project, pluginRoot: plugin, pluginData: f.data, sessionKey: core.sessionKey(parent),
    context: { runtime_digest: f.p.runtimeDigest, session_id_hash: `sha256:${hash(parent)}` } };
  f.options.binder = { resolveHookSession: () => binding }; f.options.leases = leases;
  const leaseId = leases.createLease(binding, { kind: 'plan-review', filesManifest: files,
    safeSubtreesManifest: roots, maxWorkers: 1 });
  assert.equal(lifecycle.bindChild(f.payload, f.options).leaseId, leaseId);
  assert.equal(leases.toolViolation({ ...f.payload, tool_name: 'Read', tool_input: { file_path: file } }, binding), null);
  assert.match(leases.toolViolation({ ...f.payload, tool_name: 'Read', tool_input: { file_path: outside } }, binding), /not an exact leased file/);
  assert.match(leases.toolViolation({ ...f.payload, tool_name: 'Write', tool_input: { file_path: file } }, binding), /cannot invoke Write/);
  f.response('Invalid prose instead of JSON.', 5);
  assert.equal(lifecycle.stopChild(f.payload, f.options).status, 'retry');
  const result = { kind: 'plan-review', role: 'test-role', verdict: 'go', confidence: 'high', summary: 'The bounded plan is testable.',
    blockers: [], improvements: [], questions: [], strengths: ['Concrete acceptance criteria.'] };
  f.response(JSON.stringify(result), 7);
  assert.equal(lifecycle.stopChild(f.payload, f.options).status, 'completed');
  assert.equal(leases.finalizeLease(binding, { leaseId }), leaseId);
  assert.deepEqual(leases.collectLease(binding, { leaseId, agentId: child, expectedRole: 'test-role' }), result);
});
