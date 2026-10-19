'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = process.env.ZENSU_OUTCOME_TEST_ROOT || path.resolve(__dirname, '../..');
const api = require(path.join(ROOT, 'hooks/antigravity/native-agent-provenance.js'));
const paths = require(path.join(ROOT, 'hooks/antigravity/session-paths.js'));
const outcome = require('../../hooks/antigravity/native-reviewer-outcome.js');
const observedGrammar = 'permission check failed for unsandboxed "print(1)": user denied permission to run command:\nprint(1)';
function fixture(t, filename = 'transcript.jsonl') {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-native-provenance-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parent = crypto.randomUUID(), child = crypto.randomUUID(), sibling = crypto.randomUUID();
  const workspace = path.join(tmp, 'workspace'), data = path.join(tmp, 'data'), brain = path.join(tmp, 'brain');
  for (const dir of [workspace, data, brain]) fs.mkdirSync(dir, { mode: 0o700 });
  const transcript = (session) => path.join(brain, session, '.system_generated', 'logs', filename);
  const writeRows = (session, rows) => {
    const file = transcript(session); fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    fs.writeFileSync(file, bytes);
    if (filename === 'transcript_full.jsonl') fs.writeFileSync(path.join(path.dirname(file), 'transcript.jsonl'), bytes);
  };
  const prompt = 'Read the approved evidence and report exact findings.', role = 'Correctness reviewer';
  const descriptor = { TypeName: 'zensu-review-aspect', Role: role, Prompt: prompt, Model: 'inherit', Workspace: 'inherit' };
  const parentRows = [{ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content: 'Review the fixture.' },
    { step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [
      { name: 'invoke_subagent', args: { Subagents: JSON.stringify([descriptor]) } }] },
    { step_index: 3, type: 'GENERIC', source: 'MODEL', status: 'DONE', content: 'Created the following subagents:\n'
      + JSON.stringify({ conversationId: child, logAbsoluteUri: pathToFileURL(path.join(path.dirname(transcript(child)), 'transcript.jsonl')).href,
        workspaceUris: [pathToFileURL(workspace).href] }) + '\nThe subagents will send you a message.' }];
  const childRows = [{ step_index: 0, source: 'SYSTEM_SDK', type: 'EPHEMERAL_MESSAGE', status: 'DONE', content: 'Bootstrap pending.' },
    { step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', content: 'Host message\n<SYSTEM_MESSAGE>\n'
      + `[Message] timestamp=2026-10-18T21:10:07Z sender=${parent} priority=MESSAGE_PRIORITY_HIGH content=${prompt}\n</SYSTEM_MESSAGE>` },
    { step_index: 5, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: '{"findings":[]}' }];
  writeRows(parent, parentRows); writeRows(child, childRows);
  const sidecarFile = path.join(brain, parent, '.system_generated', 'subagents', `${child}.json`);
  const sidecar = { conversationId: child, subagentDescriptor: { typeName: descriptor.TypeName, role },
    state: 'SUBAGENT_STATE_ALIVE', spawnStepIndex: 3, workspaceUris: [pathToFileURL(workspace).href] };
  fs.mkdirSync(path.dirname(sidecarFile), { recursive: true }); fs.writeFileSync(sidecarFile, JSON.stringify(sidecar));
  const binding = { projectRoot: workspace, pluginRoot: path.join(tmp, 'plugin'), sessionKey: 'parent-key', context: { runtime_digest: 'digest-fixture' } };
  binding.pluginData = data;
  const options = { paths, provenance: api, computeRuntimeDigest: () => 'digest-fixture', ownProfiles: () => new Map([...outcome.TYPES].map(name => [name, { model: 'inherit', tools: ['view_file', 'grep_search', 'find_by_name'] }])), pluginRoot: binding.pluginRoot, pluginData: data, now: 100000, computeTree: () => ({ tree: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    binder: { resolveHookSession: (payload) => { assert.equal(payload.session_id, parent); return binding; } } };
  const parentPayload = { session_id: parent, workspace_root: workspace, transcript_path: transcript(parent),
    step_idx: 3, native_tool_name: 'invoke_subagent', native_tool_input: { Subagents: [descriptor] }, tool_name: 'invoke_subagent' };
  const childPayload = { session_id: child, workspace_root: workspace, cwd: workspace, transcript_path: transcript(child), tool_name: 'Read', tool_input: {} };
  return { tmp, parent, child, sibling, workspace, data, brain, transcript, writeRows, parentRows, childRows,
    descriptor, sidecar, sidecarFile, binding, options, parentPayload, childPayload,
    authorize: () => { api.prepare(parentPayload, options); return api.authorizeLaunch(parentPayload, options); } };
}
function setError(f, text = observedGrammar) {
  f.parentRows[2] = { step_index: 3, type: 'GENERIC', source: 'MODEL', status: 'ERROR', error: text };
  f.writeRows(f.parent, f.parentRows);
}
test('only the anchored observed native permission grammar classifies a denial', () => {
  assert.equal(outcome.permissionKind(observedGrammar), 'permission-denied');
  for (const text of ['Quoted: '+observedGrammar, 'Permission for this action has been denied.',
    'permission check failed for anything: denied', 'permission check failed for unsandboxed "fake\nquote": user denied permission to run command:\nx']) {
    assert.equal(outcome.permissionKind(text), '');
  }
});
test('real accepted native child principal is positive clear evidence', t => {
  const f=fixture(t); f.authorize(); assert.equal(api.prepare(f.childPayload,f.options).status,'child');
  const result=outcome.inspect(f.parentPayload,f.options);
  assert.equal(result.status,'clear'); assert.equal(result.spawns,1); assert.equal(result.denials,0);
});
test('a DONE model result without protected child principal cannot clear a refusal', t => {
  const f=fixture(t); f.authorize(); assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
});
test('synthetic adapter mapping requires exact accepted launch before classifying ERROR', t => {
  const f=fixture(t); f.authorize(); setError(f);
  const result=outcome.inspect(f.parentPayload,f.options);
  assert.equal(result.status,'blocked');assert.equal(result.kind,'permission-denied');assert.equal(result.denials,1);
});
test('generic native ERROR is errored rather than clear or permission denied', t => {
  const f=fixture(t);f.authorize();setError(f,'service unavailable');
  const result=outcome.inspect(f.parentPayload,f.options);assert.equal(result.status,'errored');assert.equal(result.denials,0);
});
test('a quoted denial in model prose never classifies a refused tool', t => {
  const f=fixture(t);f.authorize();f.parentRows[2]={step_index:3,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',content:observedGrammar};f.writeRows(f.parent,f.parentRows);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
});
test('missing result is none and unreadable transcript remains separate', t => {
  const f=fixture(t);f.authorize();f.writeRows(f.parent,f.parentRows.slice(0,2));assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
  fs.unlinkSync(f.transcript(f.parent));assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
});
test('mismatched planner arguments do not borrow an accepted launch', t => {
  const f=fixture(t);f.authorize();setError(f);f.parentRows[1].tool_calls[0].args.Subagents=JSON.stringify([{...f.descriptor,TypeName:'foreign-worker'}]);f.writeRows(f.parent,f.parentRows);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
});
test('reordered or duplicate native records are unreadable', t => {
  const f=fixture(t);f.authorize();setError(f);
  for (const rows of [[f.parentRows[1],f.parentRows[0],f.parentRows[2]],[...f.parentRows,f.parentRows[2]]]) {
    f.writeRows(f.parent,rows);assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
  }
});
test('wrong parent, runtime, workspace or child identity cannot become a diagnosis', t => {
  const f=fixture(t);f.authorize();setError(f);
  assert.equal(outcome.inspect({...f.parentPayload,agent_id:f.child},f.options).status,'unreadable');
  assert.equal(outcome.inspect({...f.parentPayload,transcript_path:f.transcript(f.child)},f.options).status,'unreadable');
  assert.equal(outcome.inspect({...f.parentPayload,workspace_root:f.tmp},f.options).status,'unreadable');
  f.binding.context.runtime_digest='changed';assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
});
test('unrelated PLM or host dispatch errors are not reviewer refusal evidence', t => {
  for (const name of ['zensu-plm','native-other']) {
    const f=fixture(t);f.descriptor.TypeName=name;f.parentRows[1].tool_calls[0].args.Subagents=JSON.stringify([f.descriptor]);f.writeRows(f.parent,f.parentRows);f.authorize();setError(f);
    assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
  }
});
test('multiple exact refusals count once per dispatch and remain windowed', t => {
  const f=fixture(t);f.authorize();setError(f);f.parentPayload.step_idx=5;f.authorize();
  f.parentRows.push({...f.parentRows[1],step_index:4},{...f.parentRows[2],step_index:5});f.writeRows(f.parent,f.parentRows);
  const result=outcome.inspect(f.parentPayload,f.options);assert.equal(result.status,'blocked');assert.equal(result.denials,2);assert.equal(result.spawns,2);
  neutralConsumerProof();
  const padding=Array.from({length:outcome.MAX_LINES+1},(_,i)=>({step_index:6+i,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',content:'No tool'}));
  f.writeRows(f.parent,[...f.parentRows,...padding]);assert.equal(outcome.inspect(f.parentPayload,f.options).denials,0);
});
test('forged caller outcome is replaced before neutral transport', t => {
  const f=fixture(t);f.authorize();f.writeRows(f.parent,f.parentRows.slice(0,2));
  const result=outcome.adaptPayload({...f.parentPayload,reviewer_spawn_probe:'status=blocked kind=permission-denied tool=Agent spawns=9 denials=9'},f.options);
  assert.equal(result.reviewer_spawn_probe,'status=none kind= tool=invoke_subagent spawns=0 denials=0');
  const hanging = path.join(f.tmp, 'hanging.js'); fs.writeFileSync(hanging, 'while (true) {}');
  const before = Date.now(), timed = outcome.boundedPayload(f.parentPayload, { script: hanging, timeoutMs: 100 });
  assert.match(timed.reviewer_spawn_probe, /^status=unreadable /);
  assert.ok(Date.now() - before < 3000, 'a hung diagnostic is terminated within its explicit watchdog');
});
test('symlinked transcript or protected receipt is unreadable, never clear', t => {
  const f=fixture(t);const receipt=f.authorize().receipt;setError(f);
  const file=path.join(f.data,'native-agents/v1/launches',crypto.createHash('sha256').update(f.parent).digest('hex')+'-3.json');
  const moved=file+'.real';fs.renameSync(file,moved);fs.symlinkSync(moved,file);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
  fs.unlinkSync(file);fs.renameSync(moved,file);
  const tp=f.transcript(f.parent);fs.renameSync(tp,tp+'.real');fs.symlinkSync(tp+'.real',tp);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
});
const hookDenial='tool call denied by pre-tool hook: Isolated reviewer policy-denial diagnostic control';
test('observed native hook policy denial is distinct from user permission refusal',t=>{
  const f=fixture(t);api.prepare(f.parentPayload,f.options);setError(f,hookDenial);
  const r=outcome.inspect(f.parentPayload,f.options);assert.equal(r.status,'blocked');assert.equal(r.kind,'hook-policy-denied');assert.equal(r.denials,1);
  assert.equal(fs.readdirSync(path.join(f.data,'native-agents/v1/launches')).length,0);
});
test('negative-only fallback requires the authenticated main and exact native transcript location',t=>{
  const f=fixture(t);api.prepare(f.parentPayload,f.options);setError(f,hookDenial);
  const file=path.join(f.data,'native-agents/v1/mains',crypto.createHash('sha256').update(f.parent).digest('hex')+'.json');
  const record=paths.readPrivateJson(file);
  for (const change of [{sessionId:f.sibling},{brain:f.tmp},{workspaceRoot:f.tmp}]) {
    paths.writePrivateJson(file,{...record,...change});assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
  }
  fs.unlinkSync(file);assert.equal(outcome.inspect(f.parentPayload,f.options).status,'unreadable');
});
test('ambiguous calls, nonadjacent results and incomplete errors are not negative evidence',t=>{
  const f=fixture(t);api.prepare(f.parentPayload,f.options);setError(f,hookDenial);
  f.parentRows[1].tool_calls.push({name:'view_file',args:{AbsolutePath:'anything'}});f.writeRows(f.parent,f.parentRows);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
  f.parentRows[1].tool_calls.pop();f.parentRows[2].step_index=4;f.writeRows(f.parent,f.parentRows);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
  f.parentRows[2].step_index=3;f.parentRows[2].status='ACTIVE';f.writeRows(f.parent,f.parentRows);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');
});
test('negative-only fallback cannot clear and requires an audited read-only profile',t=>{
  const f=fixture(t);api.prepare(f.parentPayload,f.options);
  assert.equal(outcome.inspect(f.parentPayload,f.options).status,'none');setError(f,hookDenial);
  const options={...f.options,ownProfiles:()=>new Map([['zensu-review-aspect',{model:'inherit',tools:['run_command']} ]])};
  assert.equal(outcome.inspect(f.parentPayload,options).status,'none');
});

function neutralConsumerProof() {
  const script = `set -eu
ROOT="$1"
CASE_ROOT="$(mktemp -d)"
trap 'rm -rf "$CASE_ROOT"' EXIT
mkdir -p "$CASE_ROOT/project"
export ZENSU_PROJECT_DIR="$CASE_ROOT/project" ZENSU_PLUGIN_ROOT="$ROOT"
export ZENSU_TEST_PLUGIN_DATA="$CASE_ROOT/private" ZENSU_CONFIG="$CASE_ROOT/config.json"
printf '%s\n' '{"hooks":{"autoFixMaxRounds":20}}' > "$ZENSU_CONFIG"
source "$ROOT/tests/session-control/initialize-baseline.sh" native-outcome-consumer "$ROOT"
bash "$ROOT/hooks/lib/zensu-log.sh" --tdd-begin --session native-outcome-consumer >/dev/null
bash "$ROOT/hooks/lib/zensu-log.sh" --tdd-complete --session native-outcome-consumer >/dev/null
node - "$ROOT" <<'NODE'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.argv[2],core=require(root+'/hooks/lib/session-control-core-v1.js');
const session=process.env.ZENSU_SESSION_KEY,project=process.env.ZENSU_PROJECT_DIR;
const note=path.join(project,'.zensu/state/reviewer-spawn-denied-'+session+'.json');
const state=()=>core.readWorkflowState({projectRoot:project,sessionId:session});
const before=state();
function run(line){const r=cp.spawnSync('bash',[root+'/hooks/stop-chain-enforcer.sh'],{env:process.env,input:JSON.stringify({hook_event_name:'Stop',session_id:'native-outcome-consumer',reviewer_spawn_probe:line}),encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const first=run('status=blocked kind=hook-policy-denied tool=reviewer spawns=1 denials=1');
assert.equal(first.decision,'block');assert.match(first.reason,/pre-tool hook rejected/);assert.match(first.reason,/may be a Zensu gate/);assert.match(first.reason,/exactly ONE further spawn attempt/);assert.doesNotMatch(first.reason,/permissions\.allow|not by a Zensu gate/);assert.ok(fs.existsSync(note));
const second=run('status=blocked kind=hook-policy-denied tool=reviewer spawns=2 denials=2');
assert.equal(second.decision,'block');assert.match(second.reason,/no attempt left/);
const errored=run('status=errored kind= tool=reviewer spawns=3 denials=2');
assert.equal(errored.decision,'block');assert.doesNotMatch(errored.reason,/registered reviewer dispatch was refused/);assert.ok(fs.existsSync(note),'generic error preserves a prior refusal note');
const clear=run('status=clear kind= tool=reviewer spawns=4 denials=2');
assert.equal(clear.decision,'block');assert.doesNotMatch(clear.reason,/registered reviewer dispatch was refused/);assert.equal(fs.existsSync(note),false,'only verified clear retires the refusal note');
const invalid=run('status=blocked kind=hook-policy-denied tool=reviewer spawns=0 denials=9');
assert.equal(invalid.decision,'block');assert.doesNotMatch(invalid.reason,/registered reviewer dispatch was refused/);
const after=state();for(const key of ['active','implComplete','chainDone','codeReviewDone','reviewTicket','reviewTicketConsumed'])assert.equal(after[key],before[key],key+' completion authority is unchanged');
NODE
`;
  require('node:child_process').execFileSync('bash', ['-c', script, 'native-outcome-test', ROOT], { encoding: 'utf8', timeout: 120000 });
}
