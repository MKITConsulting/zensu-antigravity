'use strict';

// Host-specific packet admission, bound to the existing native child provenance.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const packet = require('../lib/review-packet-v1.js');
const core = require('../lib/session-control-core-v1.js');
const paths = require('./session-paths.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const START = '\n--- ZENSU CANONICAL REVIEW PACKET ---\n';
const END = '\n--- END ZENSU CANONICAL REVIEW PACKET ---\n';
const block = value => START + 'REVIEW PACKET v1\n' + packet.encode(value) + END;
const fail = message => { throw Error(`native-review: ${message}`); };
const TYPES = new Set(['zensu-review-aspect', 'zensu-review-judge', 'zensu-code-reviewer']);

function policy(binding, state, env = process.env) {
  const result = cp.spawnSync('bash', ['-c', 'source "$1/hooks/lib/zensu-config.sh"; zensu_review_panel; printf "\\n"; if zensu_hook_enabled reviewJudge; then printf "on\\n"; else printf "off\\n"; fi', 'native-review-policy', binding.pluginRoot], {
    cwd: binding.projectRoot, env: { ...env, ZENSU_PROJECT_DIR: binding.projectRoot }, encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
  });
  const match = /^(lean|full)\n(on|off)\n$/.exec(result.stdout || '');
  if (result.status !== 0 || !match) fail('review judge configuration is unavailable');
  return { primaryRequired: match[2] === 'on' && !(match[1] === 'lean' && state.reviewRound > 0) };
}
function currentReceipt(binding, options = {}) {
  const receiptPath = path.join(binding.projectRoot, '.zensu/state', `edit-landing-${binding.sessionKey}.json`);
  return (options.receiptFresh || require('../lib/edit-landing-receipt-v1.js').receiptFresh)({
    receiptPath, projectRoot: binding.projectRoot, session: binding.sessionKey,
  });
}
function prepareLease(lease, binding, args, state, options = {}) {
  if (!args['--packet-input']) fail('review --begin requires --packet-input with complete bounded evidence fields');
  const receipt = currentReceipt(binding, options);
  const value = packet.createPacket({ root: binding.projectRoot, baseline: args['--baseline'],
    input: packet.readJson(args['--packet-input']), editLandingReceipt: receipt,
    generation: lease.generation, round: lease.round, ticket: lease.ticket });
  if (value.payload.tree !== lease.tree) fail('packet tree changed while opening this review');
  // The native descriptor contract caps prompts at 128 KiB; leave space for
  // role instructions and findings instead of silently truncating evidence.
  if (Buffer.byteLength(block(value)) > 112 * 1024) fail('canonical packet exceeds the native prompt budget; use bounded evidence summaries');
  return { ...lease, ...(options.policy || policy)(binding, state), packetHash: value.sha256, packet: value };
}
function assertPrompt(prompt, lease) {
  if (typeof prompt !== 'string' || prompt.split(START).length !== 2 || prompt.split(END).length !== 2 || !prompt.includes(block(lease.packet))) {
    fail('child did not receive exactly this immutable canonical review packet');
  }
}
function validatePacket(lease, binding, options = {}) {
  if (!lease.packet || lease.packet.sha256 !== lease.packetHash || packet.hash(lease.packet.payload) !== lease.packetHash
      || lease.packet.payload.ticket !== lease.ticket || lease.packet.payload.generation !== lease.generation
      || lease.packet.payload.round !== lease.round || lease.packet.payload.tree !== lease.tree) fail('canonical review packet binding is invalid');
  const receipt = currentReceipt(binding, options);
  if (packet.hash(receipt) !== packet.hash(lease.packet.payload.edit_landing_receipt)) fail('current audit receipt differs from the frozen review packet');
  const changes = packet.collectChanges({ root: binding.projectRoot, baseline: lease.packet.payload.baseline || '' });
  if (changes.kind !== 'git' || changes.root !== lease.packet.payload.root || changes.head !== lease.packet.payload.head
      || JSON.stringify(changes.changed_files) !== JSON.stringify(lease.packet.payload.changed_files)
      || packet.fingerprint(changes.root) !== lease.tree) fail('review packet is stale for the current cumulative source tree');
}
function findCompletedPrimary(lease, binding, parentId, options = {}) {
  const directory = path.join(binding.pluginData, 'native-agents/v1/results');
  let files;
  try { files = fs.readdirSync(directory); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (files.length > 10000) fail('native completion inventory exceeds its inspection bound');
  for (const file of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const item = paths.readPrivateJson(path.join(directory, file), 2 * 1024 * 1024);
    if (item.parentSessionId !== parentId || item.descriptor?.typeName !== 'zensu-review-judge' || item.descriptor.role !== 'judge') continue;
    try { require('./native-review.js').validateJudge(item.childSessionId, 'judge', lease, binding, { ...options, parentId }); return true; }
    catch { /* Other tickets, stale trees and failed primary reports prove nothing. */ }
  }
  return false;
}
function validateLaunch({ entries, binding, sourceTree, parentId }, options = {}) {
  const relevant = entries.filter(entry => TYPES.has(entry.typeName));
  if (!relevant.length) return;
  if (!options.readState) {
    // A native reviewer outside a workflow remains supported. Do not infer
    // absence from the core reader's diagnostic text: inspect only ENOENT.
    const stateFile = path.join(binding.projectRoot, '.zensu/state', `tdd-phase-${core.sessionKey(binding.sessionKey)}.json`);
    try { fs.lstatSync(stateFile); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
  let state;
  try { state = (options.readState || core.readWorkflowState)({ projectRoot: binding.projectRoot, sessionId: binding.sessionKey }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (state.chainDone) fail('generation is already closed: report existing evidence without spawning review or fix work');
  if (!state.active || !state.implComplete) return;
  if (!state.reviewTicket || state.reviewTicketConsumed) fail('active review requires an open current review ticket');
  const leaseFile = path.join(binding.pluginData, 'in-thread-review/v1', binding.sessionKey, `${hash(state.reviewTicket)}.json`);
  const lease = (options.readLease || paths.readPrivateJson)(leaseFile, 2 * 1024 * 1024);
  if (lease.sessionKey !== binding.sessionKey || lease.runtimeDigest !== binding.context.runtime_digest
      || lease.ticket !== state.reviewTicket || lease.generation !== (state.reviewGeneration || null)
      || lease.round !== state.reviewRound + 1 || lease.tree !== sourceTree || Date.now() >= lease.expiresAt) fail('launch does not match the open generation, round and source tree');
  (options.validatePacket || validatePacket)(lease, binding);
  for (const entry of relevant) {
    const prefix = require('./native-review.js').assignmentPrefix(lease.ticket, lease.tree, entry.role);
    if (!entry.prompt.startsWith(prefix)) fail('launch does not match its ticket/tree/role assignment');
    assertPrompt(entry.prompt, lease);
    if (entry.typeName === 'zensu-review-judge' && !['judge', 'judge-b'].includes(entry.role)) fail('judge role must be judge or judge-b');
    if (entry.typeName === 'zensu-code-reviewer') {
      if (entry.role !== 'consume') fail('consume reviewer role must be consume');
      if (lease.primaryRequired && !(options.findCompletedPrimary || findCompletedPrimary)(lease, binding, parentId, options)) {
        fail('REVIEW INCOMPLETE: required primary judge has not completed for this generation, round and canonical packet. Retry the primary; the additive second judge cannot substitute.');
      }
    }
  }
}
module.exports = { START, END, block, policy, currentReceipt, prepareLease, assertPrompt, validatePacket, findCompletedPrimary, validateLaunch };
