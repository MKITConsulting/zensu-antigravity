'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../hooks/antigravity/review-artifacts.js');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-review-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const evidence=path.join(root,'plan.md'), manifest=path.join(root,'files.txt'), snapshot=path.join(root,'snapshot.json'), report=path.join(root,'report.json');
  fs.writeFileSync(evidence,'Plan step one\n'); fs.writeFileSync(manifest,evidence+'\n');
  const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  assert.equal(run('snapshot','--manifest',manifest,'--output',snapshot).status,0);
  const value={kind:'plan-review',role:'security-privacy',verdict:'go',confidence:'high',summary:'The supplied plan has a bounded read-only scope.',blockers:[],improvements:[],questions:[],strengths:['No new credential boundary.']};
  fs.writeFileSync(report,JSON.stringify(value)); return {root,evidence,manifest,snapshot,report,run,value};
}
test('native validation uses the canonical schema and exact expected role',t=>{
  const f=fixture(t);const args=['validate','--snapshot',f.snapshot,'--kind','plan-review','--role','security-privacy','--report',f.report];
  const r=f.run(...args);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).role,'security-privacy');
  args[6]='wrong-role';assert.notEqual(f.run(...args).status,0);
});
test('changed evidence invalidates both checks and reports',t=>{
 const f=fixture(t);fs.appendFileSync(f.evidence,'New unreviewed step\n');
 assert.notEqual(f.run('check','--snapshot',f.snapshot).status,0);
 assert.match(f.run('validate','--snapshot',f.snapshot,'--kind','plan-review','--role','security-privacy','--report',f.report).stderr,/evidence changed/);
});
test('snapshot output is create-once and rejects file aliases',t=>{
 const f=fixture(t);assert.notEqual(f.run('snapshot','--manifest',f.manifest,'--output',f.snapshot).status,0);
 const link=path.join(f.root,'alias.md');fs.symlinkSync(f.evidence,link);fs.writeFileSync(f.manifest,link+'\n');
 assert.notEqual(f.run('snapshot','--manifest',f.manifest,'--output',path.join(f.root,'second.json')).status,0);
});
test('a malformed report cannot be accepted by merely having the expected role',t=>{
 const f=fixture(t);fs.writeFileSync(f.report,JSON.stringify({...f.value,blockers:'none'}));
 assert.notEqual(f.run('validate','--snapshot',f.snapshot,'--kind','plan-review','--role','security-privacy','--report',f.report).status,0);
});
test('PR path inventories must themselves belong to the frozen evidence',t=>{
 const f=fixture(t), paths=path.join(f.root,'paths.txt');fs.writeFileSync(paths,'source.js\n');
 const result=f.run('validate','--snapshot',f.snapshot,'--kind','pr-review','--role','security','--report',f.report,'--paths',paths,'--production-paths',paths);
 assert.notEqual(result.status,0);assert.match(result.stderr,/outside the evidence snapshot/);
});
