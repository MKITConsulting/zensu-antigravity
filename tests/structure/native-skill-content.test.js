'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = f => {
 const absolute=path.join(root,f), text=fs.readFileSync(absolute,'utf8');
 if(path.basename(f)!=='SKILL.md')return text;
 const parts=fs.readdirSync(path.dirname(absolute)).filter(name=>/^instructions-\d+\.md$/.test(name)).sort();
 return text+parts.map(name=>fs.readFileSync(path.join(path.dirname(absolute),name),'utf8')).join('');
};
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.md')?[path.join(dir,e.name)]:[]); }
test('all canonical skills receive the same native literal session-helper contract',()=>{
 const manifest=JSON.parse(read('plugin.json'));assert.equal(manifest.skills.length,32);
 for(const entry of manifest.skills){const file=path.join(entry,'SKILL.md'), text=read(file);
  assert.match(text,/\{session-helper\}/,file);assert.match(text,/one standalone shell-tool call/,file);
  assert.match(text,/Do not wrap the helper in/,file);assert.match(text,/invoke_subagent/,file);assert.match(text,/Model: "inherit"/,file);
  assert.match(text,/On agy 1\.4\.3, use one flat call per role/,file);
  assert.match(text,/legacy `Subagents` array only when the\nexposed host schema permits it/,file);
  assert.match(text,/never mix both forms or add unknown arguments/,file);
  assert.doesNotMatch(text,/with literal `Subagents` entries|one native batch/,file);
 }
 for(const file of ['docs/native-reviewers.md','skills/tdd/references/native-reviewers.md','skills/gauntlet-loop/references/harness.md']){
  const text=read(file), example=/```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(example,`${file}: native descriptor example missing`);
  const descriptor=JSON.parse(example[1]);
  assert.deepEqual(Object.keys(descriptor).sort(),['Model','Prompt','Role','TypeName','Workspace'],file);
  assert.equal(descriptor.Model,'inherit',file);assert.equal(descriptor.Workspace,'inherit',file);
  assert.match(text,/(?:legacy|historical)[\s\S]*Subagents[\s\S]*schema/i,file);
 }
});
test('no executable foreign worker/task instructions remain in skill content',()=>{
 for(const file of files(path.join(root,'skills'))){const text=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(text,/Skill tool|subagent_type:|run_in_background|ToolSearch|`Agent`|MultiEdit|Create a persisted step/,file);
  assert.doesNotMatch(text,/node [^\n]*hooks\/antigravity\/review-artifacts\.js/,file);
 }
});
test('requirements are handed to implementation with stable identifiers and unchanged text',()=>{
 const implementation=read('skills/implement/SKILL.md'), autopilot=read('skills/autopilot/SKILL.md');
 for(const text of [implementation,autopilot]){assert.match(text,/AC-###/);assert.match(text,/FR-###/);assert.match(text,/verbatim/);}
 assert.match(autopilot,/WITH AC IDs/);
});
test('TDD routes to real ticketed report helper while progress uses native file operations',()=>{
 const tdd=read('skills/tdd/SKILL.md'),review=read('skills/tdd/references/review-chain.md')+read('skills/tdd/references/native-reviewers.md');
 assert.match(tdd,/live progress table/);assert.match(tdd,/native file-edit operations/);
 assert.match(review,/--helper review -- --begin --ticket/);assert.match(review,/--helper review -- --ticket/);
 assert.match(review,/zensu-delegated-review-v1/);assert.match(review,/execution: delegated/);
 const dispatch=read('skills/tdd/references/native-reviewers.md');
 for(const field of ['REVIEW-TICKET:', 'REVIEW-TREE:', 'REVIEW-ROLE:', 'childId', 'failure_scenario', 'confidence'])assert.ok(dispatch.includes(field),field);
 assert.match(dispatch,/Raw child findings stay[\s\S]*immutable/);
});
test('plan and PR review require canonical confined native lifecycle',()=>{
 const plan=read('skills/plan-review/SKILL.md'), cast=read('skills/pr-team-review/references/cast.md'), spawn=read('skills/pr-team-review/references/spawn.md'), debate=read('skills/pr-team-review/references/debate.md');
 for(const text of [plan,cast])assert.match(text,/--helper review-evidence -- create/);
 for(const text of [plan,debate]){assert.match(text,/--helper review-evidence -- finalize/);assert.match(text,/--helper review-evidence -- collect/);}
 for(const text of [plan,spawn]){assert.match(text,/invoke_subagent/);assert.match(text,/flat arguments/);assert.match(text,/legacy `Subagents` array only when the exposed host schema accepts it/);assert.match(text,/Model.*inherit/);assert.match(text,/conversation_id/);}
 assert.match(plan,/--helper review-evidence -- close/);assert.match(debate,/Close the exact sealed lease/);
});
test('re-review reproduction invalidates native leases and preserves deferred findings',()=>{
 const text=read('skills/tdd/references/review-chain.md'), flat=text.replace(/\s+/g,' ');
 assert.match(text,/\*\*Stage 3 \(reproduction, re-reviews only, config-gated\)\.\*\*/);
 assert.match(text,/FINDING REPRODUCTION — <ledger-id> <REPRODUCED\|NOT-REPRODUCED\|NOT-TESTABLE>/);
 assert.match(flat,/retitle the finding `\[Deferred — do not fix\]` with `CRITICAL \(not reproduced\)`/);
 const dispatch=read('skills/tdd/references/native-reviewers.md');
 assert.match(dispatch,/reproduction test edit[\s\S]*invalidates the current tree lease/);
 assert.match(dispatch,/fresh `--review-ticket`[\s\S]*repeat all required perspectives/);
 assert.match(dispatch,/do not call `--tdd-begin`/);
 assert.match(flat,/BOTH the round-scope helper and this ledger to answer `status=ok`/);
 assert.match(flat,/With activation disabled the entire base panel runs, including on a re-review/);
 assert.match(flat,/gets a truthful `ASPECT SKIPPED` summary with its exact reason and no findings/);
 assert.match(text,/--helper log --stdin-file '<absolute-message.txt>' -- append/);
});


test('plugin-owned standing policy covers every command without overriding user authority', () => {
 const policy=read('rules/AGENTS.md'), manifest=JSON.parse(read('plugin.json'));
 assert.ok(Buffer.byteLength(policy,'utf8')<24000,'native policy must remain below the loader limit');
 assert.match(policy,/^# Zensu Native Policy: Verified Work, Bound Authority\n/);
 assert.equal(Object.hasOwn(manifest,'rules'),false,'directory discovery does not authorize an unsupported manifest key');
 for(const command of manifest.commands)assert.ok(policy.includes('/'+path.basename(command,'.md')),command);
 assert.match(policy,/explicit user choice to implement directly means implement directly/);
 assert.match(policy,/Do not ask again,[\s\S]*arm a Zensu workflow/);
 assert.match(policy,/Documentation and skill paths[\s\S]*verified plugin root/);
 assert.match(policy,/Generic encouragement alone is not a new workflow preference/);
 assert.match(policy,/no implicit native ExitPlanMode approval event/);
 assert.match(policy,/computing that file's digest and recording the real `PLAN_APPROVED`/);
 assert.match(policy,/A changed plan requires approval/);
 assert.match(policy,/A required native[\s\S]*missing blocks completion/);
 assert.match(policy,/Do not substitute an[\s\S]*in-thread imitation/);
 assert.match(policy,/one\nflat call per role/);
 assert.match(policy,/Never mix flat fields with that wrapper or add unknown\narguments/);
 assert.doesNotMatch(policy,/CLAUDE_|\.claude\/|subagent_type|run_in_background/);
});
