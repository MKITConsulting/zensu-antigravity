'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const native = require('../../hooks/antigravity/native-review.js');
const packet = require('../../hooks/antigravity/native-review-packet.js');
const review = require('../../hooks/lib/in-thread-review-v1.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const parentId = 'a1111111-1111-4111-8111-111111111111';
function fixture() {
  const lease = {schema:review.delegatedSchema,execution:'delegated',ticket:'review-ticket-native-123',tree:'tree-current',roles:['correctness','design','security'],expiresAt:Date.now()+60000,
    packet:{schema:'zensu-review-packet-v1',payload:{evidence:'fixture-only'}},packetHash:'a'.repeat(64),primaryRequired:true};
  const binding = {pluginData:'/unused-test-store',context:{runtime_digest:'runtime-digest'}};
  const records = new Map();
  const report = {schema:lease.schema,execution:lease.execution,ticket:lease.ticket,tree:lease.tree,perspectives:lease.roles.map((role,index) => {
    const childId = `b${index}111111-1111-4111-8111-111111111111`;
    const perspective = {role,summary:`Inspected ${role} source paths`,findings:[]};
    const finalText=JSON.stringify({schema:native.childSchema,ticket:lease.ticket,tree:lease.tree,...perspective});
    records.set(childId,{parentId,childId,runtimeDigest:binding.context.runtime_digest,sourceTree:lease.tree,descriptor:{typeName:'zensu-review-aspect',role,prompt:native.assignmentPrefix(lease.ticket,lease.tree,role)+packet.block(lease.packet)+'Inspect the fixture source.'},finalText,finalHash:hash(finalText)});
    return {...perspective,childId};
  })};
  for (const [index, role, type, schema, body] of [[4,'judge','zensu-review-judge','zensu-review-judge-result-v1','## Aspect: judge\n- (no findings)'],
    [5,'judge-b','zensu-review-judge','zensu-review-judge-result-v1','## Aspect: judge (second run)\n- (no findings)'],
    [6,'consume','zensu-code-reviewer','zensu-code-review-result-v1','# Code Review Report\n- Verdict: PASS']]) {
    const childId=`b${index}111111-1111-4111-8111-111111111111`, finalText=JSON.stringify({schema,role,report:body});
    records.set(childId,{parentId,childId,runtimeDigest:binding.context.runtime_digest,sourceTree:lease.tree,descriptor:{typeName:type,role,prompt:native.assignmentPrefix(lease.ticket,lease.tree,role)+packet.block(lease.packet)},finalText,finalHash:hash(finalText)});
    if(role==='consume') report.consumer={childId}; else (report.judges ||= []).push({role,childId});
  }
  const options = {parentId,validatePacket:()=>{},completedChild:(parent,child) => {assert.equal(parent,parentId); if(!records.has(child)) throw Error('No observed completion'); return records.get(child);}};
  return {lease,binding,report,records,options};
}
test('a delegated report requires all roles from distinct observed children on its exact tree', () => {
  const f=fixture();
  review.validateReport(f.report,f.lease,f.lease.tree);
  const assurance=native.verifyReport(f.report,f.lease,f.binding,f.options);
  assert.equal(assurance.reportHash,hash(JSON.stringify(f.report)));
  assert.equal(review.validateAssurance(assurance,f.report,f.lease),assurance);
  assert.equal(new Set(assurance.children.map(child=>child.id)).size,3);
  assert.equal(assurance.consumer.verdict, 'PASS');
});
test('the consumed verdict comes only from one exact completed reviewer verdict line', () => {
  for (const verdict of ['PASS', 'PASS WITH SUGGESTIONS', 'NEEDS CHANGES']) {
    const f=fixture(), record=f.records.get(f.report.consumer.childId);
    record.finalText=JSON.stringify({schema:'zensu-code-review-result-v1',role:'consume',report:'# Code Review Report\n- Verdict: '+verdict});
    record.finalHash=hash(record.finalText);
    assert.equal(native.verifyReport(f.report,f.lease,f.binding,f.options).consumer.verdict, verdict);
    const value=JSON.parse(record.finalText); value.report+='\n- Verdict: PASS';
    record.finalText=JSON.stringify(value);record.finalHash=hash(record.finalText);
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/substantive/);
  }
});
test('missing or reused child identities cannot attest an independent panel', () => {
  for(const mutate of [f=>delete f.report.perspectives[0].childId,f=>f.report.perspectives[0].childId=parentId,f=>f.report.perspectives[1].childId=f.report.perspectives[0].childId,f=>f.records.clear()]) {
    const f=fixture();mutate(f);assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options));
  }
});
test('foreign parent, wrong role type, stale runtime and changed source receipts are rejected', () => {
  for(const field of ['parentId','childId','runtimeDigest','sourceTree']) {
    const f=fixture();f.records.get(f.report.perspectives[0].childId)[field]='wrong';
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/does not match|canonical review packet/);
  }
  const f=fixture();f.records.get(f.report.perspectives[0].childId).descriptor.typeName='general-purpose';
  assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/does not match/);
});
test('parent edits cannot rewrite a child finding, summary, role or ticket', () => {
  for(const mutate of [p=>p.summary='Parent rewritten',p=>p.role='bugs',p=>p.findings.push({severity:'critical',file:'source.js',line:1,description:'Invented',evidence:'Invented'})]) {
    const f=fixture();mutate(f.report.perspectives[0]);assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/differs|does not match/);
  }
  for(const field of ['ticket','tree','schema']) {
    const f=fixture(),r=f.records.get(f.report.perspectives[0].childId),child=JSON.parse(r.finalText);child[field]='wrong';r.finalText=JSON.stringify(child);r.finalHash=hash(r.finalText);
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/differs|does not match/);
  }
});
test('a corrupted final hash and non-JSON response never become a review result', () => {
  const f=fixture(),r=f.records.get(f.report.perspectives[0].childId);r.finalHash='0'.repeat(64);
  assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/does not match/);
  r.finalText='Review complete';r.finalHash=hash(r.finalText);
  assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/JSON/);
});
test('stored delegated assurance is bound to the exact submitted report and role set', () => {
  for(const mutate of [a=>a.reportHash='0'.repeat(64),a=>a.children.pop(),a=>a.children[1].id=a.children[0].id,a=>a.children[1].role=a.children[0].role,a=>a.children[0].finalHash='invalid']) {
    const f=fixture(),a=native.verifyReport(f.report,f.lease,f.binding,f.options);mutate(a);
    assert.throws(()=>review.validateAssurance(a,f.report,f.lease));
  }
});
test('native lease instructions carry schema and actual child identities without changing core role policy', () => {
  const f=fixture(),out=native.enrichLease({...f.lease,reportTemplate:f.report});
  assert.equal(out.childSchema,native.childSchema);assert.match(out.instructions,/invoke_subagent/);
  assert.deepEqual(out.reportTemplate.perspectives.map(p=>p.childId),['','','']);
  assert.deepEqual(out.roles,f.lease.roles);
});
test('delegated findings preserve the canonical confidence and concrete-fix floor', () => {
  const f=fixture();const finding={title:'Broken branch',severity:'critical',file:'source.js',line:1,evidence:'The branch dereferences an absent value',failure_scenario:'An empty request reaches this branch',fix:'Check the absent value before dereferencing',confidence:80};
  f.report.perspectives[0].findings=[finding];assert.equal(review.validateReport(f.report,f.lease,f.lease.tree),f.report);
  for(const mutate of [x=>x.confidence=79,x=>delete x.fix,x=>x.failure_scenario='',x=>delete x.title]) {
    const changed=structuredClone(f.report);mutate(changed.perspectives[0].findings[0]);assert.throws(()=>review.validateReport(changed,f.lease,f.lease.tree),/delegated finding/);
  }
});
test('generic child collection checks observed identity, role and current source before returning JSON', () => {
  const collector=require('../../hooks/antigravity/review-children.js');
  const f=fixture(),p=f.report.perspectives[0],r=f.records.get(p.childId);r.descriptor.role='Correctness reviewer';
  const argv=['collect','--child-id',p.childId,'--type','zensu-review-aspect','--role',r.descriptor.role];
  const options={...f.options,binding:f.binding,scratchDirectory:'/unused-private-fixture',computeTree:()=>({tree:f.lease.tree})};
  const result=collector.collect(argv,{ZENSU_HOST_SESSION_ID:parentId},options);
  assert.equal(result.sourceVerification,'current-tree');assert.equal(result.report.role,p.role);
  assert.throws(()=>collector.collect(argv,{ZENSU_HOST_SESSION_ID:parentId},{...options,computeTree:()=>({tree:'changed'})}),/source changed/);
  assert.throws(()=>collector.collect([...argv.slice(0,-1),'Wrong role'],{ZENSU_HOST_SESSION_ID:parentId},options),/does not match/);
  r.sourceTree=null;const untracked=collector.collect(argv,{ZENSU_HOST_SESSION_ID:parentId},options);
  assert.equal(untracked.sourceVerification,'artifact-snapshot-required');
});

