'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const core = require('../../hooks/lib/session-control-core-v1.js');
const artifacts = require('../../hooks/lib/workflow-artifacts-v1.js');
const adapter = require('../../hooks/antigravity/workflow-artifacts.js');
function fixture(t) {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-workflow-artifacts-')));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  for (const bucket of ['logs', 'plans', 'state']) fs.mkdirSync(path.join(projectRoot, '.zensu', bucket), { recursive: true });
  const options = { projectRoot, sessionId: 'workflow-artifacts-fixture' };
  core.initializeWorkflowState(options);
  core.mutateWorkflowState({ ...options, workflowState: 'active', event: 'fixture-begin' }, s => {
    s.active = true; s.reviewGeneration = crypto.randomUUID(); return s;
  });
  const log = path.join(projectRoot, '.zensu/logs/run.log'), plan = path.join(projectRoot, '.zensu/plans/run.md');
  fs.writeFileSync(log, 'TDD STARTED\n');
  fs.writeFileSync(plan, '# Plan\n\n| Step | Phase | Status | Dependencies | Current action |\n| --- | --- | --- | --- | --- |\n| Feature work | Implement | completed | none | Verified actual behavior |\n| Review chain | Review | pending | implementation | Awaiting native review |\n| Phase 6 audit | Audit | blocked | fixture | Missing service |\n');
  return { options, log, plan };
}
test('execution start binds matching log and plan and emits exactly one real marker', t => {
  const f = fixture(t), result = artifacts.start(f.options, f.log);
  assert.equal(result.status, 'execution-started');
  artifacts.start(f.options, f.log);
  assert.equal(fs.readFileSync(f.log, 'utf8').match(/EXECUTION STARTED/g).length, 1);
  const text = fs.readFileSync(f.plan, 'utf8');
  assert.match(text, /Implementation audit accepted \| Audit \| pending/);
  assert.match(text, /Feature work \| Implement \| completed/);
  assert.match(text, /Phase 6 audit \| Audit \| blocked/);
  assert.match(text, /Review chain \| Review \| see native status/);
  assert.equal(core.readWorkflowState(f.options).implComplete, false);
});
test('progress reflects observed flags and report-only re-entry is read-only and ticket bound', t => {
  const f = fixture(t); artifacts.start(f.options, f.log);
  core.mutateWorkflowState({ ...f.options, workflowState: 'complete', event: 'fixture-complete' }, s => {
    s.implComplete = true; s.codeReviewDone = true; s.chainDone = true;
    s.reviewTicket = 'ticket-fixture'; s.reviewTicketConsumed = true; return s;
  });
  artifacts.syncProgress(f.options);
  const before = JSON.stringify(core.readWorkflowState(f.options)), plan = fs.readFileSync(f.plan, 'utf8');
  const report = artifacts.report(f.options, 'ticket-fixture');
  assert.equal(report.status, 'closed'); assert.equal(report.nextAction, 'render-report-only');
  assert.equal(JSON.stringify(core.readWorkflowState(f.options)), before);
  assert.match(plan, /Workflow chain closed \| Closure \| completed/);
  assert.throws(() => artifacts.report(f.options, 'another-ticket'), /stale/);
  assert.throws(() => artifacts.start(f.options, f.log), /active implementation/);
});
test('another log, unsafe aliases and stale generations cannot receive progress', t => {
  const f = fixture(t); artifacts.start(f.options, f.log);
  fs.writeFileSync(path.join(f.options.projectRoot, '.zensu/logs/other.log'), 'another\n');
  fs.writeFileSync(path.join(f.options.projectRoot, '.zensu/plans/other.md'), '# another\n');
  assert.throws(() => artifacts.start(f.options, path.join(f.options.projectRoot, '.zensu/logs/other.log')), /another log/);
  fs.unlinkSync(f.plan); fs.symlinkSync(f.log, f.plan);
  assert.throws(() => artifacts.syncProgress(f.options), /unsafe/);
  fs.unlinkSync(f.plan); fs.writeFileSync(f.plan, '# plan\n');
  core.mutateWorkflowState({ ...f.options, workflowState: 'active', event: 'fixture-replace' }, s => { s.reviewGeneration = crypto.randomUUID(); return s; });
  assert.throws(() => artifacts.syncProgress(f.options), /stale/);
});
test('managed progress rejects malformed markers and preserves cancelled work', () => {
  const state = { reviewGeneration: crypto.randomUUID(), revision: 3, implComplete: true, chainDone: false };
  assert.throws(() => artifacts.progressText('<!-- zensu:workflow-status -->', state), /ambiguous/);
  const original = '| Workflow chain closed | Closure | cancelled | none | User stopped |\n';
  assert.ok(artifacts.progressText(original, state).startsWith(original));
});
test('native adapter rejects ambient selectors and malformed operations without workflow writes', () => {
  assert.throws(() => adapter.main(['report'], { ZENSU_HOST_SESSION_ID: '11111111-2222-4333-8444-555555555555' }), /unavailable|unsafe|ZENSU/);
  for (const args of [['sync', '--log', '/tmp/log'], ['start'], ['report', '--session', 'foreign'], ['report', '--claimed-review-ticket', 'a', '--claimed-review-ticket', 'b']]) assert.throws(() => adapter.parse(args));
});

test('a delayed progress sync publishes the current lifecycle after concurrent completion', async t => {
  const f = fixture(t); artifacts.start(f.options, f.log);
  const ready = path.join(f.options.projectRoot, 'lock-ready'), release = path.join(f.options.projectRoot, 'release');
  const entered = path.join(f.options.projectRoot, 'sync-entered');
  const coreFile = require.resolve('../../hooks/lib/session-control-core-v1.js');
  const artifactFile = require.resolve('../../hooks/lib/workflow-artifacts-v1.js');
  const launch = code => {
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Error(stderr)));
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    return done;
  };
  const waitFor = async file => {
    const until = Date.now() + 5000;
    while (!fs.existsSync(file)) {
      if (Date.now() >= until) throw Error('fixture worker did not reach its barrier');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const holder = launch(`const fs=require('node:fs'),core=require(${JSON.stringify(coreFile)});
    core.withFileLock(${JSON.stringify(path.join(f.options.projectRoot, '.zensu/state'))},
    ${JSON.stringify('artifacts-' + core.sessionKey(f.options.sessionId))},()=>{
      fs.writeFileSync(${JSON.stringify(ready)},'ready');
      const until=Date.now()+5000;
      while(!fs.existsSync(${JSON.stringify(release)})) {
        if(Date.now()>until)throw Error('fixture barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      }
    });`);
  await waitFor(ready);
  const updater = launch(`require('node:fs').writeFileSync(${JSON.stringify(entered)},'entered');
    require(${JSON.stringify(artifactFile)}).syncProgress(${JSON.stringify(f.options)});`);
  await waitFor(entered);
  core.mutateWorkflowState({ ...f.options, workflowState: 'complete', event: 'fixture-complete' }, s => {
    s.implComplete = true; s.codeReviewDone = true; s.chainDone = true; return s;
  });
  fs.writeFileSync(release, 'release');
  await Promise.all([holder, updater]);
  assert.match(fs.readFileSync(f.plan, 'utf8'), /Workflow chain closed \| Closure \| completed/);
});
