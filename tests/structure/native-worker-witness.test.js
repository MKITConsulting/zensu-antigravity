'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decisionWitnessStarted } = require('../../hooks/antigravity/worker-runtime.js');
const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
function fixture(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'worker-witness-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'decisions.jsonl');fs.writeFileSync(file,'',{mode:0o600});return{dir,file,write:rows=>fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n')};}
const row=(sessionId=id,event='PreInvocation')=>({sessionId,event,script:'user-prompt-tdd-reminder.sh',decision:'context'});
test('initialization needs an exact-conversation native PreInvocation witness',t=>{
 const f=fixture(t);assert.equal(decisionWitnessStarted(f.file,id),false);
 f.write([{type:'system',subtype:'init',session_id:id}]);assert.equal(decisionWitnessStarted(f.file,id),false);
 f.write([row(id,'PreToolUse')]);assert.equal(decisionWitnessStarted(f.file,id),false);
 f.write([row()]);assert.equal(decisionWitnessStarted(f.file,id),true);
});
test('a sibling or mixed probe cannot supply the startup signal',t=>{
 const f=fixture(t);f.write([row(other)]);assert.equal(decisionWitnessStarted(f.file,id),false);
 f.write([row(),row(other)]);assert.equal(decisionWitnessStarted(f.file,id),false);
});
test('partial writes are retried rather than parsed as complete evidence',t=>{
 const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify(row()));assert.equal(decisionWitnessStarted(f.file,id),false);
 fs.appendFileSync(f.file,'\n');assert.equal(decisionWitnessStarted(f.file,id),true);
});
test('public, aliased and hardlinked witness files fail closed',t=>{
 const f=fixture(t);f.write([row()]);fs.chmodSync(f.file,0o644);assert.equal(decisionWitnessStarted(f.file,id),false);fs.chmodSync(f.file,0o600);
 const alias=path.join(f.dir,'alias');fs.symlinkSync(f.file,alias);assert.equal(decisionWitnessStarted(alias,id),false);
 const hard=path.join(f.dir,'hard');fs.linkSync(f.file,hard);assert.equal(decisionWitnessStarted(f.file,id),false);
});

test('the actual native launcher pins client identity before child Pulse and blocked metadata', t => {
  if (process.platform === 'win32') { t.skip('native worker transport fixture requires POSIX executable shims'); return; }
  const root = path.resolve(__dirname, '../..');
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'worker-client-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const project=path.join(dir,'project'), bin=path.join(dir,'bin');
  fs.mkdirSync(project);fs.mkdirSync(bin);
  const order='33333333-3333-4333-8333-333333333333';
  const conversation='44444444-4444-4444-8444-444444444444';
  const state=path.join(dir,'state.json'), calls=path.join(dir,'calls.jsonl'), evidence=path.join(dir,'child.json');
  const seed=spawnSync('bash',['-c','source "$1" && wo_fake_install "$2" && wo_fake_seed "$3" "$4" "$5" auto verify','fixture',path.join(root,'tests/structure/lib-work-order.sh'),bin,state,order,conversation],{encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  fs.writeFileSync(path.join(bin,'agy'),`#!/usr/bin/env node
const fs=require('node:fs');
const runtime=require(${JSON.stringify(path.join(root,'hooks/lib/work-order-v1.js'))});
const args=process.argv.slice(2);
const conversation=args[args.indexOf('--conversation')+1];
const result=runtime.start({env:process.env,projectRoot:process.cwd(),sessionKey:runtime.sessionKeyOf(conversation),orderId:${JSON.stringify(order)}});
fs.writeFileSync(${JSON.stringify(evidence)},JSON.stringify({environment:process.env.ZENSU_CLIENT_NAME,loadedClient:runtime.CLIENT_NAME,exit:result.exit}));
process.exit(result.exit===runtime.EXIT.ENDED?0:1);
`,{mode:0o755});
  // Replace only the native preparation/authority lookup in this disposable process.
  // This test checks child transport and real runtime emissions, not preparation.
  const driver=path.join(dir,'launcher.js');
  fs.writeFileSync(driver,`const native=require(${JSON.stringify(path.join(root,'hooks/antigravity/worker-launch.js'))});\nnative.prepared=()=>true;\nrequire(${JSON.stringify(path.join(root,'harness/launcher.js'))});\n`);
  const env={...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,ZENSU_CLIENT_NAME:'foreign-parent-client',ZENSU_SESSION_TOKEN:'zst_fake_session_token',FAKE_ZENSU_STATE:state,FAKE_ZENSU_CALLS:calls};
  const run=spawnSync(process.execPath,[driver,'--order',order,'--conversation',conversation,'--project',project],{env,encoding:'utf8',timeout:15000});
  assert.equal(run.status,1,run.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidence,'utf8')),{environment:'zensu-antigravity',loadedClient:'zensu-antigravity',exit:6});
  const stored=JSON.parse(fs.readFileSync(state,'utf8'));
  assert.equal(stored.pulse.clientName,'zensu-antigravity');
  const blocked=stored.events.filter(event=>event.event_type==='blocked');
  assert.equal(blocked.length,1);
  assert.equal(blocked[0].client_name,'zensu-antigravity');
  assert.equal(stored.order.blocked_kind,'worker_error');
  const rows=run.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(rows.some(row=>row.event==='session_started'),false);
  assert.equal(rows.at(-1).event,'exited');
  assert.equal(rows.at(-1).status,'failure');
});
