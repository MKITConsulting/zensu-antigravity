#!/usr/bin/env bash
# The README links to the documented engine inventory. Compare its distinct
# scripts to actual dispatcher expansion so documentation cannot omit a gate.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node - "$ROOT" <<'NODE'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.argv[2],readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
const doc=fs.readFileSync(path.join(root,'docs/configuration.md'),'utf8');
assert.match(readme,/\]\(docs\/configuration\.md(?:#[^)]+)?\)/,'README must link to the configuration inventory');
const section=doc.split('## Hook inventory\n')[1]?.split('\n### ')[0];
assert.ok(section,'configuration must have an explicit hook inventory');
const documented=[...new Set([...section.matchAll(/^\| `([^`]+\.sh)` \|/gm)].map(m=>m[1]))].sort();
const registered=[...new Set(require(path.join(root,'tests/structure/antigravity-wiring.js')).inventory(root).map(row=>row.script))].sort();
assert.ok(registered.length>0,'dispatcher inventory cannot be empty');
assert.deepEqual(documented,registered,'documented scripts must exactly match executable dispatcher inventory');
for(const match of readme.matchAll(/Hooks \((\d+)\)|#hooks-(\d+)/g)) {
  assert.equal(Number(match[1]||match[2]),registered.length,'any README hook-count reference must match the inventory');
}
console.log(`PASS README configuration link and ${registered.length} documented dispatcher scripts match`);
NODE
