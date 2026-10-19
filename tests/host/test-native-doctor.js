'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const doctor = require('../../hooks/antigravity/doctor.js');
const principal = require('../../hooks/lib/runtime-principal-v1.js');
const paths = require('../../hooks/antigravity/session-paths.js');
const parent = 'e37ee05a-aa9c-4129-9732-d2a3a5525018';
const child = 'e813c65d-5ad4-4ed3-80a7-81c7e2c81d3a';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const names = [...new Set([...principal.REVIEWER_TYPES, ...principal.EVIDENCE_WORKER_TYPES])].filter(name => name.startsWith('zensu-'));
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-doctor-native-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'private'); fs.mkdirSync(data, { mode: 0o700 });
  const binding = { pluginRoot: root, pluginData: data, projectRoot: root, sessionKey: 'native-key',
    contextFile: path.join(data, 'context.json'), context: { runtime_digest: 'b'.repeat(64) } };
  const options = { pluginRoot: root, pluginData: data,
    binder: { resolveHookSession(payload, env, mode) {
      assert.equal(payload.session_id, parent); assert.equal(mode.autoAdopt, false);
      assert.equal(env.ZENSU_PLUGIN_ROOT, root); return binding;
    } },
    outcomeAudit: () => ({ status: 'none', evidencePaths: [] }),
    dispatchAudit: () => ({ status: 'ok', findings: ['Audited native read-only dispatch.'], evidencePaths: [path.join(root, 'plugin.json')] }),
    spawnSync: (exe, args) => {
      assert.equal(exe, 'agy'); assert.deepEqual(args, ['agents']);
      return { status: 0, stdout: names.join('\n') };
    } };
  return { root, data, binding, options, env: { ZENSU_HOST_SESSION_ID: parent, ZENSU_REVIEW_EXECUTION: 'delegated' } };
}
function evidence(f) {
  const dir = paths.privateDirectory(f.data, 'native-agents', 'v1');
  const launches = paths.privateDirectory(dir, 'launches'), results = paths.privateDirectory(dir, 'results');
  const descriptor = { index: 0, typeName: 'zensu-review-aspect', role: 'correctness', prompt: 'Read assigned evidence.' };
  descriptor.promptSha256 = hash(descriptor.prompt);
  const launch = { schema: 'zensu.antigravity.native-launch.v1', parentSessionId: parent,
    workspaceRoot: f.root, pluginRoot: f.root, runtimeDigest: f.binding.context.runtime_digest,
    launchReceiptId: 'launch-one', sourceTree: 'a'.repeat(40), entries: [descriptor], claimedChildren: { 0: child } };
  const result = { schema: 'zensu.antigravity.completed-child.v1', parentSessionId: parent, childSessionId: child,
    workspaceRoot: f.root, runtimeDigest: launch.runtimeDigest, launchReceiptId: launch.launchReceiptId,
    sourceTree: launch.sourceTree, typeName: descriptor.typeName, role: descriptor.role,
    promptSha256: descriptor.promptSha256, finalText: '{"findings":[]}',
    observedStop: { fullyIdle: true, terminationReason: 'NO_TOOL_CALL', responseStep: 7 } };
  result.finalHash = hash(result.finalText);
  const launchPath = path.join(launches, `${hash(parent)}-3.json`);
  const resultPath = path.join(results, `${hash(`${parent}\0${child}`)}.json`);
  paths.writePrivateJson(launchPath, launch); paths.writePrivateJson(resultPath, result);
  return { launches, results, launchPath, resultPath, launch, result };
}
test('registry parsing accepts observed list forms and ignores unrelated text', () => {
  assert.deepEqual(doctor.registryNames('\u001b[32mzensu-review-aspect\u001b[0m\n  - zensu-review-judge\nzensu-code-reviewer  Description\nAvailable agents:\n'),
    ['zensu-review-aspect', 'zensu-review-judge', 'zensu-code-reviewer']);
});
test('delegated mode and registered profiles alone never claim completed independent execution', t => {
  const f = fixture(t), before = fs.readdirSync(f.data);
  const audit = doctor.nativeAudit(f.env, f.options), text = audit.rows.map(row => row.text).join('\n');
  assert.match(text, /registry lists all/); assert.match(text, /Independent execution remains unverified/);
  assert.doesNotMatch(text, /Observed \d+ distinct/);
  assert.deepEqual(fs.readdirSync(f.data), before, 'Doctor does not initialize missing receipt directories');
  assert.ok(audit.evidencePaths.includes(f.binding.contextFile));
  for (const status of ['blocked', 'errored', 'clear', 'unreadable']) {
    const rows = doctor.nativeAudit(f.env, { ...f.options, outcomeAudit: () => ({ status, kind: 'hook-policy-denied', denials: 2, evidencePaths: [] }) }).rows;
    const rendered = rows.map(row => row.text).join('\n');
    if (status === 'blocked') { assert.match(rendered, /pre-tool hook rejected/); assert.match(rendered, /may be a Zensu gate/); assert.doesNotMatch(rendered, /permission check rejected|permissions\.allow/); }
    if (status === 'errored') assert.match(rendered, /prior refusal is not cleared/);
    if (status === 'clear') assert.match(rendered, /not the review completion requirements/);
    if (status === 'unreadable') assert.match(rendered, /No refusal or successful launch is inferred/);
  }
});
test('a missing or failed native registry is reported as unverified, including thrown execution errors', t => {
  const f = fixture(t);
  for (const spawn of [() => ({ status: 1, stdout: '' }), () => { throw Error('unavailable'); }]) {
    const result = doctor.nativeAudit(f.env, { ...f.options, spawnSync: spawn });
    assert.ok(result.rows.some(row => row.level === 'warn' && /role registration is unverified/.test(row.text)));
  }
});
test('missing binding avoids receipt inspection and never adopts a session', t => {
  const f = fixture(t);
  const result = doctor.nativeAudit(f.env, { ...f.options,
    binder: { resolveHookSession: () => { throw Error('no baseline'); } },
    completionAudit: () => assert.fail('unbound receipts must not be read') });
  assert.ok(result.rows.some(row => /binding could not be verified/.test(row.text)));
});
test('only protected current-parent, current-runtime receipt pairs establish completion evidence', t => {
  const f = fixture(t), e = evidence(f);
  fs.writeFileSync(path.join(e.launches, `${hash('another-parent')}-3.json`), 'invalid unrelated private content', { mode: 0o600 });
  const before = fs.readFileSync(e.resultPath), proof = doctor.ownCompletionEvidence(f.binding, parent);
  assert.equal(proof.count, 1); assert.deepEqual(proof.paths, [e.launchPath, e.resultPath]);
  assert.deepEqual(fs.readFileSync(e.resultPath), before);
  const audit = doctor.nativeAudit(f.env, f.options);
  assert.ok(audit.rows.some(row => /Observed 1 distinct native child completion/.test(row.text)));
  assert.ok(audit.rows.some(row => /not a current-source review verdict/.test(row.text)));
  e.launch.runtimeDigest = 'old-runtime'; paths.writePrivateJson(e.launchPath, e.launch);
  assert.equal(doctor.ownCompletionEvidence(f.binding, parent).count, 0);
});
test('altered report, identity, snapshot, prompt and non-normal Stop receipts are rejected', t => {
  const f = fixture(t), e = evidence(f);
  for (const mutation of [ { finalText: 'forged' }, { parentSessionId: child }, { childSessionId: parent },
    { sourceTree: 'changed' }, { role: 'security' }, { promptSha256: 'changed' },
    { observedStop: { fullyIdle: false, terminationReason: 'NO_TOOL_CALL', responseStep: 7 } },
    { observedStop: { fullyIdle: true, terminationReason: 'USER_CANCELED', responseStep: 7 } } ]) {
    paths.writePrivateJson(e.resultPath, { ...e.result, ...mutation });
    assert.throws(() => doctor.ownCompletionEvidence(f.binding, parent), /receipt is invalid/);
  }
});
test('linked or publicly readable private evidence never becomes a Doctor proof', t => {
  const f = fixture(t), e = evidence(f);
  fs.chmodSync(e.results, 0o755);
  assert.throws(() => doctor.ownCompletionEvidence(f.binding, parent), /unsafe/);
  fs.chmodSync(e.results, 0o700);
  fs.renameSync(e.resultPath, e.resultPath + '.original'); fs.symlinkSync(e.resultPath + '.original', e.resultPath);
  assert.throws(() => doctor.ownCompletionEvidence(f.binding, parent));
});
test('wrapper retains engine diagnostics, pins delegated mode and does not confuse summaries', t => {
  const f = fixture(t), original = f.options.spawnSync;
  const output = doctor.run([], f.env, { ...f.options, spawnSync(exe, args, options) {
    if (exe !== 'bash') return original(exe, args, options);
    assert.deepEqual(args, [path.join(f.root, 'hooks/lib/zensu-doctor.sh')]);
    assert.equal(options.env.ZENSU_REVIEW_EXECUTION, 'delegated');
    return { status: 0, stdout: 'Zensu doctor\nState retained\nSummary: 0 warnings\n' };
  } });
  assert.match(output, /State retained/); assert.match(output, /Engine diagnostics summary: 0 warnings/);
  assert.match(output, /Native audit summary: 1 warning/); assert.match(output, /no permission or session state was changed/);
  assert.throws(() => doctor.run(['--repair'], f.env, f.options), /accepts no arguments/);
});
