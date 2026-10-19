#!/usr/bin/env bash
# The real agy importer truncates skill bodies at 24000 bytes. Keep the full
# mandatory procedure reachable and pin this lossless migration separately from
# prose checks that consume the expanded skill text.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node - "$ROOT" <<'NODE'
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=process.argv[2];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));
const migration=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/native-skill-instructions.json'),'utf8'));
const read=file=>fs.readFileSync(file,'utf8');
const body=text=>{
 const match=/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
 assert.ok(match,'skill has valid frontmatter boundaries');
 return text.slice(match[0].length);
};
assert.equal(migration.maxBodyBytes,24000);
assert.equal(manifest.skills.length,32);
for(const relative of manifest.skills){
 const file=path.join(root,relative,'SKILL.md');
 assert.ok(Buffer.byteLength(body(read(file)))<=migration.maxBodyBytes,`${relative}: native loader would truncate the body`);
}
assert.equal(migration.skills.length,7);
for(const entry of migration.skills){
 const dir=path.join(root,'skills',entry.skill), main=body(read(path.join(dir,'SKILL.md')));
 const section=/<!-- zensu:mandatory-instructions -->\n[\s\S]*?<!-- \/zensu:mandatory-instructions -->\n\n/.exec(main);
 assert.ok(section,`${entry.skill}: mandatory preload instructions missing`);
 assert.match(section[0],/Before\nasking workflow questions, running commands, changing state/);
 assert.match(section[0],/every file below in the listed order, in full/);
 assert.match(section[0],/If a read is truncated, continue/);
 assert.match(section[0],/If a file cannot be read, report[\s\S]*stop this workflow/);
 const linked=[...section[0].matchAll(/\]\(\.\/(instructions-\d+\.md)\)/g)].map(match=>match[1]);
 assert.deepEqual(linked,entry.parts.slice(1),`${entry.skill}: missing or reordered continuation`);
 assert.deepEqual(fs.readdirSync(dir).filter(name=>/^instructions-\d+\.md$/.test(name)).sort(),linked,`${entry.skill}: orphan instruction part`);
 const chunks=linked.map(name=>read(path.join(dir,name)));
 for(let index=0;index<chunks.length;index++)assert.ok(Buffer.byteLength(chunks[index])<=migration.maxBodyBytes,`${entry.skill}/${linked[index]} exceeds the native bound`);
 const original=main.replace(section[0],'')+chunks.join('');
 assert.equal(crypto.createHash('sha256').update(original).digest('hex'),entry.bodySha256,`${entry.skill}: split lost or changed an instruction`);
}
console.log('PASS: all 32 native skill bodies fit; all 7 split procedures preload and reassemble without instruction loss');
NODE
