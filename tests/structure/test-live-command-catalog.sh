#!/usr/bin/env bash
# A new registered command must have its own live resolution probe; every
# positive probe pins the skill identity and the unknown control stays negative.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
node - "$ROOT" <<'NODE'
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),root=process.argv[2];
const yaml=require(path.join(root,'node_modules/js-yaml'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));
const registered=manifest.skills.map(dir=>path.basename(dir)).map(name=>name==='zensu-help'?name:'zensu-'+name).sort();
const rows=yaml.load(fs.readFileSync(path.join(root,'evals/promptfoo/live/scenarios/commands.yaml'),'utf8'));
const positive=rows.filter(row=>row.vars.scenario_id!=='live-command-negative-control');
assert.deepEqual(positive.map(row=>row.vars.command).sort(),registered);
for(const row of positive){
  const v=row.vars;assert.equal(v.probe,'command');
  const directory=v.command==='zensu-help'?'zensu-help':v.command.replace(/^zensu-/, '');
  const skill=yaml.load(fs.readFileSync(path.join(root,'skills',directory,'SKILL.md'),'utf8').split(/^---\s*$/m)[1]);
  assert.equal(v.expected_skill,skill.name);
  assert.ok(v.expect.stdout_contains_any.includes(`RESOLVED ${v.command} ->`));
  assert.ok(v.expect.stdout_not_contains.includes('UNRESOLVED'));
}
assert.equal(rows.filter(row=>row.vars.scenario_id==='live-command-negative-control').length,1);
assert.ok(!registered.includes(rows.find(row=>row.vars.scenario_id==='live-command-negative-control').vars.command));
console.log(`PASS: all ${registered.length} registered commands have exact-skill live probes plus one negative control`);
NODE
