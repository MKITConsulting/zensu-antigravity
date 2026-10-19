#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node - "$ROOT" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = process.argv[2];
const helper = path.join(root, 'tests/prepare-runtime.js');
const { prepareRuntime } = require(helper);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-bootstrap-test-'));
function fixture(name) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(root, 'hooks.json.template'), path.join(dir, 'hooks.json.template'));
  return dir;
}
(async () => {
  try {
    const fresh = fixture('fresh');
    prepareRuntime(fresh);
    const target = path.join(fresh, 'hooks.json');
    const data = fs.readFileSync(target, 'utf8');
    const manifest = JSON.parse(data);
    assert.equal(Object.keys(manifest).length, 4);
    assert.ok(data.includes(fs.realpathSync(fresh) + '/hooks/antigravity/antigravity-shim.sh'));
    assert.ok(!data.includes('__ZENSU_HOME__'));
    console.log('PASS clean checkout receives the complete rendered native hook manifest');

    const custom = '{ "existing": true }\n';
    fs.writeFileSync(target, custom);
    const before = fs.statSync(target, { bigint: true });
    prepareRuntime(fresh);
    assert.equal(fs.readFileSync(target, 'utf8'), custom);
    assert.equal(fs.statSync(target, { bigint: true }).mtimeNs, before.mtimeNs);
    console.log('PASS existing generated output remains byte-for-byte and metadata unchanged');

    fs.writeFileSync(target, 'invalid JSON');
    assert.throws(() => prepareRuntime(fresh));
    assert.equal(fs.readFileSync(target, 'utf8'), 'invalid JSON');
    console.log('PASS malformed existing output is refused without repair');

    const linked = fixture('linked');
    fs.symlinkSync(target, path.join(linked, 'hooks.json'));
    assert.throws(() => prepareRuntime(linked), /regular file/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'invalid JSON');
    console.log('PASS symlinks are refused without touching their target');

    const invalid = fixture('invalid-template');
    fs.writeFileSync(path.join(invalid, 'hooks.json.template'), '{');
    assert.throws(() => prepareRuntime(invalid));
    assert.equal(fs.existsSync(path.join(invalid, 'hooks.json')), false);
    console.log('PASS malformed templates never publish a partial manifest');

    const concurrent = fixture('concurrent');
    await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [helper, concurrent], { stdio: ['ignore', 'ignore', 'pipe'] });
      let error = '';
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || `exit ${code}`)));
    })));
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(concurrent, 'hooks.json'), 'utf8'))).length, 4);
    assert.deepEqual(fs.readdirSync(concurrent).sort(), ['hooks.json', 'hooks.json.template']);
    console.log('PASS concurrent preparation publishes once without leftovers or partial reads');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