test('a completed child must have received this exact ticket, tree, role and review packet assignment', () => {
  for(const mutate of [d=>d.role='unrelated',d=>d.prompt='Unrelated task',d=>d.prompt=d.prompt.replace('REVIEW PACKET v1','untrusted notes'),d=>d.prompt=d.prompt.replace('tree-current','stale-tree')]) {
    const f=fixture();mutate(f.records.get(f.report.perspectives[0].childId).descriptor);
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/does not match/);
  }
});

test('the entire panel shares exactly one canonical packet, not merely a title or prefix', () => {
  for (const change of [text => text.replace('fixture-only', 'foreign evidence'),
    text => text + packet.block(fixture().lease.packet),
    text => text.replace(packet.END, ''), text => text.replace(packet.START, '')]) {
    const f=fixture();const child=f.records.get(f.report.perspectives[0].childId);child.descriptor.prompt=change(child.descriptor.prompt);
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/canonical review packet/);
  }
});

test('a required primary must complete substantively; secondary and forged or empty output never substitute', () => {
  for (const mutate of [f=>f.report.judges.shift(),f=>f.records.delete(f.report.judges[0].childId),
    f=>{const r=f.records.get(f.report.judges[0].childId);r.finalText=JSON.stringify({schema:'zensu-review-judge-result-v1',role:'judge',report:'## Aspect: judge'});r.finalHash=hash(r.finalText);},
    f=>{const r=f.records.get(f.report.judges[0].childId);r.finalText=JSON.stringify({schema:'zensu-review-judge-result-v1',role:'judge',report:'## Aspect: judge\n- (no findings)\nREVIEW PACKET INVALID'});r.finalHash=hash(r.finalText);}]) {
    const f=fixture();mutate(f);assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/primary|completion/);
  }
  const f=fixture();f.lease.primaryRequired=false;f.report.judges=[];
  assert.equal(native.verifyReport(f.report,f.lease,f.binding,f.options).judges.length,0);
});

