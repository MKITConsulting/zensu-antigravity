#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const paths = require('./session-paths.js');

const HELPERS = Object.freeze({
  log: ['bash', 'hooks/lib/zensu-log.sh'],
  doctor: ['node', 'hooks/antigravity/doctor.js'],
  'work-order': ['bash', 'hooks/lib/zensu-work-order.sh'],
  'session-adopt': ['bash', 'hooks/lib/zensu-session-adopt.sh'],
  'session-reanchor': ['bash', 'hooks/lib/zensu-session-reanchor.sh'],
  'review-evidence': ['bash', 'hooks/lib/zensu-review-evidence.sh'],
  'delivery-route': ['bash', 'hooks/lib/zensu-delivery-route.sh'],
  'full-suite': ['bash', 'hooks/lib/zensu-full-suite.sh'],
  'tdd-mode': ['bash', 'hooks/lib/zensu-tdd-mode.sh'],
  'zen-mode': ['bash', 'hooks/lib/zensu-zen-mode.sh'],
  'session-trail': ['node', 'hooks/antigravity/session-trail.js'],
  review: ['node', 'hooks/antigravity/native-review.js'],
  'review-children': ['node', 'hooks/antigravity/review-children.js'],
  'review-artifacts': ['node', 'hooks/antigravity/review-artifacts.js'],
  'edit-landing': ['bash', 'hooks/lib/zensu-edit-landing.sh'],
  'workflow-artifacts': ['node', 'hooks/antigravity/workflow-artifacts.js'],
  'review-ledger': ['node', 'hooks/lib/review-ledger-v1.js'],
  'autopilot-review': ['bash', 'hooks/antigravity/autopilot-review.sh'],
});
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_STDIN_BYTES = 1024 * 1024;

function stdinSnapshot(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /[\0\r\n]/.test(file)) throw new Error('Input file must be an absolute safe path');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_STDIN_BYTES
      || fs.realpathSync.native(file) !== file) throw new Error('Input file must be a bounded regular file without aliases');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error('Input file changed while opening');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > MAX_STDIN_BYTES) throw new Error('Input file exceeds the size limit');
    const after = fs.fstatSync(fd);
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new Error('Input file changed while reading');
    return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(fd); }
}

