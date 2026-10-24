'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const helpers = require('../../hooks/antigravity/session-helper.js');
const bootstrap = require('../../hooks/antigravity/session-bootstrap.js');
const guard = require('../../hooks/antigravity/session-command-guard.js');
const core = require('../../hooks/lib/session-control-core-v1.js');
const paths = require('../../hooks/antigravity/session-paths.js');
const audit = require('../../hooks/lib/edit-landing-receipt-v1.js');
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-native-audit-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project's space"), data = path.join(base, 'private');
  fs.mkdirSync(root); fs.mkdirSync(data, { mode: 0o700 });
  const sid = crypto.randomUUID(), plugin = paths.pluginRoot();
  fs.writeFileSync(path.join(root, '.gitignore'), '.zensu/\n');
  fs.writeFileSync(path.join(root, 'source.js'), 'before\n');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture baseline']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.writeFileSync(path.join(root, 'source.js'), 'after\n');
  bootstrap.bootstrap({ session_id: sid, workspace_root: root }, { pluginRoot: plugin, pluginData: data });
  const env = helpers.helperEnvironment({ sessionId: sid }, { pluginRoot: plugin, pluginData: data });
  const log = path.join(root, '.zensu/logs/bound.log');
  fs.mkdirSync(path.dirname(log), { recursive: true }); fs.writeFileSync(log, 'T01 IMPL completed — files: source.js\n');
  const receipt = path.join(root, '.zensu/state', `edit-landing-${core.sessionKey(sid)}.json`);
  const request = extra => helpers.parseArguments(['--session', sid, '--helper', 'edit-landing', '--', '--log', log, ...extra]);
  const prepare = extra => helpers.prepareHelperArguments(request(extra), env);
  const active = () => core.mutateWorkflowState({ projectRoot: root, sessionId: sid, workflowState: 'active', event: 'fixture-active' }, s => {
    s.active = true; s.chainDone = false; s.reviewGeneration = crypto.randomUUID();
    s.workflowArtifacts = { generation: s.reviewGeneration, log: '.zensu/logs/bound.log' }; return s;
  });
  return { root, data, sid, env, log, receipt, request, prepare, active };
}
test('native inactive and closed workflows keep standalone noncanonical and inventory read-only', t => {
  const f = fixture(t);
  assert.deepEqual(f.prepare([]), ['--log', f.log, '--project', f.root, '--receipt', '-']);
  const run = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'), ...f.prepare([])], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.match(run.stderr, /STANDALONE AUDIT.*noncanonical/);
  assert.equal(fs.existsSync(f.receipt), false);
  f.active();
  assert.deepEqual(f.prepare(['--inventory']), ['--log', f.log, '--inventory', '--project', f.root]);
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'complete', event: 'fixture-closed' }, s => { s.chainDone = true; return s; });
  assert.deepEqual(f.prepare([]), ['--log', f.log, '--project', f.root, '--receipt', '-']);
});
test('active omission refuses before grading even with disabled or alternate receipt and leaves receipt unchanged', t => {
  const f = fixture(t); f.active(); fs.writeFileSync(f.receipt, 'existing fixture evidence\n');
  for (const extra of [[], ['--receipt', '-'], ['--receipt', path.join(f.root, 'alternate.json')]]) {
    assert.throws(() => f.prepare(extra), error => /AUDIT SESSION REQUIRED/.test(error.message)
      && error.message.includes('--helper') && error.message.includes('bound.log') && error.message.includes(f.sid)
      && /--predicates/.test(error.message));
    assert.equal(fs.readFileSync(f.receipt, 'utf8'), 'existing fixture evidence\n');
  }
  assert.equal(fs.existsSync(path.join(f.root, 'alternate.json')), false);
});
test('explicit native session audit preserves predicates and canonical receipt binding', t => {
  const f = fixture(t); f.active();
  const prepared = f.prepare(['--session', f.sid, '--predicates', path.join(f.root, 'proof.json')]);
  assert.deepEqual(prepared.slice(-4), ['--project', f.root, '--receipt', f.receipt]);
  assert.ok(prepared.includes('--predicates'));
  assert.throws(() => f.prepare(['--session', f.sid, '--receipt', '-']), /current session receipt/);
  const result = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'),
    ...f.prepare(['--session', f.sid])], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(audit.receiptFresh({ receiptPath: f.receipt, projectRoot: f.root, session: f.sid }).clean, true);
  const before = fs.readFileSync(f.receipt); assert.throws(() => f.prepare([]), /SESSION REQUIRED/);
  assert.deepEqual(fs.readFileSync(f.receipt), before);
});
test('native audit cannot trust ambient project/session, an unregistered identity or a child bootstrap', t => {
  const f = fixture(t); f.active();
  const other = crypto.randomUUID();
  assert.throws(() => helpers.prepareHelperArguments({ ...f.request([]), sessionId: other },
    { ...f.env, ZENSU_PROJECT_ROOT: f.root, ZENSU_HOST_SESSION_ID: f.sid }), /missing|record/);
  assert.throws(() => helpers.prepareHelperArguments(f.request([]), { ...f.env, ZENSU_PLUGIN_DATA: f.root }), /record|permissions/);
  assert.throws(() => bootstrap.bootstrap({ session_id: other, workspace_root: f.root, agent_id: 'child' },
    { pluginData: f.data, pluginRoot: paths.pluginRoot() }), /child/);
  const forged = `${paths.helperPrefix(f.sid)} --helper edit-landing -- --log ${paths.shellQuote(f.log)}`;
  assert.equal(guard.inspectCommand({ session_id: other, tool_name: 'Bash', tool_input: { command: forged } }).kind, 'deny');
});
test('native audit recovery is safely quoted and selects the bound log without project redirection', t => {
  const f = fixture(t); f.active();
  let message; try { f.prepare([]); } catch (error) { message = error.message; }
  const command = message.split('\n').find(line => line.startsWith('Run: ')).slice(5);
  const words = guard.literalWords(command);
  assert.deepEqual(words, [...helpers.auditCommandPrefix(f.sid), '--log', f.log, '--project', f.root, '--session', f.sid]);
  const env = helpers.helperEnvironment({ sessionId: f.sid }, { pluginRoot: paths.pluginRoot(), pluginData: f.data,
    environment: { ZENSU_AUDIT_COMMAND_JSON: '["malicious"]' } });
  assert.deepEqual(JSON.parse(env.ZENSU_AUDIT_COMMAND_JSON), helpers.auditCommandPrefix(f.sid));
  assert.throws(() => f.prepare(['--session', f.sid, '--project', f.data]), /immutable/);
});

