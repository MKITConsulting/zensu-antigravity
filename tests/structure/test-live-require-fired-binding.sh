#!/usr/bin/env bash
# Resolve each required live trace pair through the shipped chain inventory.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node - "$ROOT" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),root=process.argv[2];
const rows=require(root+'/tests/structure/antigravity-wiring.js').inventory(root);
const registered=new Set(rows.map(r=>r.event+':'+r.script));
const text=fs.readFileSync(root+'/evals/promptfoo/live/scenarios/hooks.yaml','utf8');
assert.ok(!/^\s*require_fired:\s*$/m.test(text),'require_fired must remain one string');
const lists=[...text.matchAll(/^\s*require_fired:\s*"([^"]+)"/gm)];
assert.ok(lists.length>0,'no live firing requirements');
for(const list of lists)for(const pair of list[1].split(/\s+/))assert.ok(registered.has(pair),pair+' has no live dispatcher registration');
console.log('PASS: every live firing requirement reaches a shipped chain entry');
NODE
