'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const parent = 'e37ee05a-aa9c-4129-9732-d2a3a5525018', child = 'e813c65d-5ad4-4ed3-80a7-81c7e2c81d3a';
function fixture(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-native-shim-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hooks = path.join(dir, 'hooks'), adapter = path.join(hooks, 'antigravity');
  fs.mkdirSync(adapter, { recursive: true });
  for (const file of ['antigravity-shim.sh', 'emit-verdict.js', 'session-paths.js']) fs.copyFileSync(path.join(root, 'hooks/antigravity', file), path.join(adapter, file));
  fs.copyFileSync(path.join(root, 'hooks/hooks.json'), path.join(hooks, 'hooks.json'));
  const marker = path.join(dir, 'calls.jsonl'), decisions = path.join(dir, 'decisions');
  const record = `const fs=require('fs');const payload=JSON.parse(fs.readFileSync(0,'utf8'));const record=value=>fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify(value)+'\\n');`;
  fs.writeFileSync(path.join(adapter, 'normalize-payload.js'), `${record}process.stdout.write(payload.workspace_root+'\\n'+JSON.stringify(payload));`);
  fs.writeFileSync(path.join(adapter, 'session-bootstrap.js'), `if(process.argv[2]==='--data-root'){process.stdout.write(${JSON.stringify(path.join(dir,'data'))});}else{${record}record({operation:'bootstrap'});process.stdout.write('{}');}`);
  fs.writeFileSync(path.join(adapter, 'session-command-guard.js'), `${record}process.stdout.write(process.argv[2]==='--gate-payload'?JSON.stringify(payload):'{}');`);
  fs.writeFileSync(path.join(adapter, 'native-agent-provenance.js'), `${record}
    if(process.argv[2]==='--prepare'){
      const status=payload.fixture_status||'main';
      process.stdout.write(JSON.stringify({status,reason:'unresolved principal',provenance:{readOnlyProfile:payload.fixture_read_only!==false},payload:status==='child'?{...payload,session_id:${JSON.stringify(parent)},host_session_id:${JSON.stringify(child)},agent_id:${JSON.stringify(child)},agent_type:payload.fixture_read_only===false?'custom-reviewer':'zensu-review-aspect'}:payload}));
    }else if(process.argv[2]==='--inspect-launch'){
      process.stdout.write(JSON.stringify(payload.native_tool_name==='invoke_subagent'?payload.fixture_roles.map(role=>({canonicalPayload:{...payload,tool_name:'Agent',tool_input:{subagent_type:'zensu-review-aspect',description:role,prompt:'Read only.'}}})):[]));
    }else if(process.argv[2]==='--authorize-launch'){record({operation:'authorize'});process.stdout.write('{"authorized":true}');}
  `);
  fs.writeFileSync(path.join(adapter, 'native-agent-lifecycle.js'), `${record}record({operation:process.argv[2],payload});process.stdout.write(process.argv[2]==='--stop-child'?JSON.stringify({decision:'continue',reason:'retry the invalid report'}):'{}');`);
  fs.writeFileSync(path.join(adapter, 'native-spawn-allow.js'), `const fs=require('fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({operation:'grant'})+'\\n');process.stdout.write(JSON.stringify({allow:input.payload.fixture_grant===true}));`);
  const inventory = JSON.parse(fs.readFileSync(path.join(hooks, 'hooks.json')));
  for (const group of Object.values(inventory.hooks).flat()) for (const hook of group.hooks) {
    const name = hook.command.match(/\/([^/]+\.sh)"$/)[1];
    fs.writeFileSync(path.join(hooks, name), `#!/bin/bash\nnode - <<'NODE'\nNODE\n`);
    // Keep stdin available to the script, using node -e rather than a heredoc.
    const source = `${record}record({operation:${JSON.stringify(name)},payload});let decision='';if(${JSON.stringify(name)}==='pre-reviewer-capability-gate.sh'){if(payload.agent_id&&payload.tool_name!=='Read')decision='deny';if(payload.tool_input.description==='deny')decision='deny';if(payload.tool_input.description==='ask')decision='ask';}process.stdout.write(JSON.stringify(decision?{hookSpecificOutput:{permissionDecision:decision,permissionDecisionReason:'fixture gate '+decision}}:{}));`;
    fs.writeFileSync(path.join(hooks,name), `#!/bin/bash\nnode -e '${source.replaceAll("'", "'\\''")}'\n`);
  }
  return { dir, marker, decisions, adapter, run(event, extras = {}) {
    fs.writeFileSync(marker, ''); fs.writeFileSync(decisions, '');
    const payload = { native_payload:true, session_id:parent,host_session_id:parent,workspace_root:dir,cwd:dir,
      tool_name:'Read',tool_input:{file_path:path.join(dir,'file.txt')},...extras };
    const entry = { PreInvocation:'pre-invocation-chain.sh',PreToolUse:'pre-tool-chain.sh',Stop:'stop-chain.sh' }[event];
    const result = spawnSync('bash',[path.join(adapter,'antigravity-shim.sh'),entry,event],{input:JSON.stringify(payload),encoding:'utf8',env:{...process.env,ZENSU_SHIM_DECISIONS:decisions}});
    assert.equal(result.status,0,result.stderr);
    return { verdict:JSON.parse(result.stdout), calls:fs.readFileSync(marker,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
      decisions:fs.readFileSync(decisions,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
  }};
}
test('unresolved native principal cannot bootstrap as main', t => {
  const f=fixture(t);
  const pending=f.run('PreInvocation',{fixture_status:'pending'});assert.deepEqual(pending.verdict,{});assert.deepEqual(pending.calls,[]);
  const denied=f.run('PreToolUse',{fixture_status:'pending'});assert.equal(denied.verdict.decision,'deny');assert.deepEqual(denied.calls,[]);
});
test('verified child uses parent canonical gates and its own raw trace identity', t => {
  const f=fixture(t);
  const pre=f.run('PreInvocation',{fixture_status:'child'});assert.ok(pre.verdict.injectSteps.length);assert.ok(!pre.calls.some(c=>c.operation==='bootstrap'));
  const denied=f.run('PreToolUse',{fixture_status:'child',tool_name:'Write'});assert.equal(denied.verdict.decision,'deny');
  const gate=denied.calls.find(c=>c.operation==='pre-reviewer-capability-gate.sh');
  assert.equal(gate.payload.session_id,parent);assert.equal(gate.payload.agent_id,child);
  assert.ok(denied.decisions.some(d=>d.sessionId===child&&d.parentSessionId===parent));
  assert.ok(!denied.calls.some(c=>c.operation==='bootstrap'));
});
test('child Stop preserves native retry without invoking parent chain Stop hooks', t => {
  const f=fixture(t), stopped=f.run('Stop',{fixture_status:'child',termination_reason:'NO_TOOL_CALL',fully_idle:true});
  assert.equal(stopped.verdict.decision,'continue');assert.match(stopped.verdict.reason,/retry/);
  assert.ok(stopped.calls.some(c=>c.operation==='--stop-child'));
  assert.ok(!stopped.calls.some(c=>c.operation==='stop-chain-enforcer.sh'||c.operation==='bootstrap'));
  assert.equal(stopped.decisions[0].fullyIdle,true);
});
test('an authenticated foreign child receives the bounded host profile without main lifecycle', t => {
  const f=fixture(t), result=f.run('PreInvocation',{fixture_status:'child',fixture_read_only:false});
  assert.match(JSON.stringify(result.verdict),/bounded host profile/);
  assert.doesNotMatch(JSON.stringify(result.verdict),/verified read-only child/);
  assert.ok(!result.calls.some(c=>c.operation==='bootstrap'||c.operation==='session-start-primer.sh'));
  const bound=result.calls.find(c=>c.operation==='--bind-child');
  assert.equal(bound.payload.agent_type,'custom-reviewer');
  assert.equal(bound.payload.session_id,parent);
});
test('every native batch descriptor is gated and only an accepted whole batch is authorized', t => {
  const f=fixture(t), args={native_tool_name:'invoke_subagent',tool_name:'invoke_subagent'};
  for(const role of ['deny','ask']) {
    const result=f.run('PreToolUse',{...args,fixture_roles:['first',role],fixture_grant:true});
    assert.equal(result.verdict.decision,role);
    assert.equal(result.calls.filter(c=>c.operation==='pre-reviewer-capability-gate.sh').length,2);
    assert.ok(!result.calls.some(c=>c.operation==='authorize'));
    assert.ok(!result.calls.some(c=>c.operation==='grant'));
  }
  const allowed=f.run('PreToolUse',{...args,fixture_roles:['first','second']});
  assert.equal(allowed.verdict.decision,'ask');
  assert.equal(allowed.calls.filter(c=>c.operation==='authorize').length,1);
  assert.equal(allowed.calls.filter(c=>c.operation==='pre-reviewer-capability-gate.sh').length,2);
  const granted=f.run('PreToolUse',{...args,fixture_roles:['first','second'],fixture_grant:true});
  assert.equal(granted.verdict.decision,'allow');
  assert.equal(granted.calls.filter(c=>c.operation==='grant').length,1);
  assert.ok(granted.calls.findIndex(c=>c.operation==='grant')>granted.calls.findIndex(c=>c.operation==='authorize'));
});
