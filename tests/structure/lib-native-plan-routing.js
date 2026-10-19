"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const native = require(path.join(root, 'hooks/antigravity/normalize-payload.js'));
const live = require(path.join(root, 'evals/promptfoo/lib/agy-live-provider.js'));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-plan-boundary-')));
const sid = '22111111-2222-4333-8444-555555555555';
let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`  PASS  native route: ${label}`); }
try {
  const normal = native.normalize({ conversationId: sid, workspace: tmp,
    prompt: 'Implement the saved plan', initialNumSteps: 1 }, 'PreInvocation', { correlate: false });
  check('real native identity and prompt map only to UserPromptSubmit', () => {
    assert.equal(normal.session_id, sid); assert.equal(normal.prompt, 'Implement the saved plan');
    assert.equal(normal.hook_event_name, 'UserPromptSubmit');
    assert.notEqual(normal.tool_name, 'ExitPlanMode');
  });
  check('a plan approval phrase alone never fabricates ExitPlanMode', () => {
    for (const prompt of ['Approved', 'Implement the plan', 'Use autopilot', 'No TDD']) {
      const got = native.normalize({ conversationId: sid, workspace: tmp, prompt }, 'PreInvocation', { correlate: false });
      assert.equal(got.hook_event_name, 'UserPromptSubmit'); assert.notEqual(got.tool_name, 'ExitPlanMode');
    }
  });
  const dir = path.join(tmp, sid); fs.mkdirSync(dir); const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, [
    {type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',step_index:0,content:'Use the Zensu workflow'},
    {type:'MODEL_RESPONSE',source:'USER_EXPLICIT',status:'DONE',step_index:1,content:'Use autopilot'},
    {type:'USER_INPUT',source:'AGENT',status:'DONE',step_index:2,content:'Implement directly'},
    {type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',step_index:3,content:'future user text'}
  ].map(JSON.stringify).join('\n'));
  check('transcript fallback accepts only current explicit human input before the event boundary', () => {
    assert.equal(native.normalize({conversationId:sid,workspace:tmp,transcriptPath:file,initialNumSteps:3},
      'PreInvocation',{correlate:false}).prompt,'Use the Zensu workflow');
    assert.equal(native.normalize({conversationId:'33111111-2222-4333-8444-555555555555',workspace:tmp,
      transcriptPath:file,initialNumSteps:3},'PreInvocation',{correlate:false}).prompt,undefined);
  });
  check('missing human prompt stays missing; absence is not direct-route authority', () => {
    assert.equal(native.normalize({conversationId:sid,workspace:tmp},'PreInvocation',{correlate:false}).prompt,undefined);
  });
  check('native event inventory has one real PreInvocation dispatcher and no ExitPlanMode callback', () => {
    const manifest=Object.assign({}, ...Object.values(JSON.parse(fs.readFileSync(path.join(root,'hooks.json.template'),'utf8'))));
    assert.equal(manifest.PreInvocation.length,1);
    assert.match(manifest.PreInvocation[0].command,/pre-invocation-chain\.sh PreInvocation/);
    assert.ok(!JSON.stringify(manifest).includes('ExitPlanMode'));
  });
  check('prompt context uses native injectSteps; PostToolUse cannot inject an approval question', () => {
    function emit(event) {
      const r=spawnSync(process.execPath,[path.join(root,'hooks/antigravity/emit-verdict.js')],
        {encoding:'utf8',env:{...process.env,ZV_EVENT:event,ZV_ROLE:'context',ZV_TEXT:'Choose a delivery route'}});
      assert.equal(r.status,0); return JSON.parse(r.stdout);
    }
    assert.deepEqual(emit('PreInvocation'),{injectSteps:[{ephemeralMessage:'Choose a delivery route'}]});
    assert.deepEqual(emit('PostToolUse'),{});
  });
  check('an empty trace and a bailed hook cannot prove observed absence', () => {
    const required='PreInvocation:user-prompt-tdd-reminder.sh';
    assert.equal(live.fireReport([],required).verdict,'HOOKS-NOT-FIRED');
    assert.equal(live.fireReport([{event:'PreInvocation',script:'user-prompt-tdd-reminder.sh',outcome:'bail-no-node'}],required).verdict,'HOOKS-NOT-FIRED');
    assert.equal(live.fireReport([{event:'PreInvocation',script:'user-prompt-tdd-reminder.sh',outcome:'ran'}],required).verdict,'HOOKS-FIRED-ALL');
  });
  check('missing tool action remains inconclusive rather than a proven absence', () => {
    assert.match(live.fireReport([{event:'PreInvocation',script:'user-prompt-tdd-reminder.sh',outcome:'ran'}],
      'PreToolUse:pre-bash-source-write-gate.sh').verdict,/^LIVE-INCONCLUSIVE /);
    assert.match(live.gateVerdict({controlAttempted:false,controlWritten:false,blockedAttempted:false,denied:false,unchanged:true}),/^LIVE-INCONCLUSIVE /);
  });
  console.log(`Native routing boundary: ${checks} checks passed`);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
