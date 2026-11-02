'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const capture = require('../../hooks/antigravity/ai-work');
const helpers = require('../../hooks/antigravity/session-helper');
const guard = require('../../hooks/antigravity/session-command-guard');
const paths = require('../../hooks/antigravity/session-paths');
const id = '07c2b604-3664-41b6-b53b-aeb21e4ce361';
test('native account reporting derives its scope from the immutable binding', () => {
  const resolver = () => ({ projectRoot: '/bound/worktree' });
  const value = capture.options({ session_id: id, cwd: '/untrusted/payload-path' }, ['--task', 'goal', '--title', 'Agreed goal', '--criteria', 'v1'], {}, resolver);
  assert.equal(value.workspace, '/bound/worktree'); assert.match(value.session, /^awcv1_[a-f0-9]{64}$/);
  assert.equal(value['cross-product-reason'], undefined);
  const goal = capture.options({ session_id: id }, ['--feature', id, '--feature-revision', id], {}, resolver);
  assert.equal(goal.feature, id); assert.equal(goal['feature-revision'], id);
  assert.equal(capture.options({ session_id: id }, ['--maintenance-reason', 'Upgrade tooling'], {}, resolver)['maintenance-reason'], 'Upgrade tooling');
  assert.equal(capture.options({ session_id: id }, ['--cross-product-reason', 'Explicit shared goal'], {}, resolver)['cross-product-reason'], 'Explicit shared goal');
  assert.match(capture.primer({ session_id: id }, root), /explicit human confirmation/);
  assert.throws(() => capture.options({ session_id: id }, ['--workspace', '/other'], {}, resolver), /Invalid/);
  assert.notEqual(value.session, capture.options({ session_id: 'c4a00f40-89bd-4bb8-b555-3603f5abb49f' }, [], {}, resolver).session);
});
test('partial child identity is refused before a binding is read', () => {
  for (const fields of [{ agent_id: '' }, { agent_type: 'reviewer' }, { host_session_id: 'other' }]) {
    assert.throws(() => capture.options({ session_id: id, ...fields }, [], {}, () => assert.fail('child must not bind')), /native main/);
  }
});
test('capture helper retains the one-use native authorization receipt and direct execution guard', t => {
  const data = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-capture-receipt-')));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const command = `${paths.helperPrefix(id, root)} --helper ai-work -- checkpoint`;
  const payload = { session_id: id, tool_name: 'Bash', tool_input: { command } };
  const result = guard.guard(payload, { pluginRoot: root, pluginData: data });
  assert.equal(result.kind, 'helper'); assert.equal(result.request.helper, 'ai-work');
  helpers.consumeAuthorization(result.request, { pluginData: data });
  assert.throws(() => helpers.consumeAuthorization(result.request, { pluginData: data }), /No current PreToolUse authorization/);
  const direct = guard.inspectCommand({ ...payload, tool_input: { command: `node ${root}/hooks/antigravity/ai-work.js begin` } }, { pluginRoot: root });
  assert.equal(direct.kind, 'deny');
  const foreign = guard.inspectCommand({ ...payload, session_id: 'c4a00f40-89bd-4bb8-b555-3603f5abb49f' }, { pluginRoot: root });
  assert.equal(foreign.kind, 'deny');
});
test('native Stop errors are nonblocking and never expose payload or server detail', () => {
  const result = cp.spawnSync(process.execPath, [path.join(root, 'hooks/antigravity/ai-work.js'), 'checkpoint-hook'], { input: 'private-invalid-input', encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stderr, /capture incomplete/); assert.doesNotMatch(result.stderr, /private-invalid/);
  const child = cp.spawnSync(process.execPath, [path.join(root, 'hooks/antigravity/ai-work.js'), 'checkpoint-hook'], { input: JSON.stringify({ session_id: id, agent_id: 'child' }), encoding: 'utf8' });
  assert.equal(child.status, 0); assert.equal(child.stdout + child.stderr, '');
});
test('native entry points preserve goal flags and render checkpoint outcomes', () => {
  const target = path.join(root, 'hooks/antigravity/ai-work.js');
  const script = `const Module=require('node:module'),original=Module._load;
    Module._load=function(name,parent,isMain){
      if(name==='../lib/runtime-hook-session-v1.js') return {resolveHookSession:()=>({projectRoot:'/fixture'})};
      if(name==='../lib/ai-work-capture-v1.js') return {run:(action,options)=>({status:process.env.TEST_CAPTURE_STATUS,action,feature:options.feature,revision:options['feature-revision'],maintenance:options['maintenance-reason']})};
      return original.call(this,name,parent,isMain);
    };
    const target=process.argv[1]; process.argv=[process.execPath,target,...process.argv.slice(2)]; Module._load(target,null,true);`;
  const call = (args, status = 'recording') => cp.spawnSync(process.execPath, ['-e', script, target, ...args], { input: JSON.stringify({ session_id: id }), encoding: 'utf8', env: { ...process.env, ZENSU_HOST_SESSION_ID: id, TEST_CAPTURE_STATUS: status } });
  const begin = call(['begin', '--task', 'goal', '--title', 'Objective', '--criteria', 'v1', '--feature', id, '--feature-revision', id]);
  assert.equal(begin.status, 0); assert.deepEqual(JSON.parse(begin.stdout), { status: 'recording', action: 'begin', feature: id, revision: id });
  const maintenance = call(['begin', '--maintenance-reason', 'Build tooling']);
  assert.equal(maintenance.status, 0); assert.equal(JSON.parse(maintenance.stdout).maintenance, 'Build tooling');
  assert.equal(call(['checkpoint', '--feature', id]).status, 1);
  const skipped = call(['checkpoint-hook'], 'not_started');
  assert.equal(skipped.status, 0); assert.equal(skipped.stdout, '');
  const paused = call(['checkpoint-hook'], 'skipped_missing_feature');
  assert.equal(paused.status, 0); assert.match(paused.stdout, /skipped_missing_feature/); assert.match(paused.stdout, /not acceptance/);
});
test('helper receipts preserve their lifetime when the issuance clock advances', t => {
  const data = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-capture-clock-')));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  let now = 1000;
  t.mock.method(Date, 'now', () => now++);
  const request = { sessionId: id, helper: 'ai-work', args: ['checkpoint'] };
  const file = helpers.authorize(request, { pluginData: data });
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(receipt.created_at_ms, 1000);
  assert.equal(receipt.expires_at_ms, 601000);
  helpers.consumeAuthorization(request, { pluginData: data, now: 1002 });
  assert.throws(() => helpers.consumeAuthorization(request, { pluginData: data, now: 1002 }), /No current PreToolUse authorization/);
  const explicit = helpers.authorize(request, { pluginData: data, now: 0 });
  const explicitReceipt = JSON.parse(fs.readFileSync(explicit, 'utf8'));
  assert.equal(explicitReceipt.created_at_ms, 0);
  assert.equal(explicitReceipt.expires_at_ms, 600000);
  assert.throws(() => helpers.consumeAuthorization(request, { pluginData: data, now: 600001 }), /No current PreToolUse authorization/);
});
