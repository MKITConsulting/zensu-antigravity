'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const grant = require('../../hooks/antigravity/native-spawn-allow.js');
const provenance = require('../../hooks/antigravity/native-agent-provenance.js');
const root = path.resolve(__dirname, '../..');
function fixture(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-native-grant-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const pluginRoot = path.join(base, 'plugin'), workspaceRoot = path.join(base, 'project'), home = path.join(base, 'home');
  for (const dir of [pluginRoot, workspaceRoot, home, path.join(pluginRoot, 'agents'), path.join(pluginRoot, 'hooks/lib')]) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root, 'plugin.json'), path.join(pluginRoot, 'plugin.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json')));
  for (const file of manifest.agents) fs.copyFileSync(path.join(root, file), path.join(pluginRoot, file));
  fs.copyFileSync(path.join(root, 'hooks/lib/zensu-config.sh'), path.join(pluginRoot, 'hooks/lib/zensu-config.sh'));
  const environment = { PATH: process.env.PATH, HOME: home };
  const payload = { session_id: '11111111-1111-4111-8111-111111111111', step_idx: 3,
    workspace_root: workspaceRoot, native_tool_name: 'invoke_subagent', native_tool_input: { Subagents: [
      { TypeName: 'zensu-review-aspect', Role: 'correctness', Prompt: 'Inspect the current source.', Model: 'inherit', Workspace: 'inherit' },
      { TypeName: 'zensu-plan-review-worker', Role: 'plan evidence', Prompt: 'Read the leased evidence.', Model: 'inherit', Workspace: 'inherit' },
    ] } };
  const authorize = () => ({ authorized: true, receipt: { schema: provenance.SCHEMA,
    parentSessionId: payload.session_id, spawnStepIndex: payload.step_idx, workspaceRoot,
    pluginRoot, runtimeDigest: 'verified-runtime', entries: provenance.inspectLaunch(payload).map(({ canonicalPayload, ...entry }) => entry) } });
  const options = { pluginRoot, environment };
  const config = (where, content) => { const file = path.join(where, '.zensu/config.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  return { base, pluginRoot, workspaceRoot, home, payload, authorize, options, config,
    allow: () => grant.mayAllow(payload, authorize(), options) };
}
test('an accepted recorded batch grants only exact installed reviewer and evidence profiles', t => {
  const f = fixture(t);
  assert.equal(f.allow(), true);
  assert.equal(grant.inspectReadOnlyDispatch({ ...f.options, workspaceRoot: f.workspaceRoot }).status, 'ok');
  assert.equal(grant.mayAllow(f.payload, { authorized: false }, f.options), false);
  const auth = f.authorize(); auth.receipt.parentSessionId = '22222222-2222-4222-8222-222222222222';
  assert.equal(grant.mayAllow(f.payload, auth, f.options), false);
  const changed = f.authorize(); changed.receipt.entries[0].prompt = 'A different request';
  assert.equal(grant.mayAllow(f.payload, changed, f.options), false);
});
test('a false in either config is sticky and malformed or unreadable config cannot grant', t => {
  const f = fixture(t);
  const global = f.config(f.home, '{"hooks":{"reviewerSpawnAutoAllow":false}}');
  const project = f.config(f.workspaceRoot, '{"hooks":{"reviewerSpawnAutoAllow":true}}');
  assert.equal(f.allow(), false);
  fs.writeFileSync(global, '{"hooks":{"reviewerSpawnAutoAllow":true}}');
  fs.writeFileSync(project, '{"hooks":{"reviewerSpawnAutoAllow":false}}');
  assert.equal(f.allow(), false);
  fs.writeFileSync(project, '{"hooks":{"reviewerSpawnAutoAllow":true}}');
  assert.equal(f.allow(), true);
  for (const bad of ['{', 'null', '[]', '{"hooks":[]}']) { fs.writeFileSync(global, bad); assert.equal(f.allow(), false); }
  fs.unlinkSync(global); fs.mkdirSync(global); assert.equal(f.allow(), false);
  assert.equal(grant.inspectReadOnlyDispatch({ ...f.options, workspaceRoot: f.workspaceRoot }).status, 'blocked');
});
test('a single-descriptor grant requires the same accepted receipt and read-only profile', t => {
  const f = fixture(t);
  f.payload.native_tool_input = f.payload.native_tool_input.Subagents[0];
  const authorization = f.authorize();
  assert.equal(grant.mayAllow(f.payload, authorization, f.options), true);
  for (const TypeName of ['zensu-plm', 'custom-reviewer']) {
    f.payload.native_tool_input.TypeName = TypeName;
    assert.equal(f.allow(), false);
  }
  assert.equal(grant.mayAllow(f.payload, authorization, f.options), false);
});
test('mixed foreign, PLM and bare-name batches never receive the native grant', t => {
  const f = fixture(t);
  for (const type of ['custom-reviewer', 'zensu-plm', 'review-aspect']) {
    f.payload.native_tool_input.Subagents[1].TypeName = type;
    assert.equal(f.allow(), false, type);
  }
});
test('model, workspace and child identity must remain pinned', t => {
  const f = fixture(t), authorization = f.authorize();
  for (const key of ['Model', 'Workspace']) {
    const changed = structuredClone(f.payload); changed.native_tool_input.Subagents[0][key] = 'custom';
    assert.equal(grant.mayAllow(changed, authorization, f.options), false);
  }
  assert.equal(grant.mayAllow({ ...f.payload, agent_id: 'child' }, authorization, f.options), false);
  assert.equal(grant.mayAllow({ ...f.payload, step_idx: 4 }, authorization, f.options), false);
});
test('altered tools, ambiguous identity, unregistered or symlinked profiles withdraw the grant', t => {
  const f = fixture(t), file = path.join(f.pluginRoot, 'agents/zensu-review-aspect.md'), original = fs.readFileSync(file, 'utf8');
  for (const replacement of ['["view_file", "grep_search", "run_command"]', '["view_file", "grep_search", "find_by_name", "write_to_file"]', 'view_file, grep_search, find_by_name']) {
    fs.writeFileSync(file, original.replace('["view_file", "grep_search", "find_by_name"]', replacement));
    assert.equal(f.allow(), false);
  }
  fs.writeFileSync(file, original.replace('name: zensu-review-aspect', 'name: zensu-review-aspect\nname: zensu-review-aspect'));
  assert.equal(f.allow(), false);
  fs.writeFileSync(file, original); fs.renameSync(file, `${file}.real`); fs.symlinkSync(`${file}.real`, file);
  assert.equal(f.allow(), false);
  fs.unlinkSync(file); fs.renameSync(`${file}.real`, file);
  const manifestFile = path.join(f.pluginRoot, 'plugin.json'), manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.agents = manifest.agents.filter(item => !item.includes('zensu-review-aspect'));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest)); assert.equal(f.allow(), false);
});
