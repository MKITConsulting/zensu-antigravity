'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const core = require(path.join(root, 'hooks/lib/session-control-core-v1.js'));
const { bootstrap } = require(path.join(root, 'hooks/antigravity/session-bootstrap.js'));
const { render } = require(path.join(root, 'hooks/antigravity/render-context.js'));

function fixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-stop-cas-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, 'project'), data = path.join(base, 'data'), home = path.join(base, 'home');
  for (const directory of [project, data, home]) fs.mkdirSync(directory, { mode: 0o700 });
  const config = path.join(base, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ hooks: { autoFixMaxRounds: 1, implStopNudgeAfter: 0 } }));
  const env = { PATH: process.env.PATH, HOME: home, ZENSU_PLUGIN_ROOT: root,
    ZENSU_PLUGIN_DATA: data, ZENSU_PROJECT_DIR: project, ZENSU_CONFIG: config,
    ZENSU_REVIEW_EXECUTION: 'delegated' };
  const register = (sessionId) => bootstrap({ session_id: sessionId, workspace_root: project }, { pluginRoot: root, pluginData: data });
  const read = (sessionId) => core.readWorkflowState({ projectRoot: project, sessionId });
  const state = (sessionId, patch) => core.mutateWorkflowState({ projectRoot: project, sessionId,
    workflowState: 'test-fixture', event: 'test-state' }, (current) => Object.assign(current, patch));
  const stop = (sessionId, overrides = {}) => {
    const payload = { hook_event_name: 'Stop', session_id: sessionId, cwd: project };
    const result = spawnSync('bash', [path.join(root, 'hooks/stop-chain-enforcer.sh')],
      { input: JSON.stringify(payload), encoding: 'utf8', cwd: project, env: { ...env, ...overrides }, timeout: 45000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const verdict = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    return { ...result, verdict, payload };
  };
  return { base, project, data, config, register, read, state, stop };
}

// Fixtures set state through the same validated CAS writer as the implementation.
// They exercise Stop routing, not a shortcut around the lifecycle helper's evidence gates.
test('bound inactive, review-pending and complete chains route from validated state', (t) => {
  const f = fixture(t), session = 'stop-routing';
  f.register(session);
  assert.equal(f.stop(session).stdout, '');
  f.state(session, { active: true, implComplete: true });
  const pending = f.stop(session);
  assert.equal(pending.verdict.decision, 'block');
  assert.match(pending.verdict.reason, /review chain|reviewer chain/);
  const native = render(pending.verdict.reason, 'stop-chain-enforcer.sh', pending.payload);
  assert.match(native, /native delegated review phase/);
  assert.match(native, /each returned required role through its own real invoke_subagent call/);
  assert.match(native, /flat TypeName, Role, Workspace: inherit, Model: inherit and complete Prompt arguments/);
  assert.doesNotMatch(native, /\bSubagents\b/);
  assert.match(native, /--helper review -- --begin --ticket/);
  assert.doesNotMatch(native, /subagent_type=|Agent tool/);
  assert.equal(f.read(session).stopBlockCount, 1);
  f.state(session, { codeReviewDone: true });
  const unboundReview = f.stop(session);
  assert.equal(unboundReview.verdict.decision, 'block');
  assert.match(unboundReview.verdict.reason, /no valid consumed review ticket|self-review/);
  f.state(session, { chainDone: true });
  assert.equal(f.stop(session).stdout, '');
});

test('explicit environment and configured Stop escapes release without completion', (t) => {
  const f = fixture(t), session = 'stop-escapes';
  f.register(session); f.state(session, { active: true, implComplete: true });
  assert.equal(f.stop(session, { ZENSU_CHAIN: 'off' }).stdout, '');
  fs.writeFileSync(f.config, JSON.stringify({ hooks: { chainEnforcer: false } }));
  assert.equal(f.stop(session).stdout, '');
  assert.equal(f.read(session).chainDone, false);
  assert.equal(f.read(session).stopBlockCount, 0);
});

test('Stop budget is a CAS counter, releases at its cap and re-arms a new generation', (t) => {
  const f = fixture(t), session = 'stop-cap';
  f.register(session); f.state(session, { active: true, implComplete: true, stopBlockCount: 3 });
  assert.equal(f.stop(session).verdict.decision, 'block');
  assert.equal(f.read(session).stopBlockCount, 4);
  const release = f.stop(session);
  assert.notEqual(release.verdict.decision, 'block');
  assert.match(release.stderr, /did not converge after 4 blocked Stops/);
  assert.equal(f.read(session).chainDone, false, 'budget exhaustion is not completion');
  assert.equal(fs.existsSync(`${core.adoptionWorkflowStatePath(f.project, session)}.stopblocks`), false);
  core.resetReviewBudget({ projectRoot: f.project, sessionId: session,
    expectedRevision: f.read(session).revision });
  assert.equal(f.read(session).stopBlockCount, 0);
  assert.equal(f.stop(session).verdict.decision, 'block');
  assert.equal(f.read(session).stopBlockCount, 1);
});

test('two conversations share a workspace without sharing Stop state or repairing corruption', (t) => {
  const f = fixture(t), active = 'stop-first', inactive = 'stop-second';
  f.register(active); f.register(inactive);
  f.state(active, { active: true, implComplete: true });
  assert.equal(f.stop(inactive).stdout, '');
  assert.equal(f.stop(active).verdict.decision, 'block');
  assert.equal(f.read(inactive).stopBlockCount, 0);
  const file = core.adoptionWorkflowStatePath(f.project, active);
  fs.writeFileSync(file, '{broken');
  const corrupt = f.stop(active);
  assert.equal(corrupt.verdict.decision, 'block');
  assert.match(corrupt.verdict.reason, /invalid|corrupt|could not|cannot/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  assert.equal(f.stop(inactive).stdout, '');
});
