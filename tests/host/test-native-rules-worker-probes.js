'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { noToolTranscriptProof, successRunProof } = require('../../evals/promptfoo/lib/native-rules-worker-probes.js');
const sid = '11111111-1111-4111-8111-111111111111', ws = '/private/tmp/own-probe';
function rows() { return [
  { type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content: 'probe prompt' },
  { type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', content: 'expected marker', tool_calls: [] },
]; }
function run() { return { exit_code: 0, stdout: JSON.stringify({ status: 'SUCCESS', conversation_id: sid, response: 'expected marker\n' }) }; }
test('a no-tool proof requires one actual matching user input and one completed model response', () => {
  assert.equal(noToolTranscriptProof(rows(), 'probe prompt', 'expected marker'), true);
  const wrapped=rows();wrapped[0].content='<USER_REQUEST>\nprobe prompt\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nTime metadata\n</ADDITIONAL_METADATA>';
  assert.equal(noToolTranscriptProof(wrapped,'probe prompt','expected marker'),true);
  wrapped[0].content='<USER_REQUEST>\nother probe prompt\n</USER_REQUEST>\n';
  assert.equal(noToolTranscriptProof(wrapped,'probe prompt','expected marker'),false);
  for (const mutate of [r => r[1].tool_calls.push({name:'view_file'}), r => r.push({...r[1]}),
    r => r[0].source='SYSTEM', r => r[0].content='a sibling prompt', r => r[1].status='RUNNING',
    r => r[1].content='a wrong marker']) {
    const r=rows();mutate(r);assert.equal(noToolTranscriptProof(r,'probe prompt','expected marker'),false);
  }
});
test('native rule response evidence cannot borrow a sibling log, identity or incomplete run', () => {
  const log=`workspace ${ws}, conversation ${sid}`;
  assert.equal(successRunProof(run(),log,rows(),ws,'probe prompt','expected marker'),sid);
  for(const altered of [{...run(),exit_code:1},{...run(),signal:'SIGTERM'},
    {...run(),stdout:'not JSON'}, {...run(),stdout:JSON.stringify({status:'SUCCESS',conversation_id:'fake',response:'expected marker'})}]) {
    assert.equal(successRunProof(altered,log,rows(),ws,'probe prompt','expected marker'),null);
  }
  assert.equal(successRunProof(run(),`workspace /sibling, conversation ${sid}`,rows(),ws,'probe prompt','expected marker'),null);
  assert.equal(successRunProof(run(),`workspace ${ws}, conversation missing`,rows(),ws,'probe prompt','expected marker'),null);
});
