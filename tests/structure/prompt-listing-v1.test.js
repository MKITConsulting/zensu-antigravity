'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const trail = require('../../hooks/antigravity/session-trail.js');
const script = path.resolve(__dirname, '../../hooks/antigravity/session-trail.js');
const id = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-trail-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'host'), project = path.join(root, 'project'), plugin = path.join(root, 'plugin-data');
  for (const d of [data, project, plugin]) fs.mkdirSync(d, { mode: 0o700 });
  fs.mkdirSync(path.join(data, 'cache'));
  fs.writeFileSync(path.join(data, 'cache', 'last_conversations.json'), JSON.stringify({ [project]: id }));
  const log = path.join(data, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date().toISOString(), content: 'Inspect this fixture' },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date().toISOString(), content: 'Fixture inspected' },
    { step_index: 2, source: 'MODEL', type: 'CHECKPOINT', status: 'DONE', content: 'This is not a user prompt' },
  ].map(JSON.stringify).join('\n') + '\n');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ZENSU_ANTIGRAVITY_DATA_ROOT: data, ZENSU_PROJECT_DIR: project, ZENSU_PLUGIN_DATA: plugin, ZENSU_HOST_SESSION_ID: target } });
  return { root, data, project, plugin, log, run };
}
test('native index correlates exact cache identity and transcript without claiming liveness', t => {
  const f = fixture(t); const result = f.run('list', '--json'); assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout); assert.equal(out.count, 1); assert.equal(out.sessions[0].id, id);
  assert.ok(out.sessions[0].evidence.includes('native transcript')); assert.equal(out.sessions[0].busySnapshot, null);
  assert.match(out.limitations.join(' '), /not process liveness/);
});
test('handoff reads native turn kinds and retains the untrusted-data boundary', t => {
  const f = fixture(t); const result = f.run('handoff', id); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^UNTRUSTED SESSION DATA:/);
  const out = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.deepEqual(out.turns.map(x => x.type), ['USER_INPUT', 'PLANNER_RESPONSE']);
  assert.equal(out.liveOwnership, 'unknown'); assert.equal(out.resume, "agy --conversation '" + id + "'");
});
test('takeover records lineage but never creates an ownership receipt; no-record is read-only', t => {
  const f = fixture(t); assert.equal(f.run('takeover', id, '--no-record', '--json').status, 0);
  const ledger = path.join(f.plugin, 'session-trail-lineage-v1.json'); assert.equal(fs.existsSync(ledger), false);
  const r = f.run('takeover', id, '--json'); assert.equal(r.status, 0, r.stderr);
  const value = JSON.parse(fs.readFileSync(ledger, 'utf8')); assert.equal(value.edges.length, 1);
  assert.deepEqual([value.edges[0].from, value.edges[0].to, value.edges[0].ownership], [id, target, 'not-established']);
});
test('short selectors and unsupported host operations fail explicitly', t => {
  const f = fixture(t); assert.notEqual(f.run('show', '111').status, 0);
  for (const command of ['release', 'label', 'window-probe']) { const r = f.run(command, id); assert.notEqual(r.status, 0); assert.match(r.stderr, /no verified native host equivalent/); }
});
test('transcript listing bounds recent turns and rejects symlink aliases', t => {
  const f = fixture(t);
  fs.writeFileSync(f.log, Array.from({length: 20}, (_, i) => JSON.stringify({type:'USER_INPUT', content:String(i)})).join('\n'));
  assert.deepEqual(trail.transcript({transcript:f.log}).turns.map(t => t.content), Array.from({length:12},(_,i)=>String(i+8)));
  const link = path.join(f.root, 'aliased.jsonl'); fs.symlinkSync(f.log, link);
  assert.deepEqual(trail.transcript({transcript:link}).turns, []);
});
test('ambiguous prefixes fail rather than selecting the newest conversation', t => {
  const f = fixture(t); const other = '11111112-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(f.data, 'cache', 'last_conversations.json'), JSON.stringify({[f.project]:id, [f.root]:other}));
  const result = f.run('show', '111111'); assert.notEqual(result.status, 0); assert.match(result.stderr,/ambiguous session prefix/);
});
