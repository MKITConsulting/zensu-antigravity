#!/usr/bin/env node
'use strict';

// Prepare disposable inputs only. Trust and native execution remain separate,
// explicitly authorized operator actions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const yaml = require('js-yaml');

function physicalDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)
      || fs.realpathSync.native(value) !== path.resolve(value) || !fs.lstatSync(value).isDirectory()) {
    throw Error('An existing absolute physical directory is required');
  }
  return path.resolve(value);
}

function catalogScenarioIds(directory = __dirname) {
  const configPath = path.join(directory, 'promptfooconfig.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config?.tests) || !config.tests.length) throw Error('The live config contains no scenario catalogs');
  const files = config.tests.map(value => {
    if (typeof value !== 'string' || !/^file:\/\/scenarios\/[A-Za-z0-9._-]+\.yaml$/.test(value)) {
      throw Error('The live config contains an unsupported scenario catalog');
    }
    return value.slice('file://'.length);
  });
  if (new Set(files).size !== files.length) throw Error('The live config repeats a scenario catalog');
  const ids = [];
  for (const relative of files) {
    const file = path.join(directory, relative);
    if (!fs.lstatSync(file).isFile()) throw Error('Scenario catalogs must be regular files');
    const tests = yaml.load(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(tests) || !tests.length) throw Error(`${relative} contains no scenarios`);
    for (const test of tests) {
      const id = test?.vars?.scenario_id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw Error(`${relative} contains an invalid scenario_id`);
      if (ids.includes(id)) throw Error(`Duplicate scenario_id: ${id}`);
      ids.push(id);
    }
  }
  if (ids.length !== 45) throw Error(`Expected the existing 45 live scenarios, found ${ids.length}`);
  const hashes = Object.fromEntries(['promptfooconfig.yaml', ...files].map(relative => [
    relative, createHash('sha256').update(fs.readFileSync(path.join(directory, relative))).digest('hex'),
  ]));
  return { ids, files, hashes };
}

function prepare(pluginDirectory, temporaryParent = fs.realpathSync.native(os.tmpdir()), catalogDirectory = __dirname) {
  const pluginRoot = physicalDirectory(pluginDirectory);
  const parent = physicalDirectory(temporaryParent);
  const temporaryRoots = [os.tmpdir(), '/tmp'].filter(value => fs.existsSync(value)).map(value => fs.realpathSync.native(value));
  if (!temporaryRoots.some(root => parent === root || parent.startsWith(root + path.sep))) {
    throw Error('The evidence parent must be inside temporary storage');
  }
  for (const relative of ['plugin.json', 'hooks.json', 'hooks/antigravity/antigravity-shim.sh',
    'hooks/lib/zensu-log.sh', 'hooks/lib/session-control-core-v1.js']) {
    if (!fs.lstatSync(path.join(pluginRoot, relative)).isFile()) throw Error(`Frozen native plugin file is missing: ${relative}`);
  }
  const catalog = catalogScenarioIds(physicalDirectory(catalogDirectory));
  const runtimeDigest = require(path.join(pluginRoot, 'hooks/lib/session-control-core-v1.js')).computeRuntimeDigest(pluginRoot, 'native');
  const evidenceDir = fs.mkdtempSync(path.join(parent, 'zensu-agy-live-interactive-'));
  fs.chmodSync(evidenceDir, 0o700);
  const workspaces = path.join(evidenceDir, 'workspaces');
  fs.mkdirSync(workspaces, { mode: 0o700 });
  const registry = { entries: [{ path: path.dirname(pluginRoot), include_only: [path.basename(pluginRoot)] }] };
  const entries = catalog.ids.map(scenarioId => {
    const workspace = path.join(workspaces, `zensu-live-${randomBytes(8).toString('hex')}`);
    fs.mkdirSync(workspace, { mode: 0o700 });
    fs.writeFileSync(path.join(workspace, 'note.txt'), 'probe workspace\n', { mode: 0o600, flag: 'wx' });
    fs.mkdirSync(path.join(workspace, '.agents'), { mode: 0o700 });
    fs.writeFileSync(path.join(workspace, '.agents/plugins.json'), JSON.stringify(registry, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' });
    return { scenarioId, workspace };
  });
  const manifest = path.join(evidenceDir, 'workspaces.json');
  fs.writeFileSync(manifest, JSON.stringify({ schema: 'zensu-live-workspaces-v1', entries }, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  const result = { schema: 'zensu-live-preparation-v1', pluginRoot, runtimeDigest, evidenceDir, manifest,
    scenarioCount: entries.length, catalogHashes: catalog.hashes, trustChanged: false, nativeStarted: false,
    env: { ZENSU_LIVE_AGY: '1', ZENSU_LIVE_INTERACTIVE: '1', ZENSU_LIVE_PLUGIN_ROOT: pluginRoot,
      ZENSU_LIVE_EVIDENCE_DIR: evidenceDir, ZENSU_LIVE_WORKSPACE_MANIFEST: manifest } };
  fs.writeFileSync(path.join(evidenceDir, 'preparation.json'), JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  return result;
}

module.exports = { catalogScenarioIds, prepare };
if (require.main === module) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) throw Error('Usage: prepare-interactive.js <frozen-plugin-root> [temp-parent]');
    process.stdout.write(JSON.stringify(prepare(process.argv[2], process.argv[3]), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`Interactive live preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
