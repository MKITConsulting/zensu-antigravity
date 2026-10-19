'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const native = require('../../hooks/antigravity/native-review.js');
const review = require('../../hooks/lib/in-thread-review-v1.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const parentId = 'a1111111-1111-4111-8111-111111111111';
function fixture() {
  const lease = {schema:review.delegatedSchema,execution:'delegated',ticket:'review-ticket-native-123',tree:'tree-current',roles:['correctness','design','security'],expiresAt:Date.now()+60000};
  const binding = {pluginData:'/unused-test-store',context:{runtime_digest:'runtime-digest'}};
  const records = new Map();
  const report = {schema:lease.schema,execution:lease.execution,ticket:lease.ticket,tree:lease.tree,perspectives:lease.roles.map((role,index) => {
    const childId = `b${index}111111-1111-4111-8111-111111111111`;
    const perspective = {role,summary:`Inspected ${role} source paths`,findings:[]};
    const finalText=JSON.stringify({schema:native.childSchema,ticket:lease.ticket,tree:lease.tree,...perspective});
    records.set(childId,{parentId,childId,runtimeDigest:binding.context.runtime_digest,sourceTree:lease.tree,descriptor:{typeName:'zensu-review-aspect',role,prompt:native.assignmentPrefix(lease.ticket,lease.tree,role)+'REVIEW PACKET v1\nInspect the fixture source.'},finalText,finalHash:hash(finalText)});
    return {...perspective,childId};
  })};
  const options = {parentId,completedChild:(parent,child) => {assert.equal(parent,parentId); if(!records.has(child)) throw Error('No observed completion'); return records.get(child);}};
  return {lease,binding,report,records,options};
}
test('a delegated report requires all roles from distinct observed children on its exact tree', () => {
  const f=fixture();
  review.validateReport(f.report,f.lease,f.lease.tree);
  const assurance=native.verifyReport(f.report,f.lease,f.binding,f.options);
  assert.equal(assurance.reportHash,hash(JSON.stringify(f.report)));
  assert.equal(review.validateAssurance(assurance,f.report,f.lease),assurance);
  assert.equal(new Set(assurance.children.map(child=>child.id)).size,3);
});
test('missing or reused child identities cannot attest an independent panel', () => {
  for(const mutate of [f=>delete f.report.perspectives[0].childId,f=>f.report.perspectives[0].childId=parentId,f=>f.report.perspectives[1].childId=f.report.perspectives[0].childId,f=>f.records.clear()]) {
    const f=fixture();mutate(f);assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options));
  }
});
test('foreign parent, wrong role type, stale runtime and changed source receipts are rejected', () => {
  for(const field of ['parentId','childId','runtimeDigest','sourceTree']) {
    const f=fixture();f.records.get(f.report.perspectives[0].childId)[field]='wrong';
    assert.throws(()=>native.verifyReport(f.report,f.lease,f.binding,f.options),/does not match/);
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