test('actual terminal helper refuses stale audit despite fresh full-suite and acceptance records, then closes after current proofs', t => {
  const f = fixture(t); f.active();
  const ticket = 'rt_' + crypto.randomBytes(16).toString('hex');
  const plan = path.join(f.root, '.zensu/plans/bound.md'); fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, '# Synthetic audit gate fixture\n\n## Requirements\n| ID | Requirement | Source |\n| --- | --- | --- |\n| AC-001 | Synthetic command exits successfully | fixture |\n');
  const config = path.join(f.root, '.zensu/config.json');
  fs.writeFileSync(config, JSON.stringify({ evidence: { fullSuiteCommand: 'node -e "process.exit(0)"', fullSuiteRunner: 'local', fullSuiteGate: 'required', acceptanceGate: 'required' } }));
  // This is deterministic gate setup, not a claim of native reviewer execution.
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'implementation_complete', event: 'fixture-reviewed' }, s => {
    s.implComplete = true; s.codeReviewDone = true; s.reviewTicket = ticket; s.reviewTicketConsumed = true; s.reviewRound = 1;
    s.workflowArtifacts = { schema: 'zensu-workflow-artifacts-v1', generation: s.reviewGeneration, log: '.zensu/logs/bound.log', plan: '.zensu/plans/bound.md' }; return s;
  });
  const run = (args, input) => spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-log.sh'), ...args],
    { cwd: f.root, env: { ...f.env, ZENSU_CONFIG: config }, encoding: 'utf8', input, timeout: 30000 });
  const auditRun = extra => spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'), ...f.prepare(['--session', f.sid, ...extra])], { cwd: f.root, encoding: 'utf8' });
  let result = auditRun([]); assert.equal(result.status, 0, result.stdout + result.stderr);
  const recordCurrent = () => {
    let r = run(['--evidence-run', '--scope', 'full']); assert.equal(r.status, 0, r.stdout + r.stderr);
    r = run(['--evidence-run', '--scope', 'acceptance', '--cmd', 'node -e "process.exit(0)"']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const id = r.stdout.match(/er1_[0-9]{13}_[a-f0-9]{12}/)?.[0]; assert.ok(id, r.stdout);
    r = run(['--acceptance-record', '--log', f.log, '--ac', 'AC-001', '--verdict', 'pass', '--driver', 'library', '--evidence-run', id],
      'The synthetic local acceptance command completed with exit zero on this exact tree.\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  };
  recordCurrent();
  fs.writeFileSync(path.join(f.root, 'source.js'), 'after self review\n');
  fs.appendFileSync(f.log, 'SR1 IMPL completed — files: source.js\n');
  recordCurrent();
  result = run(['--chain-done', '--claimed-review-ticket', ticket]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /new edit claims|changed after/);
  const recoveryLine = result.stderr.split('\n').find(line => line.startsWith('Run: '));
  assert.ok(recoveryLine, result.stderr);
  const recoveryWords = guard.literalWords(recoveryLine.slice(5));
  assert.deepEqual(recoveryWords.slice(0, -1), [...helpers.auditCommandPrefix(f.sid),
    '--log', f.log, '--project', f.root, '--session']);
  assert.ok([f.sid, core.sessionKey(f.sid)].includes(recoveryWords.at(-1)));
  assert.equal(core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }).chainDone, false);
  result = auditRun([]); assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout, /pending=2/);
  const proof = path.join(f.root, '.zensu/proof.json');
  fs.writeFileSync(proof, JSON.stringify({ schema: 'edit-landing-predicates-v1', claims: ['T01', 'SR1'].map(step => ({ step, path: 'source.js',
    sha256: crypto.createHash('sha256').update('after self review\n').digest('hex'), present: ['after self review'], absent: ['before'] })) }));
  result = auditRun(['--predicates', proof]); assert.equal(result.status, 0, result.stdout + result.stderr);
  recordCurrent();
  result = run(['--chain-done', '--claimed-review-ticket', ticket]); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CHAIN CLOSED.*render-report-only/);
  const closed = core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }); assert.equal(closed.chainDone, true);
  result = run(['--chain-done', '--claimed-review-ticket', ticket]); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(core.readWorkflowState({ projectRoot: f.root, sessionId: f.sid }), closed);
});

