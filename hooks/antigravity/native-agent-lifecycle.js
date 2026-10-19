#!/usr/bin/env node
'use strict';

// Actual native child hooks bridge to the canonical evidence lease API. These
// operations never claim that the host supplied SubagentStart/SubagentStop.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const SCHEMA = 'zensu.antigravity.completed-child.v1';
const NORMAL_STOPS = new Set(['NO_TOOL_CALL', 'TERMINAL_STEP_TYPE']);
const ABORT_STOPS = new Set(['ERROR', 'USER_CANCELED', 'MAX_INVOCATIONS', 'MAX_FORCED_INVOCATIONS', 'MAX_TOKEN_BUDGET_EXCEEDED']);
function fail(message) { throw new Error(`Native child lifecycle: ${message}`); }
function dependencies(options = {}) {
  return {
    paths: options.paths || require('./session-paths.js'),
    core: options.core || require('../lib/session-control-core-v1.js'),
    leases: options.leases || require('../lib/review-evidence-lease-v1.js'),
    binder: options.binder || require('../lib/runtime-hook-session-v1.js'),
    provenance: options.provenance || require('./native-agent-provenance.js'),
  };
}
function directories(deps, options) {
  const root = deps.paths.privateDirectory(options.pluginData || deps.paths.dataRoot(), 'native-agents', 'v1');
  return { root, locks: deps.paths.privateDirectory(root, 'locks'),
    births: deps.paths.privateDirectory(root, 'lease-bindings'),
    attempts: deps.paths.privateDirectory(root, 'result-attempts'),
    results: deps.paths.privateDirectory(root, 'results') };
}
function recordKey(parent, child, deps) {
  deps.paths.safeSessionId(parent); deps.paths.safeSessionId(child);
  if (parent === child) fail('parent and child identities must differ');
  return hash(`${parent}\0${child}`);
}
function readOptional(file, deps) {
  try { return deps.paths.readPrivateJson(file, 2 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function verified(payload, deps, options) {
  const prepared = deps.provenance.prepare(payload, options);
  if (prepared.status !== 'child' || !prepared.provenance) fail(prepared.reason || 'a verified child principal is required');
  const p = prepared.provenance;
  if (!Object.prototype.hasOwnProperty.call(p, 'sourceTree')
      || !(p.sourceTree === null || /^[a-f0-9]{40,64}$/.test(p.sourceTree))
      || typeof p.launchReceiptId !== 'string' || !p.launchReceiptId
      || typeof p.runtimeDigest !== 'string' || !p.runtimeDigest) fail('launch snapshot is missing');
  if (prepared.payload.session_id !== p.parentSessionId || prepared.payload.agent_id !== p.childSessionId
      || prepared.payload.agent_type !== p.typeName || prepared.payload.host_session_id !== p.childSessionId) fail('canonical child selectors differ from provenance');
  const binding = deps.binder.resolveHookSession(prepared.payload, { ...process.env,
    ZENSU_PLUGIN_ROOT: options.pluginRoot || deps.paths.pluginRoot(),
    ZENSU_PLUGIN_DATA: options.pluginData || deps.paths.dataRoot() }, { autoAdopt: false });
  if (binding.projectRoot !== p.workspaceRoot || binding.context.runtime_digest !== p.runtimeDigest) fail('parent binding changed after the native dispatch');
  return { prepared, p, binding };
}
function identity(p) {
  return { parentSessionId: p.parentSessionId, childSessionId: p.childSessionId,
    typeName: p.typeName, role: p.role, promptSha256: p.promptSha256,
    spawnStepIndex: p.spawnStepIndex, workspaceRoot: p.workspaceRoot,
    runtimeDigest: p.runtimeDigest, sourceTree: p.sourceTree, launchReceiptId: p.launchReceiptId };
}
function sameIdentity(record, p) {
  const expected = identity(p);
  return Object.keys(expected).every(key => record[key] === expected[key]);
}
function bindVerifiedChild(state, deps, dirs, options) {
  const { prepared, p, binding } = state;
  const kind = deps.leases.kindForAgentType(p.typeName);
  if (!kind) return { bound: false, kind: null };
  const key = recordKey(p.parentSessionId, p.childSessionId, deps);
  const file = path.join(dirs.births, `${key}.json`);
  const prior = readOptional(file, deps);
  if (prior) {
    if (prior.schema !== 'zensu.antigravity.child-lease.v1' || !sameIdentity(prior, p)
        || prior.kind !== kind || typeof prior.leaseId !== 'string') fail('the child evidence binding changed');
    return { bound: true, kind, leaseId: prior.leaseId };
  }
  const leaseId = deps.leases.bindWorker(prepared.payload, binding);
  if (typeof leaseId !== 'string' || !leaseId) fail('canonical evidence worker did not receive a lease');
  deps.paths.writePrivateJson(file, { schema: 'zensu.antigravity.child-lease.v1', ...identity(p), kind, leaseId });
  return { bound: true, kind, leaseId };
}
function bindChild(payload, options = {}) {
  const deps = dependencies(options), state = verified(payload, deps, options), dirs = directories(deps, options);
  const key = recordKey(state.p.parentSessionId, state.p.childSessionId, deps);
  return deps.core.withFileLock(dirs.locks, `lifecycle-${key}`, () => bindVerifiedChild(state, deps, dirs, options));
}
function stopChild(payload, options = {}) {
  const deps = dependencies(options), state = verified(payload, deps, options), dirs = directories(deps, options);
  const reason = payload.termination_reason, idle = payload.fully_idle;
  if (ABORT_STOPS.has(reason) || payload.error) return { status: 'aborted', captured: false };
  if (!NORMAL_STOPS.has(reason) || idle !== true) return { status: 'pending', decision: 'continue',
    reason: 'Zensu cannot attest this child report until the host reports normal, fully idle completion.' };
  const final = deps.provenance.latestChildResponse(payload, options);
  if (!final || typeof final.text !== 'string' || !final.text.trim()
      || Buffer.byteLength(final.text) > 1024 * 1024 || !Number.isSafeInteger(final.stepIndex)
      || final.stepIndex < 0 || final.responseSha256 !== hash(final.text)
      || final.type !== 'PLANNER_RESPONSE' || final.source !== 'MODEL' || final.status !== 'DONE'
      || !Array.isArray(final.tool_calls) || final.tool_calls.length !== 0
      || !sameIdentity(final.provenance, state.p)) fail('terminal child response differs from its verified principal');
  const key = recordKey(state.p.parentSessionId, state.p.childSessionId, deps);
  return deps.core.withFileLock(dirs.locks, `lifecycle-${key}`, () => {
    const resultFile = path.join(dirs.results, `${key}.json`), existing = readOptional(resultFile, deps);
    if (existing) {
      if (existing.schema !== SCHEMA || !sameIdentity(existing, state.p)
          || existing.finalHash !== final.responseSha256 || existing.finalText !== final.text
          || existing.observedStop.responseStep !== final.stepIndex) fail('a completed child report is create-once');
      return { status: 'completed', captured: true, childId: state.p.childSessionId };
    }
    const attemptFile = path.join(dirs.attempts, `${key}.json`), previous = readOptional(attemptFile, deps);
    if (previous) {
      if (!sameIdentity(previous, state.p)) fail('child result attempt identity changed');
      if (previous.responseStep === final.stepIndex) {
        if (previous.responseHash !== final.responseSha256) fail('the same native response step changed');
        return previous.outcome;
      }
      if (previous.responseStep > final.stepIndex) fail('native child response steps must advance');
      if (previous.outcome.status === 'failed') return previous.outcome;
    }
    const lease = bindVerifiedChild(state, deps, dirs, options);
    let outcome;
    if (lease.kind) {
      const stored = deps.leases.storeWorkerResult({ ...state.prepared.payload,
        last_assistant_message: final.text }, state.binding);
      if (stored.action === 'block') outcome = { status: 'retry', decision: 'continue', captured: false,
        reason: `The evidence-worker report was rejected: ${stored.reason}. Reply once more with exactly one schema-valid JSON object, without fences or surrounding prose.` };
      else if (stored.action === 'failed') outcome = { status: 'failed', captured: false, reason: stored.reason };
      else if (stored.action !== 'stored') fail('canonical evidence lease did not accept the worker report');
    }
    if (outcome) {
      deps.paths.writePrivateJson(attemptFile, { ...identity(state.p), responseStep: final.stepIndex,
        responseHash: final.responseSha256, outcome });
      return outcome;
    }
    const record = { schema: SCHEMA, ...identity(state.p), descriptor: {
      typeName: state.p.typeName, role: state.p.role, prompt: state.p.prompt,
      promptSha256: state.p.promptSha256, workspaceRoot: state.p.workspaceRoot },
      finalText: final.text, finalHash: final.responseSha256,
      observedStop: { terminationReason: reason, fullyIdle: true, responseStep: final.stepIndex,
        executionNum: payload.execution_num, atMs: options.now === undefined ? Date.now() : options.now },
      evidenceLease: lease.kind ? { kind: lease.kind, leaseId: lease.leaseId } : null };
    deps.paths.writePrivateJson(resultFile, record);
    return { status: 'completed', captured: true, childId: state.p.childSessionId };
  });
}
function completedChild(parentID, childID, options = {}) {
  const deps = dependencies(options), dirs = directories(deps, options), key = recordKey(parentID, childID, deps);
  const record = deps.paths.readPrivateJson(path.join(dirs.results, `${key}.json`), 2 * 1024 * 1024);
  if (record.schema !== SCHEMA || record.parentSessionId !== parentID || record.childSessionId !== childID
      || typeof record.finalText !== 'string' || hash(record.finalText) !== record.finalHash
      || !record.observedStop || record.observedStop.fullyIdle !== true
      || !NORMAL_STOPS.has(record.observedStop.terminationReason)
      || !Number.isSafeInteger(record.observedStop.responseStep) || !record.descriptor
      || record.descriptor.typeName !== record.typeName || record.descriptor.role !== record.role
      || hash(record.descriptor.prompt) !== record.promptSha256) fail('completed child receipt is invalid');
  return { ...record, parentId: record.parentSessionId, childId: record.childSessionId };
}
function main(argv) {
  const raw = fs.readFileSync(0);
  if (!raw.length || raw.length > 2 * 1024 * 1024) fail('native lifecycle input size is invalid');
  const payload = JSON.parse(raw.toString('utf8'));
  const result = argv.length === 1 && argv[0] === '--bind-child' ? bindChild(payload)
    : argv.length === 1 && argv[0] === '--stop-child' ? stopChild(payload) : fail('unsupported lifecycle operation');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'deny', reason: error.message })}\n`); process.exitCode = 1;
  }
}
module.exports = { SCHEMA, bindChild, stopChild, completedChild, main };
