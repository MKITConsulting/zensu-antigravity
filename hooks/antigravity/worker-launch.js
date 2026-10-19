'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const paths = require('./session-paths.js');
const core = require('../lib/session-control-core-v1.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = 'launcher.js --prepare --project <directory> | --order <uuid> --conversation <prepared-uuid> --project <directory> [--mode accept-edits|plan] [--log <file>]';
function parseLauncherArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!['prepare', 'order', 'conversation', 'project', 'mode', 'log'].includes(name) || Object.hasOwn(options, name)) return { error: 'unknown or duplicate option' };
    if (name === 'prepare') options.prepare = true;
    else if (!argv[i + 1] || argv[i + 1].startsWith('--')) return { error: 'option requires a value' };
    else options[name] = argv[++i];
  }
  if (!options.project || !path.isAbsolute(options.project)) return { error: '--project must be absolute' };
  if (options.mode && !['accept-edits', 'plan'].includes(options.mode)) return { error: 'unsupported permission mode' };
  if (options.prepare ? options.order || options.conversation : !UUID.test(options.order || '') || !UUID.test(options.conversation || '')) return { error: 'prepare first, or provide an order and prepared conversation UUID' };
  return { options };
}
function runtimeArguments(options) {
  const args = ['--conversation', options.conversation, '--add-dir', options.project, '--output-format', 'stream-json'];
  if (options.mode) args.push('--mode', options.mode);
  args.push('-p', `/zensu-work ${options.order}`);
  return args;
}
// Only documented transport success/exit and the plugin's lease state are
// authoritative. Model prose and undocumented stream records are never status.
function translate() { return null; }
function recordPath(id) { return path.join(paths.privateDirectory(paths.dataRoot(), 'prepared-workers'), `${id}.json`); }
function prepared(id, projectRoot) {
  try {
    if (!UUID.test(id)) return false;
    const record = paths.readPrivateJson(recordPath(id));
    if (record.conversation_id !== id || record.project_root !== fs.realpathSync(projectRoot)) return false;
    const context = core.readContext({ recordsDir: path.join(paths.dataRoot(), 'session-control/v1/records'), sessionId: id, expectedHost: 'native' });
    return context.project_root === record.project_root && context.plugin_root === paths.pluginRoot();
  } catch { return false; }
}
function prepare(options, env) {
  const projectRoot = fs.realpathSync(options.project);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-worker-prepare-'));
  const trace = path.join(directory, 'decisions.jsonl');
  try {
    const run = spawnSync('agy', ['--add-dir', projectRoot, '--output-format', 'json', '--print-timeout', '120s', '-p',
      'Initialize this conversation only. Do not call any tool, modify a file, or start a workflow. Reply exactly READY.'], {
      cwd: projectRoot, env: { ...env, ZENSU_SHIM_DECISIONS: trace }, encoding: 'utf8', timeout: 150000, maxBuffer: 1024 * 1024,
    });
    if (run.status !== 0) throw new Error('native conversation preparation did not complete');
    const rows = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const ids = [...new Set(rows.map(row => row.sessionId).filter(id => UUID.test(id || '')))];
    if (ids.length !== 1 || rows.some(row => row.event === 'PreToolUse')) throw new Error('preparation did not prove one tool-free conversation');
    const id = ids[0];
    const context = core.readContext({ recordsDir: path.join(paths.dataRoot(), 'session-control/v1/records'), sessionId: id, expectedHost: 'native' });
    if (context.project_root !== projectRoot || context.plugin_root !== paths.pluginRoot()) throw new Error('prepared conversation belongs to another runtime or workspace');
    fs.writeFileSync(recordPath(id), JSON.stringify({ conversation_id: id, project_root: projectRoot, prepared_at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ event: 'conversation_prepared', conversation_id: id,
      next: 'Claim the work order using this conversation_id as client_session_id, then launch --order <id> --conversation <conversation_id> --project <directory>.' }) + '\n');
    return 0;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { USAGE, parseLauncherArgs, runtimeArguments, translate, prepared, prepare };
