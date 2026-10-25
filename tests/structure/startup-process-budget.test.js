'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

test('the complete packaged startup keeps all context within the process-start budget', { timeout: 60000 }, t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-startup-budget-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, 'project'), user = path.join(temporary, 'user');
  fs.mkdirSync(project); fs.mkdirSync(user, { mode: 0o700 });
  let result = spawnSync('bash', [path.join(root, 'install.sh'), '--portable-stage-only', path.join(temporary, 'stage')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plugin = path.join(temporary, 'stage/zensu');
  const preload = path.join(temporary, 'offline-user.cjs');
  // Offline isolation only: no host, credentials, provider or native-evidence claim.
  fs.writeFileSync(preload, `const os=require('node:os'),original=os.userInfo;os.userInfo=(...args)=>({...original(...args),homedir:${JSON.stringify(user)}});`);
  const bin = path.join(temporary, 'bin'), count = path.join(temporary, 'starts');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/bash\nprintf 'node\\n' >> ${quote(count)}\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o755 });
  const environment = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
    NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, ZENSU_CONFIG: path.join(temporary, 'config.json') };
  fs.writeFileSync(environment.ZENSU_CONFIG, '{}');
  for (const key of ['ZENSU_PLUGIN_ROOT', 'ZENSU_PLUGIN_DATA', 'ZENSU_PROJECT_DIR', 'ZENSU_SHIM_TRACE', 'ZENSU_SHIM_DECISIONS']) delete environment[key];
  result = spawnSync('bash', [path.join(plugin, 'hooks/antigravity/antigravity-shim.sh'), 'pre-invocation-chain.sh', 'PreInvocation'], {
    cwd: project, env: environment, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024,
    input: JSON.stringify({ session_id: 'offline-startup-budget', workspacePaths: [project], prompt: 'Implement directly; no TDD.' }),
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const text = JSON.parse(result.stdout).injectSteps[0].ephemeralMessage;
  assert.ok(text.includes('Zensu Session Control is bound'), 'native session context remains present');
  assert.ok(/evidence discipline/i.test(text), 'evidence discipline remains present');
  assert.ok(text.includes('not a git repository, pulse session skipped'), 'pulse outcome remains present');
  assert.ok(text.includes('Zensu PLM plugin is active'), 'startup primer remains present');
  assert.ok(text.includes('--helper ai-work -- begin'), 'authenticated capture helper remains present');
  assert.ok(text.includes('Only a human can accept or revoke'), 'human acceptance boundary remains present');
  const starts = fs.readFileSync(count, 'utf8').trim().split('\n').length;
  // The former shell composition launched 112 Node processes for this startup.
  // Count process starts instead of asserting timing on a contended CI worker.
  assert.ok(starts <= 80, `startup launched ${starts} Node processes (budget 80)`);
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks.json'), 'utf8'));
  assert.equal(manifest['zensu-pre-invocation'].PreInvocation[0].timeout, 90);
});