test('consume must be distinct, native completed and substantive on the same immutable packet', () => {
  for(const mutate of [f=>delete f.report.consumer,f=>f.report.consumer.childId=f.report.perspectives[0].childId,
    f=>f.records.delete(f.report.consumer.childId),f=>{const r=f.records.get(f.report.consumer.childId);r.descriptor.prompt=r.descriptor.prompt.replace('fixture-only','new input');},
    f=>{const r=f.records.get(f.report.consumer.childId);r.finalText=JSON.stringify({schema:'zensu-code-review-result-v1',report:'PASS'});r.finalHash=hash(r.finalText);}]) {
    const f=fixture();mutate(f);assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options));
  }
});

test('native launch blocks consume before primary completion and closed or mismatched generations', () => {
  const f=fixture();Object.assign(f.binding,{projectRoot:'/fixture',sessionKey:'fixture-key'});
  Object.assign(f.lease,{generation:'generation',round:1,sessionKey:f.binding.sessionKey,runtimeDigest:f.binding.context.runtime_digest});
  const entry={typeName:'zensu-code-reviewer',role:'consume',prompt:native.assignmentPrefix(f.lease.ticket,f.lease.tree,'consume')+packet.block(f.lease.packet)};
  const state={active:true,implComplete:true,chainDone:false,reviewTicket:f.lease.ticket,reviewTicketConsumed:false,reviewGeneration:f.lease.generation,reviewRound:0};
  const input={entries:[entry],binding:f.binding,sourceTree:f.lease.tree,parentId};
  const options={readState:()=>state,readLease:()=>f.lease,validatePacket:()=>{},findCompletedPrimary:()=>false};
  assert.throws(()=>packet.validateLaunch(input,options),/primary judge has not completed/);
  assert.doesNotThrow(()=>packet.validateLaunch(input,{...options,findCompletedPrimary:()=>true}));
  for(const change of [{chainDone:true},{reviewGeneration:'foreign'},{reviewRound:2},{reviewTicketConsumed:true}]) {
    assert.throws(()=>packet.validateLaunch(input,{...options,readState:()=>({...state,...change}),findCompletedPrimary:()=>true}));
  }
  assert.throws(()=>packet.validateLaunch({...input,entries:[{...entry,prompt:entry.prompt.replace('fixture-only','different')}]},options),/canonical review packet/);
  assert.throws(()=>packet.validateLaunch(input,{...options,readState:()=>{throw Error('unreadable workflow');}}),/unreadable/);
});

