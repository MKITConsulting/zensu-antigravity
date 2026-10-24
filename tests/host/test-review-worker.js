'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../../hooks/lib/in-thread-review-v1.js');
const worker = require('../../hooks/antigravity/worker-launch.js');
const renderer = require('../../hooks/antigravity/render-context.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const core = require('../../hooks/lib/session-control-core-v1.js');
const bootstrap = require('../../hooks/antigravity/session-bootstrap.js').bootstrap;
const ticket = 'review-ticket-123';
const lease = { schema: review.schema, execution: 'in-thread', ticket, tree: 'tree-1',
  expiresAt: 1000, roles: ['correctness', 'security'] };
const report = () => ({ schema: review.schema, execution: 'in-thread', ticket, tree: 'tree-1',
  perspectives: lease.roles.map(role => ({ role, summary: 'Reviewed the changed implementation and its evidence.', findings: [] })) });

test('sequential review requires every configured perspective on the leased tree', () => {
  assert.equal(review.validateReport(report(), lease, 'tree-1', 10).ticket, ticket);
  assert.throws(() => review.validateReport(report(), lease, 'changed-tree', 10), /changed/);
  assert.throws(() => review.validateReport(report(), lease, 'tree-1', 1000), /expired/);
  for (const change of [r => r.perspectives.pop(), r => r.perspectives[1].role = 'correctness',
    r => r.perspectives[0].summary = '', r => r.execution = 'independent-agents', r => r.ticket = 'another-ticket']) {
    const r = report(); change(r); assert.throws(() => review.validateReport(r, lease, 'tree-1', 10));
  }
});

test('disabled aspect activation preserves the complete chosen panel on re-review', () => {
  const lean = ['correctness', 'design', 'security'];
  const full = ['conventions', 'bugs', 'architecture', 'tests', 'security'];
  for (const enabled of [false, true]) {
    assert.deepEqual(review.reviewRoles('lean', 0, enabled), lean);
    assert.deepEqual(review.reviewRoles('full', 0, enabled), full);
    assert.deepEqual(review.reviewRoles('full', 2, enabled), full);
  }
  assert.deepEqual(review.reviewRoles('lean', 2, false), lean);
  assert.deepEqual(review.reviewRoles('lean', 2, true), ['correctness']);
  const required = { ...lease, roles: review.reviewRoles('lean', 2, false) };
  const reduced = { ...report(), perspectives: [report().perspectives[0]] };
  assert.throws(() => review.validateReport(reduced, required, 'tree-1', 10), /perspective/);
});

test('review findings require concrete source evidence and safe relative locations', () => {
  const r = report();
  r.perspectives[0].findings.push({ severity: 'important', file: 'src/index.js', line: 8,
    description: 'The error path loses the original error.', evidence: 'A failing read returns an empty success value.' });
  assert.equal(review.validateReport(r, lease, 'tree-1', 10), r);
  for (const [key, value] of [['file', '../outside.js'], ['file', '/tmp/outside'], ['line', 0],
    ['severity', 'info'], ['evidence', '']]) {
    const copy = structuredClone(r); copy.perspectives[0].findings[0][key] = value;
    assert.throws(() => review.validateReport(copy, lease, 'tree-1', 10));
  }
});

test('review CLI rejects ambiguous submission and legacy agent completion', () => {
  assert.equal(review.argumentsOf(['--begin', '--ticket', ticket])['--begin'], true);
  for (const args of [['--begin', '--report', '/tmp/report.json', '--ticket', ticket],
    ['--ticket', ticket, '--report', 'relative.json'], ['--begin', '--ticket', ticket, '--ticket', ticket]]) {
    assert.throws(() => review.argumentsOf(args));
  }
  assert.throws(() => review.assertCompletion({ tool_name: 'Agent', tool_input: {} }), /validated/);
});

test('worker uses actual native resume syntax and refuses invented session aliases', (t) => {
  const order = '11111111-1111-4111-8111-111111111111';
  const conversation = '22222222-2222-4222-8222-222222222222';
  const parsed = worker.parseLauncherArgs(['--order', order, '--conversation', conversation, '--project', '/tmp/project']);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(worker.runtimeArguments(parsed.options), ['--conversation', conversation, '--add-dir', '/tmp/project',
    '--output-format', 'stream-json', '-p', `/zensu-work ${order}`]);
  for (const args of [['--session-id', conversation], ['--prepare', '--project', 'relative'],
    ['--prepare', '--project', '/tmp/project', '--conversation', conversation]]) {
    assert.ok(worker.parseLauncherArgs(args).error);
  }
  assert.equal(worker.translate({ type: 'result', success: true }), null);
  assert.equal(worker.prepared('forged-alias', '/tmp/project'), false);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-worker-argv-')));
  t.after(() => fs.rmSync(tmp, {recursive:true,force:true}));
  const bin = path.join(tmp,'bin'), captured = path.join(tmp,'argv');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'agy'), '#!/bin/bash\nprintf "%s\\0" "$@" > "$WORKER_ARGS_FILE"\nexit 17\n', {mode:0o700});
  assert.throws(() => worker.prepare({project:tmp}, {PATH:bin+path.delimiter+process.env.PATH,WORKER_ARGS_FILE:captured}), /preparation did not complete/);
  const invoked = fs.readFileSync(captured,'utf8').split('\0').filter(Boolean);
  assert.deepEqual(invoked.slice(0,6), ['--add-dir',tmp,'--output-format','json','--print-timeout','120s']);
});

