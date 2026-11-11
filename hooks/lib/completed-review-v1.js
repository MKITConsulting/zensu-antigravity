'use strict';

// Read-only evidence for a consumed review. This does not extend workflow state
// or turn codeReviewDone into a passing verdict.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const review = require('./in-thread-review-v1.js');
const packet = require('./review-packet-v1.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => { throw Error(`completed-review: ${message}`); };

function privateRead(file) {
  if (fs.realpathSync(file) !== file) fail('aliased evidence');
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) || st.size > 2 * 1024 * 1024
      || (process.getuid && st.uid !== process.getuid())) fail('unsafe evidence file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== st.dev || opened.ino !== st.ino || opened.size !== st.size) fail('evidence changed while opening');
    const text = fs.readFileSync(fd, 'utf8');
    const after = fs.fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail('evidence changed while reading');
    return JSON.parse(text);
  } finally { fs.closeSync(fd); }
}
function load(binding, state, options = {}) {
  if (!state.active || !state.implComplete || !state.codeReviewDone || state.chainDone
      || !state.reviewTicketConsumed || !state.reviewTicket) return null;
  const dir = path.join(binding.pluginData, 'in-thread-review/v1', binding.sessionKey);
  const stem = hash(state.reviewTicket);
  const resultFile = path.join(dir, `${stem}.result.json`);
  try { fs.lstatSync(resultFile); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  for (let current = dir; ; current = path.dirname(current)) {
    const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077)
        || (process.getuid && st.uid !== process.getuid())) fail('unsafe evidence directory');
    if (current === binding.pluginData) break;
    if (path.dirname(current) === current) fail('evidence root mismatch');
  }
  const leaseFile = path.join(dir, `${stem}.json`);
  const lease = privateRead(leaseFile);
  const result = privateRead(resultFile);
  if (lease.sessionKey !== binding.sessionKey || lease.runtimeDigest !== binding.context.runtime_digest
      || lease.generation !== state.reviewGeneration || lease.round !== state.reviewRound
      || lease.ticket !== state.reviewTicket || result.tree !== lease.tree
      || result.schema !== lease.schema || result.execution !== lease.execution
      || result.reportHash !== hash(JSON.stringify(result.report))
      || !Number.isFinite(result.consumedAt) || result.consumedAt < lease.createdAt
      || result.consumedAt >= lease.expiresAt || result.consumedAt > (options.now ?? Date.now())) fail('stale or foreign completion');
  // An accepted result survives lease expiry. Validate it at its recorded
  // consumption time, then separately compare the current source tree.
  review.validateReport(result.report, lease, lease.tree, result.consumedAt);
  if (lease.execution !== 'delegated') return null;
  review.validateAssurance(result.assurance, result.report, lease);
  const value = lease.packet;
  if (!value || value.sha256 !== lease.packetHash || packet.hash(value.payload) !== lease.packetHash
      || value.payload.ticket !== lease.ticket || value.payload.generation !== lease.generation
      || value.payload.round !== lease.round || value.payload.tree !== lease.tree
      || value.payload.root !== binding.projectRoot || !Array.isArray(value.payload.changed_files)) fail('packet binding mismatch');
  const treeChanged = (options.fingerprint || packet.fingerprint)(binding.projectRoot) !== lease.tree;
  // Only terminal inspection may retain the original review after the permitted
  // fix round. It must separately validate a fresh cumulative edit audit. The
  // presentation caller never opts in and cannot mark changed work as reviewed.
  if (treeChanged && !(options.allowSelfReviewFix === true && state.selfReviewFixed === true)) fail('source changed after review');
  return { lease, result, resultFile, leaseFile, treeChanged };
}
function outcome(completed) {
  const verdict = completed?.result.assurance?.consumer?.verdict;
  return require('./chain-recovery-v1.js').REVIEW_VERDICTS.includes(verdict) ? verdict : null;
}
function outcomeForState(state, env = process.env, payload = {}) {
  const sessionId = payload.session_id || env.ZENSU_HOST_SESSION_ID;
  if (!state.codeReviewDone || state.chainDone || !sessionId) return null;
  const binding = require('./runtime-hook-session-v1.js').resolveHookSession({ session_id: sessionId }, env);
  return outcome(load(binding, state));
}
module.exports = { load, outcome, outcomeForState };