function parseArguments(argv) {
  if (argv[0] !== '--session' || argv[2] !== '--helper') {
    throw new Error('Expected --session <host id> --helper <name> [--stdin-file <absolute file>] -- <arguments>');
  }
  const sessionId = paths.safeSessionId(argv[1]);
  const helper = argv[3];
  if (!Object.prototype.hasOwnProperty.call(HELPERS, helper)) throw new Error('Unknown session helper');
  let index = 4, stdinFile = null, snapshot = null;
  if (argv[index] === '--stdin-file') {
    stdinFile = argv[index + 1];
    snapshot = stdinSnapshot(stdinFile);
    index += 2;
  }
  if (argv[index] !== '--') throw new Error('Expected -- before helper arguments');
  const args = argv.slice(index + 1);
  if (args.some((value) => typeof value !== 'string' || value.includes('\0'))) throw new Error('Unsafe helper argument');
  const request = { sessionId, helper, args, stdinFile, stdinSha256: snapshot && snapshot.sha256,
    stdin: snapshot && snapshot.bytes };
  validateAuditArguments(request);
  return request;
}
function auditArguments(request) {
  if (!['edit-landing', 'review-ledger'].includes(request.helper)) return null;
  const flags = request.helper === 'edit-landing'
    ? ['--log', '--project', '--baseline', '--session-epoch', '--session', '--dirty-before', '--predicates', '--receipt']
    : ['--log', '--root'];
  const switches = request.helper === 'edit-landing' ? ['--inventory'] : ['--report'];
  const result = new Map();
  for (let index = 0; index < request.args.length; index += 1) {
    const name = request.args[index];
    if (result.has(name) || ![...flags, ...switches].includes(name)) throw new Error('Unknown or duplicate audit helper argument');
    const value = switches.includes(name) ? true : request.args[++index];
    if (value === undefined || value === '') throw new Error('Audit helper argument needs a value');
    result.set(name, value);
  }
  return result;
}
function validateAuditArguments(request) {
  const args = auditArguments(request);
  if (!args) return;
  if (!args.has('--log')) throw new Error('Audit helper needs --log');
  if (request.helper === 'edit-landing') {
    const sid = args.get('--session');
    if (sid && sid !== request.sessionId && sid !== require('../lib/session-control-core-v1.js').sessionKey(request.sessionId)) {
      throw new Error('Edit-landing session must match the current conversation');
    }
  }
}
function prepareHelperArguments(request, environment, options = {}) {
  const args = auditArguments(request);
  if (!args) return request.args;
  validateAuditArguments(request);
  const resolver = options.resolver || require('../lib/runtime-hook-session-v1.js').resolveHookSession;
  const binding = resolver({ session_id: request.sessionId }, environment);
  const root = binding.projectRoot;
  if (request.helper === 'edit-landing' && !args.has('--inventory') && !args.has('--session')) {
    const core = require('../lib/session-control-core-v1.js');
    const stateFile = path.join(root, '.zensu/state', `tdd-phase-${core.sessionKey(request.sessionId)}.json`);
    let exists = true;
    try { fs.lstatSync(stateFile); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    const state = exists ? core.readWorkflowState({ projectRoot: root, sessionId: request.sessionId }) : null;
    if (state && state.active === true && state.chainDone !== true) {
      const command = require('../lib/edit-landing-receipt-v1.js').auditRecoveryCommand({
        projectRoot: root, sessionId: request.sessionId, state, log: args.get('--log'),
        commandPrefix: auditCommandPrefix(request.sessionId, options.pluginRoot),
      });
      throw new Error('AUDIT SESSION REQUIRED — an active native workflow requires explicit --session; no claims were graded and no receipt was written.\n'
        + `Run: ${command}\nPreserve the original dirty scope and add --predicates with current literal/hash proofs when required. Use --inventory for read-only inspection.`);
    }
  }
  const rootFlag = request.helper === 'edit-landing' ? '--project' : '--root';
  if (args.has(rootFlag) && fs.realpathSync.native(args.get(rootFlag)) !== root) {
    throw new Error('Audit project must match the immutable session project root');
  }
  args.set(rootFlag, root);
  if (request.helper === 'edit-landing' && !args.has('--inventory') && !args.has('--session')) {
    if (args.has('--receipt') && args.get('--receipt') !== '-') {
      throw new Error('A native standalone audit is noncanonical and cannot write a receipt destination. Omit --receipt or use --receipt - for inspection; supply explicit --session with the current conversation to write its canonical receipt.');
    }
    args.set('--receipt', '-');
  }
  if (request.helper === 'edit-landing' && !args.has('--inventory') && args.has('--session')) {
    const key = require('../lib/session-control-core-v1.js').sessionKey(request.sessionId);
    const receipt = path.join(root, '.zensu/state', `edit-landing-${key}.json`);
    if (args.has('--receipt') && args.get('--receipt') !== receipt) throw new Error('Edit-landing receipt must be the current session receipt');
    args.set('--session', request.sessionId);
    args.set('--receipt', receipt);
  }
  return [...args].flatMap(([name, value]) => value === true ? [name] : [name, value]);
}
function auditCommandPrefix(sessionId, pluginRoot = paths.pluginRoot()) {
  return ['bash', path.join(pluginRoot, 'hooks/antigravity/session-helper.sh'),
    '--session', sessionId, '--helper', 'edit-landing', '--'];
}
function requestKey(request) {
  return crypto.createHash('sha256').update(JSON.stringify([request.sessionId, request.helper,
    request.args, request.stdinFile || null, request.stdinSha256 || null])).digest('hex');
}
function authorize(request, options = {}) {
  const data = options.pluginData || paths.dataRoot();
  const directory = paths.privateDirectory(data, 'helper-calls');
  const key = requestKey(request);
  const nonce = crypto.randomBytes(16).toString('hex');
  const now = options.now === undefined ? Date.now() : options.now;
  const record = { schema: 'zensu.antigravity.helper-call.v1', key,
    session_id: request.sessionId, helper: request.helper,
    created_at_ms: now, expires_at_ms: now + AUTHORIZATION_TTL_MS };
  const file = path.join(directory, `${key}-${nonce}.json`);
  fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  return file;
}
function consumeAuthorization(request, options = {}) {
  const directory = paths.privateDirectory(options.pluginData || paths.dataRoot(), 'helper-calls');
  const key = requestKey(request);
  const now = options.now === undefined ? Date.now() : options.now;
  const candidates = fs.readdirSync(directory).filter((name) => new RegExp(`^${key}-[a-f0-9]{32}\\.json$`).test(name));
  for (const name of candidates.sort()) {
    const file = path.join(directory, name);
    const record = paths.readPrivateJson(file);
    if (record.schema !== 'zensu.antigravity.helper-call.v1' || record.key !== key
        || record.session_id !== request.sessionId || record.helper !== request.helper
        || !Number.isFinite(record.expires_at_ms) || !Number.isFinite(record.created_at_ms)
        || record.expires_at_ms - record.created_at_ms !== AUTHORIZATION_TTL_MS) {
      throw new Error('Helper invocation receipt is invalid');
    }
    if (record.expires_at_ms < now || record.created_at_ms > now) continue;
    const consumed = `${file}.consumed-${crypto.randomBytes(16).toString('hex')}`;
    try { fs.renameSync(file, consumed); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fs.unlinkSync(consumed);
    return;
  }
  throw new Error('No current PreToolUse authorization matches this helper call; use the exact session-bound command in this conversation');
}
function helperEnvironment(request, options = {}) {
  const environment = { ...(options.environment || process.env) };
  for (const name of ['ZENSU_SESSION_KEY', 'ZENSU_SESSION_CONTEXT', 'ZENSU_RUNTIME_DIGEST',
    'ZENSU_PROJECT_ROOT', 'ZENSU_RUNTIME_PLUGIN_ROOT', 'ZENSU_SESSION_ADOPTED',
    'ZENSU_PROJECT_DIR', 'ZENSU_HOST_SESSION_ID', 'ZENSU_PLUGIN_ROOT', 'ZENSU_PLUGIN_DATA',
    'ANTIGRAVITY_PLUGIN_ROOT', 'PLUGIN_ROOT', 'BASH_ENV', 'ENV', 'NODE_OPTIONS', 'ZENSU_AUDIT_COMMAND_JSON']) delete environment[name];
  environment.ZENSU_PLUGIN_ROOT = options.pluginRoot || paths.pluginRoot();
  environment.ZENSU_PLUGIN_DATA = options.pluginData || paths.dataRoot();
  // Plugin-internal transport only. The host did not supply an environment
  // variable: its matching PreToolUse payload authorized the consumed receipt.
  environment.ZENSU_HOST_SESSION_ID = request.sessionId;
  environment.ZENSU_REVIEW_EXECUTION = 'delegated';
  environment.ZENSU_CLIENT_NAME = 'zensu-antigravity';
  environment.ZENSU_AUDIT_COMMAND_JSON = JSON.stringify(auditCommandPrefix(request.sessionId, environment.ZENSU_PLUGIN_ROOT));
  return environment;
}
function main(argv) {
  const request = parseArguments(argv);
  consumeAuthorization(request);
  const root = paths.pluginRoot();
  const [runtime, relative] = HELPERS[request.helper];
  const file = path.join(root, relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file) !== file) throw new Error('Helper target is unsafe');
  const environment = helperEnvironment(request);
  const args = prepareHelperArguments(request, environment);
  const child = spawnSync(runtime, [file, ...args], {
    stdio: request.stdinFile ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    ...(request.stdinFile ? { input: request.stdin } : {}), env: environment,
  });
  if (child.error) throw child.error;
  process.exitCode = child.status === null ? 2 : child.status;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`zensu session helper: ${error.message}\n`); process.exitCode = 2;
  }
}
module.exports = { HELPERS, AUTHORIZATION_TTL_MS, MAX_STDIN_BYTES, stdinSnapshot, parseArguments, validateAuditArguments, prepareHelperArguments, auditCommandPrefix, requestKey,
  authorize, consumeAuthorization, helperEnvironment, main };
