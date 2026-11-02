'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const core = require('../../hooks/lib/session-control-core-v1');

const plugin = path.resolve(__dirname, '../..');
const runId = 'budget_lock_regression';
const owner = 'budget_lock_owner';
const script = 'source "$2/hooks/lib/zensu-autopilot-state.sh" || exit; '
  + 'autopilot_increment_stop_budget budget_lock_regression "$3" "$1" "$4"';

function shell(root, command, args = [], extraEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ZENSU_') || key === 'NODE_OPTIONS') delete env[key];
  }
  Object.assign(env, {
    ZENSU_PLUGIN_ROOT: plugin, ZENSU_PROJECT_DIR: root,
    ZENSU_CONFIG: path.join(root, 'absent-config.json'), ...extraEnv,
  });
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command, 'budget-test', root, plugin, ...args], { env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-budget-lock-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const begun = await shell(root, 'source "$2/hooks/lib/zensu-autopilot-state.sh" || exit; '
    + `autopilot_begin_run ${runId} ${owner} "$1"`);
  assert.equal(begun.status, 0, begun.stderr);
  const stateDir = path.join(root, '.zensu/state');
  const runFile = path.join(stateDir, `autopilot-run-${runId}.json`);
  const binding = { lockDirectory: stateDir, resourcePath: path.join(stateDir, 'autopilot'), ownerPid: process.pid };
  return { root, stateDir, runFile, binding };
}

test('eight budget writers serialize despite slow process startup, without extending the Core wait', async t => {
  const f = await fixture(t);
  for (const expected of [1, 2]) {
    const result = await shell(f.root, script, ['PLANNING', owner]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Number(result.stdout), expected);
  }
  // Model process-start latency locally, without loading the machine or changing
  // the lease poll/attempt limit. Each child keeps its real Core and filesystem.
  const preload = path.join(f.root, 'slow-start.cjs');
  fs.writeFileSync(preload, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);\n');
  const results = await Promise.all(Array.from({ length: 8 }, () => shell(f.root, script,
    ['PLANNING', owner], { NODE_OPTIONS: `--require=${JSON.stringify(preload)}` })));
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(results.map(result => Number(result.stdout)).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.runFile)).stopBudget, { stage: 'PLANNING', count: 10 });
  assert.equal(core.inspectExternalProcessLock(f.binding).lock.state, 'absent');
});

test('a held Core lease still times out and leaves the run unchanged', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.runFile);
  const lease = core.acquireExternalProcessLock(f.binding);
  try {
    const result = await shell(f.root, script, ['PLANNING', owner]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /timed out acquiring external process lock/);
    assert.deepEqual(fs.readFileSync(f.runFile), before);
    assert.equal(core.inspectExternalProcessLock(f.binding).lock.pid, process.pid);
  } finally {
    core.releaseExternalProcessLock({ ...f.binding, token: lease.token });
  }
});

test('stage, owner and corrupt-state refusals release the lease without changing the run', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.runFile);
  for (const args of [['GATES', owner], ['PLANNING', 'another_owner']]) {
    const result = await shell(f.root, script, args);
    assert.equal(result.status, 4, result.stderr);
    assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(f.runFile), before);
    assert.equal(core.inspectExternalProcessLock(f.binding).lock.state, 'absent');
  }
  fs.writeFileSync(f.runFile, 'null\n');
  const corrupt = await shell(f.root, script, ['PLANNING', owner]);
  assert.equal(corrupt.status, 2, corrupt.stderr);
  assert.equal(fs.readFileSync(f.runFile, 'utf8'), 'null\n');
  assert.equal(core.inspectExternalProcessLock(f.binding).lock.state, 'absent');
  fs.writeFileSync(f.runFile, before);
  const valid = await shell(f.root, script, ['PLANNING', owner]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), '1');
});

test('storage substituted while waiting is refused after acquisition', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.runFile);
  const outside = path.join(f.root, 'outside.json');
  fs.writeFileSync(outside, before);
  const signal = path.join(f.root, 'acquiring');
  const preload = path.join(f.root, 'observe-acquire.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const core = require(${JSON.stringify(path.join(plugin, 'hooks/lib/session-control-core-v1.js'))});
    const acquire = core.acquireExternalProcessLock;
    core.acquireExternalProcessLock = function(options) {
      fs.writeFileSync(${JSON.stringify(signal)}, 'waiting');
      return acquire(options);
    };
  `);
  const lease = core.acquireExternalProcessLock(f.binding);
  const pending = shell(f.root, script, ['PLANNING', owner], { NODE_OPTIONS: `--require=${JSON.stringify(preload)}` });
  try {
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(signal) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(signal), 'writer must reach the real Core acquisition');
    fs.unlinkSync(f.runFile);
    fs.linkSync(outside, f.runFile);
  } finally {
    core.releaseExternalProcessLock({ ...f.binding, token: lease.token });
  }
  const result = await pending;
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.deepEqual(fs.readFileSync(outside), before);
  assert.deepEqual(fs.readFileSync(f.runFile), before);
  assert.equal(core.inspectExternalProcessLock(f.binding).lock.state, 'absent');
});

test('an atomic replacement fault retains exit 5, unchanged state and releases the lease', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.runFile);
  const preload = path.join(f.root, 'rename-fault.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const rename = fs.renameSync;
    fs.renameSync = function(source, target) {
      if (target === ${JSON.stringify(f.runFile)}) throw new Error('injected rename fault');
      return rename(source, target);
    };
  `);
  const result = await shell(f.root, script, ['PLANNING', owner], { NODE_OPTIONS: `--require=${JSON.stringify(preload)}` });
  assert.equal(result.status, 5, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(fs.readFileSync(f.runFile), before);
  assert.equal(core.inspectExternalProcessLock(f.binding).lock.state, 'absent');
  assert.deepEqual(fs.readdirSync(f.stateDir).filter(name => name.startsWith('.apt-')), []);
});