test('dynamic directives use the exact conversation wrapper and honest plan semantics', () => {
  const input = 'Run ZENSU_PLUGIN_DATA=/private/store bash /installed/hooks/lib/zensu-log.sh --chain-status. Then bash /installed/hooks/lib/zensu-full-suite.sh --status';
  const rendered = renderer.render(input, 'stop-chain-enforcer.sh', { session_id: 'native-session-1' });
  assert.match(rendered, /--session 'native-session-1' --helper log -- --chain-status/);
  assert.match(rendered, /--helper full-suite -- --status/);
  assert.doesNotMatch(rendered, /ZENSU_PLUGIN_DATA|hooks\/lib/);
  const primer = renderer.render('the plan-approval hook directs you to ASK Use /zensu-zensu-help. This is a one-time per-session orientation; the plan-approval hook gives the authoritative directive at approval time.', 'session-start-primer.sh', { session_id: 'native-session-1' });
  assert.match(primer, /no native plan-approval event/);
  assert.doesNotMatch(primer, /\/zensu-zensu-help|hook directs/);
});

function assertBoundReviewReceipt(t, execution) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-review-receipt-')));
  t.after(() => fs.rmSync(tmp, {recursive:true,force:true}));
  const project = path.join(tmp,'project'), data = path.join(tmp,'data'), home = path.join(tmp,'home');
  for(const dir of [project,data,home]) fs.mkdirSync(dir,{mode:0o700});
  const git = args => { const r=cp.spawnSync('git',args,{cwd:project,encoding:'utf8'});assert.equal(r.status,0,r.stderr); };
  git(['init','-q']); git(['config','user.email','fixture@example.invalid']); git(['config','user.name','Fixture']);
  fs.writeFileSync(path.join(project,'.gitignore'),'.zensu/\n');
  fs.writeFileSync(path.join(project,'source.txt'),'reviewed source\n');
  git(['add','.']);git(['commit','-qm','test: establish review fixture']);
  const sid='review-native-bound';
  bootstrap({session_id:sid,workspace_root:project},{pluginRoot:root,pluginData:data});
  core.mutateWorkflowState({projectRoot:project,sessionId:sid,workflowState:'fixture',event:'fixture'},s=>Object.assign(s,{active:true,implComplete:true,reviewRound:1}));
  const config=path.join(tmp,'config.json');fs.writeFileSync(config,'{"hooks":{"reviewPanel":"lean","aspectActivation":false}}');
  const env={PATH:process.env.PATH,HOME:home,ZENSU_PLUGIN_ROOT:root,ZENSU_PLUGIN_DATA:data,
    ZENSU_PROJECT_DIR:project,ZENSU_HOST_SESSION_ID:sid,ZENSU_CONFIG:config,ZENSU_REVIEW_EXECUTION:execution};
  const packet = require('../../hooks/antigravity/native-review-packet.js');
  const fixturePacket = {schema:'zensu-review-packet-v1',payload:{evidence:'isolated routing fixture'}};
  const runReview = argv => review.main(argv, env, { execution,
    prepareLease:lease=>execution==='delegated'?{...lease,packet:fixturePacket,packetHash:'a'.repeat(64),primaryRequired:false}:lease,
    verifyReport: (report, lease, binding) => {
    const native = require('../../hooks/antigravity/native-review.js');
    const crypto = require('node:crypto');
    return native.verifyReport(report, lease, binding, {parentId:sid,validatePacket:()=>{},completedChild:(parentId,childId) => {
      if(childId===report.consumer.childId) {
        const finalText=JSON.stringify({schema:'zensu-code-review-result-v1',report:'# Code Review Report\n- Verdict: PASS'});
        return {parentId,childId,runtimeDigest:binding.context.runtime_digest,sourceTree:lease.tree,descriptor:{typeName:'zensu-code-reviewer',role:'consume',prompt:native.assignmentPrefix(lease.ticket,lease.tree,'consume')+packet.block(lease.packet)},finalText,finalHash:crypto.createHash('sha256').update(finalText).digest('hex')};
      }
      const item=report.perspectives.find(p=>p.childId===childId);
      const finalText=JSON.stringify({schema:native.childSchema,ticket:lease.ticket,tree:lease.tree,role:item.role,summary:item.summary,findings:item.findings});
      return {parentId,childId,runtimeDigest:binding.context.runtime_digest,sourceTree:lease.tree,descriptor:{typeName:'zensu-review-aspect',role:item.role,prompt:native.assignmentPrefix(lease.ticket,lease.tree,item.role)+packet.block(lease.packet)+'Inspect source.txt'},finalText,finalHash:crypto.createHash('sha256').update(finalText).digest('hex')};
    }});
  }});
  const issued=cp.spawnSync('bash',[path.join(root,'hooks/lib/zensu-log.sh'),'--review-ticket'],{cwd:project,env,encoding:'utf8',timeout:30000});
  assert.equal(issued.status,0,issued.stderr);const token=issued.stdout.trim();assert.ok(token);
  const begun=runReview(['--begin','--ticket',token]);
  if(execution==='delegated') Object.assign(begun.reportTemplate,{judges:[],consumer:{childId:'fixture-consume-child'}});
  assert.deepEqual(begun.roles,['correctness','design','security']);
  assert.deepEqual(begun.reportTemplate.perspectives.map(p=>p.role),begun.roles);
  for(const [index,perspective] of begun.reportTemplate.perspectives.entries()) {
    perspective.summary='Inspected the current source and its failure paths.';
    if(execution==='delegated') perspective.childId=`fixture-child-${index}`;
  }
  const reportFile=path.join(tmp,'report.json');fs.writeFileSync(reportFile,JSON.stringify(begun.reportTemplate));
  fs.writeFileSync(path.join(project,'source.txt'),'changed after review\n');
  assert.throws(()=>runReview(['--ticket',token,'--report',reportFile]),/changed/);
  fs.writeFileSync(path.join(project,'source.txt'),'reviewed source\n');
  if(execution==='delegated') assert.throws(()=>review.main(['--ticket',token,'--report',reportFile],env,{execution}),/trusted evidence verifier/);
  const accepted=runReview(['--ticket',token,'--report',reportFile]);
  assert.equal(accepted.execution,execution);
  if(execution==='delegated') assert.equal(accepted.assurance.children.length,3);
  assert.ok(accepted.directive);assert.equal(core.readWorkflowState({projectRoot:project,sessionId:sid}).reviewTicketConsumed,true);
  assert.equal(runReview(['--ticket',token,'--report',reportFile]).reportHash,accepted.reportHash);
  const changed=begun.reportTemplate;changed.perspectives[0].summary='A different report.';
  fs.writeFileSync(reportFile,JSON.stringify(changed));
  assert.throws(()=>runReview(['--ticket',token,'--report',reportFile]),/different content/);
  const closed=core.mutateWorkflowState({projectRoot:project,sessionId:sid,workflowState:'fixture',event:'fixture-close'},s=>Object.assign(s,{chainDone:true}));
  const before=JSON.stringify(closed), status=runReview(['--begin','--ticket',token]);
  assert.equal(status.status,'closed');assert.equal(status.reportOnly,true);
  assert.equal(JSON.stringify(core.readWorkflowState({projectRoot:project,sessionId:sid})),before,'closed re-entry never changes the generation');
  assert.throws(()=>runReview(['--begin','--ticket','foreign-ticket']),/current implementation-complete/);
}
test('a real bound in-thread review consumes one ticket, rejects source drift and replays only its exact report', (t) => {
  assertBoundReviewReceipt(t, 'in-thread');
});
test('a real bound delegated review consumes one ticket, rejects source drift and replays only its exact report', (t) => {
  assertBoundReviewReceipt(t, 'delegated');
});