test('native packet lease keeps cumulative baseline and rejects source or audit drift', t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
  const lib=require('../../hooks/lib/review-packet-v1.js');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zensu-native-packet-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
  git('init','-q');fs.writeFileSync(path.join(root,'source.js'),'before\n');git('add','.');git('commit','-qm','baseline');
  const baseline=git('rev-parse','HEAD');fs.writeFileSync(path.join(root,'source.js'),'after\n');git('commit','-qam','mid-run');
  fs.writeFileSync(path.join(root,'new.js'),'new\n');fs.mkdirSync(path.join(root,'.zensu'));
  const input=path.join(root,'.zensu/input.json');
  fs.writeFileSync(input,JSON.stringify(Object.fromEntries(['implementation_summary','requirements_baseline','diff_summary','test_evidence','build_evidence','coverage_evidence'].map(field=>[field,'fixture '+field]))));
  const receipt={schema:'edit-landing-v2',session:'fixture',log:'.zensu/logs/run.log',claims:1,landed:1,notLanded:0,unverified:0,pending:0,exemptIgnored:0,exemptVerified:0,clean:true,auditScope:{baseline}};
  const binding={projectRoot:root,sessionKey:'fixture',pluginRoot:path.resolve(__dirname,'../..')};
  const lease={tree:lib.fingerprint(root),ticket:'ticket-fixture',generation:'fixture-generation',round:1};
  const opts={receiptFresh:()=>receipt,policy:()=>({primaryRequired:true})};
  assert.throws(()=>packet.prepareLease(lease,binding,{}, {},opts),/packet-input/);
  const created=packet.prepareLease(lease,binding,{'--packet-input':input},{},opts);
  assert.deepEqual(created.packet.payload.changed_files,['new.js','source.js']);
  assert.equal(created.packet.payload.baseline,baseline);
  assert.equal(packet.prepareLease(lease,binding,{'--packet-input':input},{},opts).packetHash,created.packetHash);
  assert.doesNotThrow(()=>packet.validatePacket(created,binding,opts));
  assert.throws(()=>packet.validatePacket(created,binding,{receiptFresh:()=>({...receipt,claims:2})}),/audit receipt differs/);
  fs.writeFileSync(path.join(root,'new.js'),'changed\n');
  assert.throws(()=>packet.validatePacket(created,binding,opts),/stale/);
  assert.throws(()=>packet.prepareLease(lease,binding,{'--packet-input':input,'--baseline':git('rev-parse','HEAD')},{},opts),/retained edit audit/);
});

test('primary requirement follows actual configured judge and lean re-review policy', t => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zensu-native-policy-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'config.json'), binding={projectRoot:root,pluginRoot:path.resolve(__dirname,'../..')};
  const env={...process.env,ZENSU_CONFIG:config};
  for(const [reviewPanel,reviewJudge,round,want] of [['lean',true,0,true],['lean',true,1,false],['full',true,1,true],['full',false,0,false]]) {
    fs.writeFileSync(config,JSON.stringify({hooks:{reviewPanel,reviewJudge}}));
    assert.equal(packet.policy(binding,{reviewRound:round},env).primaryRequired,want);
  }
});
