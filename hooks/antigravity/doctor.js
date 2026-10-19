#!/usr/bin/env node
'use strict';

// The neutral Doctor retains state/config diagnostics. This adapter audits the
// actual native registry and private completion evidence without creating state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const paths = require('./session-paths.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_FILES = 256;

function registryNames(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => {
    const match = /^\s*(?:[-*]\s+)?([a-z][a-z0-9-]+)(?:\s{2,}|\s*$)/.exec(line);
    return match ? match[1] : null;
  }).filter(Boolean);
}
function safeExistingDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || fs.realpathSync.native(directory) !== directory
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('Private evidence directory is unsafe');
}
function ownCompletionEvidence(binding, sessionId, options = {}) {
  const base = path.join(binding.pluginData, 'native-agents/v1');
  const launches = path.join(base, 'launches'), results = path.join(base, 'results');
  try { safeExistingDirectory(launches); safeExistingDirectory(results); }
  catch (error) { if (error.code === 'ENOENT') return { count: 0, paths: [] }; throw error; }
  // Select the current parent's files by their adapter-owned filename prefix
  // before opening anything; unrelated conversations are never inspected.
  const names = fs.readdirSync(launches).filter(name => name.startsWith(`${hash(sessionId)}-`) && name.endsWith('.json'));
  if (names.length > MAX_FILES) throw Error('This conversation exceeds the bounded native evidence audit');
  const childIds = new Set(), evidence = [];
  for (const name of names) {
    const file = path.join(launches, name), record = paths.readPrivateJson(file);
    if (record.schema !== 'zensu.antigravity.native-launch.v1' || record.parentSessionId !== sessionId
        || record.workspaceRoot !== binding.projectRoot || record.pluginRoot !== binding.pluginRoot
        || record.runtimeDigest !== binding.context.runtime_digest) continue;
    for (const childId of Object.values(record.claimedChildren || {})) {
      if (typeof childId !== 'string' || !/^[a-f0-9-]{36}$/i.test(childId) || childId === sessionId || childIds.has(childId)) continue;
      const resultPath = path.join(results, `${hash(`${sessionId}\0${childId}`)}.json`);
      let result;
      try { result = paths.readPrivateJson(resultPath, 2 * 1024 * 1024); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const descriptor = record.entries && record.entries.find(entry => record.claimedChildren[String(entry.index)] === childId);
      if (!descriptor || result.schema !== 'zensu.antigravity.completed-child.v1'
          || result.parentSessionId !== sessionId || result.childSessionId !== childId
          || result.workspaceRoot !== binding.projectRoot || result.runtimeDigest !== binding.context.runtime_digest
          || result.launchReceiptId !== record.launchReceiptId || result.sourceTree !== record.sourceTree
          || result.typeName !== descriptor.typeName || result.role !== descriptor.role
          || result.promptSha256 !== descriptor.promptSha256 || hash(descriptor.prompt) !== descriptor.promptSha256
          || typeof result.finalText !== 'string' || hash(result.finalText) !== result.finalHash
          || result.observedStop?.fullyIdle !== true
          || !['NO_TOOL_CALL', 'TERMINAL_STEP_TYPE'].includes(result.observedStop.terminationReason)
          || !Number.isSafeInteger(result.observedStop.responseStep)) throw Error('A current-session native completion receipt is invalid');
      childIds.add(childId); evidence.push(file, resultPath);
    }
  }
  return { count: childIds.size, paths: [...new Set(evidence)] };
}
function nativeAudit(environment = process.env, options = {}) {
  const root = options.pluginRoot || paths.pluginRoot(), data = options.pluginData || paths.dataRoot();
  const rows = [], proofs = new Set();
  const add = (level, text) => rows.push({ level, text });
  const binder = options.binder || require('../lib/runtime-hook-session-v1.js');
  let binding;
  try {
    const sessionId = paths.safeSessionId(environment.ZENSU_HOST_SESSION_ID);
    binding = binder.resolveHookSession({ session_id: sessionId, hook_event_name: 'PreToolUse' }, {
      ...environment, ZENSU_PLUGIN_ROOT: root, ZENSU_PLUGIN_DATA: data,
    }, { autoAdopt: false });
    if (binding.pluginRoot !== root || binding.pluginData !== data) throw Error('Executing installation differs from the session binding');
    proofs.add(binding.contextFile);
    add('ok', `Session binding verified: ${binding.sessionKey}; executing plugin ${root}; project ${binding.projectRoot}.`);
  } catch {
    add('warn', 'Native session binding could not be verified. Native dispatch and completion evidence are unknown; run the canonical recovery diagnosis above.');
  }
  const audit = options.dispatchAudit || require('./native-spawn-allow.js').inspectReadOnlyDispatch;
  let dispatch;
  try { dispatch = audit({ pluginRoot: root, workspaceRoot: binding && binding.projectRoot, environment }); }
  catch { dispatch = { status: 'unknown', findings: ['Native dispatch audit did not run.'], evidencePaths: [] }; }
  for (const item of dispatch.findings || []) add(dispatch.status === 'ok' ? 'ok' : 'warn', item);
  for (const file of dispatch.evidencePaths || []) if (typeof file === 'string') proofs.add(file);
  add('ok', 'The reviewer auto-allow audit excludes the PLM and unrelated host profiles; every granted reviewer batch must first pass all tool gates.');

  const execute = options.spawnSync || spawnSync;
  let registered;
  try { registered = execute('agy', ['agents'], { cwd: binding ? binding.projectRoot : process.cwd(), env: environment,
    encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024 }); }
  catch { registered = { status: null, error: true }; }
  const principal = require('../lib/runtime-principal-v1.js');
  const expected = [...new Set([...principal.REVIEWER_TYPES, ...principal.EVIDENCE_WORKER_TYPES])].filter(name => name.startsWith('zensu-'));
  const names = registered.status === 0 && !registered.error ? registryNames(registered.stdout) : [];
  const missing = expected.filter(name => !names.includes(name));
  if (!missing.length) add('ok', `Native CLI registry lists all ${expected.length} audited reviewer and evidence-worker roles (agy agents).`);
  else add('warn', `Native CLI role registration is unverified for: ${missing.join(', ')}. No independent execution is inferred from the delegated-mode flag.`);

  if (binding) {
    try {
      const diagnostic = (options.outcomeAudit || require('./native-reviewer-outcome.js').inspectSession)(binding, environment.ZENSU_HOST_SESSION_ID);
      for (const file of diagnostic.evidencePaths || []) proofs.add(file);
      if (diagnostic.status === 'blocked') {
        const cause = diagnostic.kind === 'hook-policy-denied'
          ? 'A pre-tool hook rejected the reviewer dispatch; this may be a Zensu gate or another runtime policy.'
          : 'The runtime permission check rejected the reviewer dispatch.';
        add('warn', `${cause} Observed refusals in the bounded transcript tail: ${diagnostic.denials}. Read the actual refusal and resolve the authorized workflow or policy condition; do not bypass the gate or edit user permission settings yourself. No review completion is inferred.`);
      } else if (diagnostic.status === 'clear') add('ok', 'The latest matched reviewer dispatch has verified native child provenance. This clears an earlier dispatch-refusal diagnosis, not the review completion requirements.');
      else if (diagnostic.status === 'errored') add('warn', 'The latest matched reviewer dispatch has a native error whose cause is not classified. A prior refusal is not cleared; inspect the actual transcript error.');
      else if (diagnostic.status === 'unreadable') add('warn', 'Reviewer dispatch outcomes could not be authenticated. No refusal or successful launch is inferred.');
    } catch { add('warn', 'Reviewer dispatch outcomes could not be authenticated. No refusal or successful launch is inferred.'); }
  }
  if (binding) {
    try {
      const evidence = (options.completionAudit || ownCompletionEvidence)(binding, environment.ZENSU_HOST_SESSION_ID);
      if (evidence.count > 0) add('ok', `Observed ${evidence.count} distinct native child completion(s) for this conversation and runtime, each with a normal fully idle Stop witness. These are dispatch-time snapshots, not a current-source review verdict.`);
      else add('warn', 'No current-runtime native child completion witness was found for this conversation. Independent execution remains unverified in this session.');
      for (const file of evidence.paths) proofs.add(file);
    } catch { add('warn', 'The current conversation native completion evidence could not be validated. Independent execution remains unverified.'); }
  }
  return { rows, evidencePaths: [...proofs].filter(Boolean) };
}
function run(argv = [], environment = process.env, options = {}) {
  if (argv.length) throw Error('The native Doctor accepts no arguments');
  const root = options.pluginRoot || paths.pluginRoot();
  const execute = options.spawnSync || spawnSync;
  const child = execute('bash', [path.join(root, 'hooks/lib/zensu-doctor.sh')], {
    cwd: process.cwd(), env: { ...environment, ZENSU_PLUGIN_ROOT: root, ZENSU_REVIEW_EXECUTION: 'delegated' },
    encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  const text = child.status === 0 && typeof child.stdout === 'string' && child.stdout.trim()
    ? child.stdout.replace(/^Summary:/gm, 'Engine diagnostics summary:')
    : 'Zensu doctor\n  ⚠️  The canonical diagnostics could not complete.\n';
  const native = nativeAudit(environment, options), warnings = native.rows.filter(row => row.level !== 'ok').length;
  return text.trimEnd() + '\n\nNative Antigravity capability audit\n'
    + native.rows.map(row => `  ${row.level === 'ok' ? '✅' : '⚠️'}  ${row.text}`).join('\n')
    + (native.evidencePaths.length ? '\n  Evidence paths:\n' + native.evidencePaths.map(file => `    ${file}`).join('\n') : '')
    + `\nNative audit summary: ${warnings} warning(s); no permission or session state was changed.\n`;
}
if (require.main === module) {
  try { process.stdout.write(run(process.argv.slice(2))); }
  catch { process.stdout.write('Zensu doctor\n  ⚠️  The native diagnostics could not run; native capability remains unverified.\n'); }
}
module.exports = { registryNames, ownCompletionEvidence, nativeAudit, run };
