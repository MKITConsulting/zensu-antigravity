#!/usr/bin/env node
'use strict';

// Native launch outcomes are diagnostics only. They never create a child,
// consume a review ticket or satisfy a completion gate. Permission markers
// below describe observed native errors, not mechanically renamed source text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_LINES = 20000;
const MAX_LAUNCHES = 256;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TYPES = new Set(['zensu-code-reviewer', 'zensu-review-aspect', 'zensu-review-judge',
  'zensu-plan-review-worker', 'zensu-pr-review-worker', 'zensu-gauntlet-critic']);
// Observed on agy 1.4.2 in an owned run_workflow control. The host recorded a
// GENERIC/ERROR error field, and its CLI stream independently reported a denied
// command action. Reviewer dispatch must still have its own exact accepted
// launch/step binding; this command marker is not an observed reviewer refusal.
// JSON quoting is matched structurally so text inside an argument cannot supply
// the outer permission-check prefix or its user-denial clause.
function permissionKind(error) {
  if (typeof error !== 'string') return '';
  // Observed in an owned invoke_subagent deny control on agy 1.4.2.
  // This is hook policy, which may itself be a Zensu gate, not user permission.
  if (/^tool call denied by pre-tool hook: [\s\S]*\S/.test(error)) return 'hook-policy-denied';
  return /^permission check failed for unsandboxed "(?:[^"\\\r\n]|\\.)*": user denied permission to run command:\n/.test(error)
    ? 'permission-denied' : '';
}
function verdict(status, extra = {}) {
  return { status, kind: '', tool: 'invoke_subagent', spawns: 0, denials: 0, evidencePaths: [], ...extra };
}
function existingPrivate(directory, paths) { return paths.secureDirectory(directory, false); }
function readTail(file, provenance) {
  // Reuse the native secure-open contract. The bounded transcript read refuses
  // oversized files rather than silently claiming there were no refused calls.
  const text = provenance.readHostFile(file);
  let bytes = Buffer.from(text), truncated = bytes.length > MAX_TAIL_BYTES;
  if (truncated) bytes = bytes.subarray(bytes.length - MAX_TAIL_BYTES);
  let lines = bytes.toString('utf8').split('\n');
  if (truncated) lines.shift();
  lines = lines.slice(-MAX_LINES);
  const rows = [], steps = new Set();
  let previous = -1;
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.step_index) || row.step_index < 0 || row.step_index <= previous || steps.has(row.step_index)) throw Error('Ambiguous native transcript step');
    previous = row.step_index; steps.add(row.step_index); rows.push(row);
  }
  return rows;
}
function correlate(receipt, rows, source, binding, provenance) {
  if (receipt.schema !== provenance.SCHEMA || receipt.parentSessionId !== source.sessionId
      || receipt.parentTranscript !== source.transcript || receipt.brain !== source.brain
      || receipt.workspaceRoot !== binding.projectRoot || receipt.pluginRoot !== binding.pluginRoot
      || receipt.runtimeDigest !== binding.context.runtime_digest || receipt.sessionKey !== binding.sessionKey
      || !Number.isSafeInteger(receipt.spawnStepIndex) || receipt.spawnStepIndex < 0
      || receipt.launchReceiptId !== hash(`${source.sessionId}:${receipt.spawnStepIndex}`)
      || !Array.isArray(receipt.entries) || receipt.entries.length < 1
      || !receipt.entries.every(entry => TYPES.has(entry.typeName))) return null;
  const result = rows.find(row => row.step_index === receipt.spawnStepIndex);
  if (!result) return null;
  const planner = [...rows].reverse().find(row => row.step_index < receipt.spawnStepIndex
    && row.source === 'MODEL' && row.type === 'PLANNER_RESPONSE' && row.status === 'DONE');
  const calls = planner && Array.isArray(planner.tool_calls) ? planner.tool_calls.filter(call => call.name === 'invoke_subagent') : [];
  if (!calls.some(call => {
    try { return same(provenance.descriptors(call.args), receipt.entries); } catch { return false; }
  })) return null;
  if (result.source !== 'MODEL' || result.type !== 'GENERIC') return null;
  return result;
}
function acceptedChildren(receipt, result, source, binding, deps) {
  const children = deps.provenance.spawnedChildren(result.content);
  if (children.length !== receipt.entries.length) return false;
  for (const child of children) {
    const childPath = fileURLToPath(child.logAbsoluteUri);
    deps.provenance.verifyParentLaunch(receipt, child.conversationId, childPath);
    const principalFile = path.join(binding.pluginData, 'native-agents/v1/children', `${hash(child.conversationId)}.json`);
    const principal = deps.paths.readPrivateJson(principalFile);
    const entry = receipt.entries.find(item => receipt.claimedChildren?.[String(item.index)] === child.conversationId);
    if (!entry || principal.schema !== deps.provenance.CHILD_SCHEMA || principal.parentSessionId !== source.sessionId
        || principal.childSessionId !== child.conversationId || principal.launchReceiptId !== receipt.launchReceiptId
        || principal.spawnStepIndex !== receipt.spawnStepIndex || principal.runtimeDigest !== receipt.runtimeDigest
        || principal.workspaceRoot !== binding.projectRoot || principal.typeName !== entry.typeName
        || principal.role !== entry.role || principal.promptSha256 !== entry.promptSha256
        || principal.prompt !== entry.prompt || hash(entry.prompt) !== entry.promptSha256) return false;
  }
  return true;
}
function negativeOnly(result, rows, profiles, provenance) {
  if (result.source !== 'MODEL' || result.type !== 'GENERIC' || result.status !== 'ERROR') return null;
  const planner = rows.find(row => row.step_index === result.step_index - 1);
  if (!planner || planner.type !== 'PLANNER_RESPONSE' || planner.source !== 'MODEL' || planner.status !== 'DONE'
      || !Array.isArray(planner.tool_calls) || planner.tool_calls.length !== 1
      || planner.tool_calls[0].name !== 'invoke_subagent') return null;
  let entries;
  try { entries = provenance.descriptors(planner.tool_calls[0].args); } catch { return null; }
  if (!entries.length || !entries.every(entry => {
    const profile = profiles.get(entry.typeName);
    return TYPES.has(entry.typeName) && profile?.model === 'inherit'
      && Array.isArray(profile.tools) && JSON.stringify([...profile.tools].sort()) === JSON.stringify(['find_by_name', 'grep_search', 'view_file']);
  })) return null;
  const kind = permissionKind(result.error);
  return { status: kind ? 'blocked' : 'errored', kind, step: result.step_index, negativeOnly: true };
}
function dependencies(options) {
  return { paths: options.paths || require('./session-paths.js'), provenance: options.provenance || require('./native-agent-provenance.js'),
    binder: options.binder || require('../lib/runtime-hook-session-v1.js') };
}
function inspect(payload, options = {}) {
  try {
    if (payload.agent_id !== undefined || payload.agent_type !== undefined
        || (payload.host_session_id && payload.host_session_id !== payload.session_id)) return verdict('unreadable');
    const deps = dependencies(options), root = options.pluginRoot || deps.paths.pluginRoot(), data = options.pluginData || deps.paths.dataRoot();
    const source = deps.provenance.location(payload);
    const binding = deps.binder.resolveHookSession(payload, { ...process.env, ZENSU_PLUGIN_ROOT: root, ZENSU_PLUGIN_DATA: data }, { autoAdopt: false });
    if (binding.pluginRoot !== root || binding.pluginData !== data || binding.projectRoot !== payload.workspace_root) return verdict('unreadable');
    const base = path.join(data, 'native-agents/v1'), launches = path.join(base, 'launches');
    const mainFile = path.join(base, 'mains', `${hash(source.sessionId)}.json`);
    const main = deps.paths.readPrivateJson(mainFile);
    if (main.schema !== 'zensu.antigravity.native-main.v1' || main.sessionId !== source.sessionId
        || main.workspaceRoot !== binding.projectRoot || main.brain !== source.brain) return verdict('unreadable');
    const runtimeDigest = (options.computeRuntimeDigest || require('../lib/session-control-core-v1.js').computeRuntimeDigest)(root, 'native');
    if (runtimeDigest !== binding.context.runtime_digest) return verdict('unreadable');
    existingPrivate(base, deps.paths); existingPrivate(launches, deps.paths);
    const names = fs.readdirSync(launches).filter(name => new RegExp(`^${hash(source.sessionId)}-[0-9]+\\.json$`).test(name));
    if (names.length > MAX_LAUNCHES) return verdict('unreadable');
    const rows = readTail(source.transcript, deps.provenance), outcomes = [];
    for (const name of names) {
      const file = path.join(launches, name), receipt = deps.paths.readPrivateJson(file);
      const result = correlate(receipt, rows, source, binding, deps.provenance);
      if (!result || name !== `${hash(source.sessionId)}-${receipt.spawnStepIndex}.json`) continue;
      let status = 'none', kind = '';
      if (result.status === 'ERROR') { kind = permissionKind(result.error); status = kind ? 'blocked' : 'errored'; }
      else if (result.status === 'DONE') {
        try { status = acceptedChildren(receipt, result, source, binding, deps) ? 'clear' : 'none'; } catch { status = 'none'; }
      }
      outcomes.push({ status, kind, step: result.step_index, file });
    }
    // A refusing hook can run before this plugin's PreToolUse. Such a call has
    // no accepted launch receipt. The authenticated main's actual single-call
    // planner/result pair may diagnose a negative outcome only; it cannot make
    // a launch, child principal, successful review or clear verdict.
    const profiles = (options.ownProfiles || require('./native-spawn-allow.js').ownProfiles)(root);
    for (const row of rows) {
      if (outcomes.some(item => item.step === row.step_index)) continue;
      const negative = negativeOnly(row, rows, profiles, deps.provenance);
      if (negative) outcomes.push({ ...negative, file: mainFile });
    }
    outcomes.sort((a, b) => a.step - b.step);
    const latest = outcomes.at(-1);
    return verdict(latest ? latest.status : 'none', { kind: latest?.kind || '', spawns: outcomes.length,
      denials: outcomes.filter(row => row.status === 'blocked').length,
      evidencePaths: [...new Set([source.transcript, ...outcomes.map(row => row.file)])] });
  } catch { return verdict('unreadable'); }
}
function inspectSession(binding, sessionId, options = {}) {
  try {
    const deps = dependencies(options), file = path.join(binding.pluginData, 'native-agents/v1/mains', `${hash(sessionId)}.json`);
    const main = deps.paths.readPrivateJson(file);
    if (main.schema !== 'zensu.antigravity.native-main.v1' || main.sessionId !== sessionId || main.workspaceRoot !== binding.projectRoot) return verdict('unreadable');
    const transcript = path.join(main.brain, sessionId, '.system_generated/logs/transcript_full.jsonl');
    return inspect({ session_id: sessionId, host_session_id: sessionId, workspace_root: binding.projectRoot, transcript_path: transcript },
      { ...options, pluginRoot: binding.pluginRoot, pluginData: binding.pluginData });
  } catch { return verdict('unreadable'); }
}
function line(value) {
  return `status=${value.status} kind=${value.kind} tool=invoke_subagent spawns=${value.spawns} denials=${value.denials}`;
}
function adaptPayload(payload, options = {}) {
  const result = { ...payload };
  delete result.reviewer_spawn_probe;
  result.reviewer_spawn_probe = line(inspect(result, options));
  return result;
}
function boundedPayload(payload, options = {}) {
  const fallback = { ...payload, reviewer_spawn_probe: line(verdict('unreadable')) };
  try {
    const result = require('node:child_process').spawnSync(process.execPath,
      [options.script || __filename, '--payload'], { input: JSON.stringify(payload), encoding: 'utf8',
        timeout: Math.min(3000, Math.max(1, options.timeoutMs || 3000)), maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' });
    if (result.error || result.status !== 0) return fallback;
    const value = JSON.parse(result.stdout);
    if (!value || value.session_id !== payload.session_id || typeof value.reviewer_spawn_probe !== 'string') return fallback;
    return value;
  } catch { return fallback; }
}
function main(argv) {
  const raw = fs.readFileSync(0);
  if (raw.length > 2 * 1024 * 1024 || argv.length !== 1 || !['--payload', '--bounded-payload'].includes(argv[0])) throw Error('Invalid outcome diagnostic input');
  const payload = JSON.parse(raw.toString('utf8'));
  process.stdout.write(JSON.stringify(argv[0] === '--bounded-payload' ? boundedPayload(payload) : adaptPayload(payload)));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch { process.exitCode = 1; } }
module.exports = { MAX_TAIL_BYTES, MAX_LINES, TYPES, permissionKind, verdict, readTail, correlate, acceptedChildren, negativeOnly, inspect, inspectSession, line, adaptPayload, boundedPayload, main };