test('native inactive and closed standalone audits cannot replace any receipt destination', t => {
  const f = fixture(t);
  const sibling = path.join(path.dirname(f.root), 'unrelated.json');
  const local = path.join(f.root, 'unrelated.json');
  const original = '{"unrelatedSyntheticSetting":true}\n';
  for (const target of [sibling, local]) fs.writeFileSync(target, original);
  const inspect = () => {
    for (const target of [sibling, local, f.receipt]) {
      assert.throws(() => f.prepare(['--receipt', target]), /noncanonical.*cannot write.*explicit --session/);
      if (target !== f.receipt) assert.equal(fs.readFileSync(target, 'utf8'), original);
    }
    for (const extra of [[], ['--receipt', '-']]) {
      const prepared = f.prepare(extra);
      assert.equal(prepared[prepared.indexOf('--receipt') + 1], '-');
      const run = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'), ...prepared], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stderr, /STANDALONE AUDIT.*noncanonical/);
    }
    const inventory = f.prepare(['--inventory']);
    assert.equal(inventory.includes('--receipt'), false);
  };
  inspect();
  assert.equal(fs.existsSync(f.receipt), false);
  f.active();
  const run = spawnSync('bash', [path.join(paths.pluginRoot(), 'hooks/lib/zensu-edit-landing.sh'), ...f.prepare(['--session', f.sid])], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const before = fs.readFileSync(f.receipt);
  core.mutateWorkflowState({ projectRoot: f.root, sessionId: f.sid, workflowState: 'complete', event: 'fixture-closed' }, s => { s.chainDone = true; return s; });
  inspect();
  assert.deepEqual(fs.readFileSync(f.receipt), before);
});
