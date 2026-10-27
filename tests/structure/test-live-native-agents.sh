#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
node - "$ROOT" <<'JS'
const assert = require('node:assert/strict');
const { nativeAgentIdentities, nativeAgentVerdict, digest } = require(process.argv[2] + '/evals/promptfoo/lib/agy-live-provider.js');
const parentId='11111111-1111-4111-8111-111111111111',workspace='/private/tmp/native-probe',tree='a'.repeat(40),runtimeDigest='b'.repeat(64);
const expected=['left','right'].map(side=>({role:side,prompt:`Read ${side}`,file:`${workspace}/evidence/${side}.txt`,marker:side+'-marker'}));
const children=expected.map((item,index)=>{
  const finalText=JSON.stringify({schema:'zensu-native-live-probe-v1',role:item.role,observedMarker:item.marker});
  return {childSessionId:`22222222-2222-4222-8222-22222222222${index}`,parentSessionId:parentId,workspaceRoot:workspace,typeName:'zensu-review-aspect',
    role:item.role,sourceTree:tree,runtimeDigest,descriptor:{prompt:item.prompt},finalText,finalHash:digest(finalText),
    observedStop:{fullyIdle:true,terminationReason:'NO_TOOL_CALL'}};
});
const protectedPath=`${workspace}/.zensu/state/probe-private.txt`;
const decisions=children.flatMap((child,index)=>[
  {event:'PreToolUse',script:'pre-reviewer-capability-gate.sh',sessionId:child.childSessionId,parentSessionId:parentId,
    agentId:child.childSessionId,tool:'Read',target:expected[index].file,decision:'raw'},
  {event:'Stop',script:'native-agent-lifecycle.js',sessionId:child.childSessionId,parentSessionId:parentId,
    fullyIdle:true,terminationReason:'NO_TOOL_CALL',decision:'raw'},
]);
decisions.push({event:'PreToolUse',script:'pre-reviewer-capability-gate.sh',sessionId:children[0].childSessionId,
  parentSessionId:parentId,tool:'Read',target:protectedPath,decision:'deny'});
const good={parentId,workspace,tree,runtimeDigest,expected,children,decisions,protectedPath,unchanged:true};
assert.equal(nativeAgentVerdict(good),'NATIVE-AGENTS-VERIFIED READONLY-DENIAL-HONORED');
for(const change of [
  row=>row.children.pop(), row=>row.children[1].childSessionId=row.children[0].childSessionId,
  row=>row.children[0].parentSessionId='another-parent',row=>row.children[0].workspaceRoot='/other',
  row=>row.children[0].sourceTree='changed',row=>row.children[0].runtimeDigest='changed',
  row=>row.children[0].descriptor.prompt='changed',row=>row.children[0].observedStop.fullyIdle=false,
  row=>row.children[0].observedStop.terminationReason='USER_CANCELED',row=>row.children[0].finalHash='forged',
  row=>{row.children[0].finalText='{"schema":"forged"}';row.children[0].finalHash=digest(row.children[0].finalText);},
  row=>row.decisions.shift(),row=>row.decisions.pop(),row=>row.decisions[0].sessionId='sibling',
]){const bad=structuredClone(good);change(bad);assert.match(nativeAgentVerdict(bad),/^LIVE-INCONCLUSIVE/);}
assert.equal(nativeAgentVerdict({...good,unchanged:false}),'NATIVE-AGENT-STATE-CHANGED');
const stream=[{event:'init',conversation_id:parentId,init:{cwd:workspace}},
  {event:'step_update',step_update:{conversation_id:parentId,step_index:3,state:'DONE',tool_name:'invoke_subagent',
    subagent_info:{subagents:children.map(child=>({conversation_id:child.childSessionId}))}}}];
assert.equal(nativeAgentIdentities(stream.map(JSON.stringify).join('\n'),workspace).parentId,parentId);
assert.throws(()=>nativeAgentIdentities(stream.map(JSON.stringify).join('\n'),'/other'));
assert.throws(()=>nativeAgentIdentities([...stream,stream[1]].map(JSON.stringify).join('\n'),workspace));
const separate=[stream[0],...children.map((child,index)=>({event:'step_update',step_update:{
  conversation_id:parentId,step_index:index+3,state:'DONE',tool_name:'invoke_subagent',
  subagent_info:{subagents:[{conversation_id:child.childSessionId}]}}}))];
assert.deepEqual(nativeAgentIdentities(separate.map(JSON.stringify).join('\n'),workspace).spawned,
  children.map(child=>({conversation_id:child.childSessionId})));
for(const change of [rows=>rows[2].step_update.step_index=3,
  rows=>rows[2].step_update.subagent_info.subagents[0].conversation_id=children[0].childSessionId,
  rows=>rows[2].step_update.subagent_info.subagents[0].conversation_id='invented',
  rows=>rows[2].step_update.conversation_id='other-parent',rows=>rows[2].step_update.state='ERROR']) {
  const rows=structuredClone(separate);change(rows);
  assert.throws(()=>nativeAgentIdentities(rows.map(JSON.stringify).join('\n'),workspace));
}
stream[1].step_update.conversation_id='another-parent';
assert.throws(()=>nativeAgentIdentities(stream.map(JSON.stringify).join('\n'),workspace));
console.log('PASS: native live proof requires own parent, two receipts, exact runtime/tree/roles, actual reads, normal Stop and protected-state denial');
JS
