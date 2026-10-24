'use strict';

// Current-tree review receipts. Delegated execution requires a host adapter to
// verify independent child completion evidence before the report can be stored.
// An in-thread receipt makes no claim about an independent reviewer principal.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const binder = require('./runtime-hook-session-v1.js');
const core = require('./session-control-core-v1.js');
const evidence = require('./evidence-run-v1.js');
const schema = 'zensu-in-thread-review-v1';
const delegatedSchema = 'zensu-delegated-review-v1';
function schemaFor(execution) {
  if (execution === 'in-thread') return schema;
  if (execution === 'delegated') return delegatedSchema;
  fail('unsupported review execution');
}
const ttl = 2 * 60 * 60 * 1000;
const fail = message => { throw new Error(`in-thread-review: ${message}`); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) fail('unsafe or oversized report');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function privateDirectory(parent, segments) {
  let dir = fs.realpathSync(parent);
  for (const segment of segments) {
    dir = path.join(dir, segment);
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077)) fail('review store must be a private real directory');
  }
  return dir;
}

function create(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function validateReport(report, lease, tree, now = Date.now()) {
  if (lease.schema !== schemaFor(lease.execution) || now >= lease.expiresAt) fail('review lease is invalid or expired');
  if (!tree || tree !== lease.tree) fail('reviewed source changed; begin a fresh review');
  if (!report || report.schema !== lease.schema || report.execution !== lease.execution
      || report.ticket !== lease.ticket || report.tree !== lease.tree) fail('report does not match this review');
  if (!Array.isArray(report.perspectives) || report.perspectives.length !== lease.roles.length) fail('missing or duplicate review perspective');
  const roles = new Set();
  for (const perspective of report.perspectives) {
    if (!lease.roles.includes(perspective.role) || roles.has(perspective.role)) fail('unexpected or duplicate perspective');
    roles.add(perspective.role);
    if (typeof perspective.summary !== 'string' || !perspective.summary.trim() || perspective.summary.length > 4000) fail('each perspective requires a review summary');
    if (!Array.isArray(perspective.findings) || perspective.findings.length > 100) fail('invalid findings');
    for (const finding of perspective.findings) {
      if (!finding || !['critical', 'important', 'suggestion'].includes(finding.severity)
          || typeof finding.file !== 'string' || !finding.file || path.isAbsolute(finding.file)
          || finding.file.split(/[\\/]/).includes('..') || !Number.isInteger(finding.line) || finding.line < 1
          || (lease.execution === 'in-thread' && (typeof finding.description !== 'string' || !finding.description.trim()))
          || typeof finding.evidence !== 'string' || !finding.evidence.trim()) fail('finding requires severity, relative file, positive line and concrete evidence');
      if (lease.execution === 'delegated' && (['title', 'failure_scenario', 'fix'].some(key => typeof finding[key] !== 'string' || !finding[key].trim())
          || !Number.isInteger(finding.confidence) || finding.confidence < 80 || finding.confidence > 100)) fail('delegated finding requires title, failure scenario, fix and confidence of at least 80');
    }
  }
  return report;
}

function reviewRoles(panel, reviewRound, activationEnabled) {
  if (panel === 'full') return ['conventions', 'bugs', 'architecture', 'tests', 'security'];
  return activationEnabled && reviewRound > 0
    ? ['correctness'] : ['correctness', 'design', 'security'];
}

function argumentsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--begin', '--ticket', '--report', '--packet-input', '--baseline'].includes(key) || Object.hasOwn(out, key)) fail('unknown or duplicate argument');
    if (key === '--begin') out[key] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`missing ${key}`); out[key] = argv[++i]; }
  }
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(out['--ticket'] || '')) fail('a review ticket is required');
  if (!!out['--begin'] === !!out['--report']) fail('choose --begin or --report');
  if (out['--report'] && !path.isAbsolute(out['--report'])) fail('report must be an absolute path');
  if (out['--packet-input'] && !path.isAbsolute(out['--packet-input'])) fail('packet input must be an absolute path');
  if (!out['--begin'] && (out['--packet-input'] || out['--baseline'])) fail('packet arguments require --begin');
  return out;
}

function assertCompletion(payload, env = process.env) {
  const completion = payload.review_completion;
  if (!completion || !['in-thread', 'delegated'].includes(completion.execution)
      || !/^[a-f0-9]{64}$/.test(completion.report_hash || '')) fail('no validated review completion');
  const binding = binder.resolveHookSession(payload, env);
  const state = core.readWorkflowState({ projectRoot: binding.projectRoot, sessionId: binding.sessionKey });
  const ticket = state.reviewTicket;
  if (!ticket || state.reviewTicketConsumed) fail('review generation is stale');
  const dir = privateDirectory(binding.pluginData, ['in-thread-review', 'v1', binding.sessionKey]);
  const lease = read(path.join(dir, `${hash(ticket)}.json`));
  const result = read(path.join(dir, `${hash(ticket)}.result.json`));
  if (lease.sessionKey !== binding.sessionKey || lease.runtimeDigest !== binding.context.runtime_digest
      || result.reportHash !== completion.report_hash || hash(JSON.stringify(result.report)) !== result.reportHash) fail('completion receipt does not match this runtime/session/report');
  const tree = evidence.computeTree(binding.projectRoot, dir);
  validateReport(result.report, lease, tree.tree);
  if (completion.execution !== lease.execution || result.execution !== lease.execution) fail('completion execution does not match');
  if (lease.execution === 'delegated') validateAssurance(result.assurance, result.report, lease);
  const lines = String(completion.prompt || '').split('\n');
  const header = lease.execution === 'delegated' ? 'PRE-MERGED FINDINGS (fan-out)' : 'PRE-MERGED FINDINGS (in-thread)';
  if (lines[0] !== header || lines[1] !== `REVIEW-TICKET: ${ticket}`) fail('completion ticket header does not match');
  return true;
}

function validateAssurance(assurance, report, lease) {
  if (!assurance || assurance.execution !== 'delegated' || assurance.reportHash !== hash(JSON.stringify(report))
      || !Array.isArray(assurance.children) || assurance.children.length !== lease.roles.length) fail('independent child evidence is missing');
  const ids = new Set(), roles = new Set();
  for (const child of assurance.children) {
    if (!child || typeof child.id !== 'string' || !child.id || ids.has(child.id)
        || !lease.roles.includes(child.role) || roles.has(child.role)
        || !/^[a-f0-9]{64}$/.test(child.finalHash || '')) fail('child evidence is malformed or reused');
    ids.add(child.id); roles.add(child.role);
  }
  if (lease.packetHash) {
    if (assurance.packetHash !== lease.packetHash || !Array.isArray(assurance.judges)
        || (lease.primaryRequired && !assurance.judges.some(child => child.role === 'judge'))
        || !assurance.consumer || assurance.consumer.role !== 'consume') fail('packet, primary judge or consume completion evidence is missing');
    const stageRoles = new Set();
    for (const child of [...assurance.judges, assurance.consumer]) {
      if (!child || !['judge', 'judge-b', 'consume'].includes(child.role) || stageRoles.has(child.role)
          || typeof child.id !== 'string' || !child.id || ids.has(child.id)
          || !/^[a-f0-9]{64}$/.test(child.finalHash || '')) fail('stage completion evidence is malformed or reused');
      ids.add(child.id); stageRoles.add(child.role);
    }
  }
  return assurance;
}

function main(argv, env = process.env, options = {}) {
  const args = argumentsOf(argv);
  const execution = options.execution || 'in-thread';
  const activeSchema = schemaFor(execution);
  const session = env.ZENSU_HOST_SESSION_ID;
  const binding = binder.resolveHookSession({ session_id: session }, env);
  const state = core.readWorkflowState({ projectRoot: binding.projectRoot, sessionId: binding.sessionKey });
  const ticket = args['--ticket'];
  if (state.chainDone && state.reviewTicket === ticket) return { status: 'closed', reportOnly: true, ticket,
    generation: state.reviewGeneration || null, instructions: 'This generation is closed. Report its existing evidence; do not create review or fix work.' };
  if (!state.active || !state.implComplete || state.chainDone || state.reviewTicket !== ticket) fail('ticket does not name the current implementation-complete chain');
  const dir = privateDirectory(binding.pluginData, ['in-thread-review', 'v1', binding.sessionKey]);
  const leaseFile = path.join(dir, `${hash(ticket)}.json`);
  const resultFile = path.join(dir, `${hash(ticket)}.result.json`);
  const tree = evidence.computeTree(binding.projectRoot, dir);
  if (!tree.tree) fail(`cannot fingerprint the review scope: ${tree.reason}`);
  if (args['--begin']) {
    if (state.reviewTicketConsumed) fail('ticket was already consumed');
    const cfg = cp.spawnSync('bash', ['-c', 'source "$1/hooks/lib/zensu-config.sh"; zensu_review_panel; printf "\\n"; if zensu_hook_enabled aspectActivation; then printf "on\\n"; else printf "off\\n"; fi', 'review-config', binding.pluginRoot], {
      env: { ...env, ZENSU_PROJECT_DIR: binding.projectRoot }, encoding: 'utf8', timeout: 10000,
    });
    const configLines = cfg.stdout.trim().split('\n');
    if (cfg.status !== 0 || configLines.length !== 2
        || !['lean', 'full'].includes(configLines[0]) || !['on', 'off'].includes(configLines[1])) {
      fail('review panel configuration is unavailable');
    }
    const roles = reviewRoles(configLines[0], state.reviewRound, configLines[1] === 'on');
    let lease = { schema: activeSchema, execution, ticket, tree: tree.tree,
      sessionKey: binding.sessionKey, runtimeDigest: binding.context.runtime_digest,
      generation: state.reviewGeneration || null,
      round: state.reviewRound + 1, roles, createdAt: Date.now(), expiresAt: Date.now() + ttl };
    if (typeof options.prepareLease === 'function') lease = options.prepareLease(lease, binding, args, state);
    if (fs.existsSync(leaseFile)) {
      const old = read(leaseFile);
      if (old.execution !== execution || old.schema !== activeSchema || old.tree !== lease.tree || old.runtimeDigest !== lease.runtimeDigest
          || old.generation !== lease.generation || old.round !== lease.round || old.packetHash !== lease.packetHash
          || Date.now() >= old.expiresAt) fail('existing review lease is stale; issue a fresh ticket');
      return { ...old, reportTemplate: { schema: activeSchema, execution, ticket, tree: old.tree,
        perspectives: old.roles.map(role => ({ role, summary: '', findings: [] })) } };
    }
    create(leaseFile, lease);
    return { ...lease, reportTemplate: { schema: activeSchema, execution, ticket, tree: tree.tree,
      perspectives: roles.map(role => ({ role, summary: '', findings: [] })) } };
  }
  const lease = read(leaseFile);
  if (lease.runtimeDigest !== binding.context.runtime_digest || lease.sessionKey !== binding.sessionKey) fail('review provenance changed');
  if (lease.generation !== (state.reviewGeneration || null)
      || lease.round !== state.reviewRound + (state.reviewTicketConsumed ? 0 : 1)) fail('review generation or round changed');
  if (lease.execution !== execution || lease.schema !== activeSchema) fail('review execution does not match its lease');
  const report = validateReport(read(args['--report']), lease, tree.tree);
  let assurance;
  if (execution === 'delegated') {
    if (typeof options.verifyReport !== 'function') fail('delegated review requires a trusted evidence verifier');
    assurance = validateAssurance(options.verifyReport(report, lease, binding), report, lease);
  }
  const reportHash = hash(JSON.stringify(report));
  if (fs.existsSync(resultFile)) {
    const existing = read(resultFile);
    if (existing.reportHash !== reportHash) fail('create-once report already exists with different content');
    if (existing.directive) return existing;
    if (state.reviewTicketConsumed) fail('review was consumed but routing output was interrupted; inspect --chain-status before recovery');
  } else {
    if (state.reviewTicketConsumed) fail('ticket was already consumed');
    create(resultFile, { schema: activeSchema, execution, reportHash, report, tree: tree.tree, ...(assurance ? { assurance } : {}) });
  }
  let prompt = `PRE-MERGED FINDINGS (${execution === 'delegated' ? 'fan-out' : 'in-thread'})\nREVIEW-TICKET: ${ticket}`;
  if (state.autopilotRunId) prompt += `\nZENSU-DELEGATED-CALLER: autopilot\nAUTOPILOT-BINDING: run=${state.autopilotRunId} attempt=${state.autopilotAttempt} chain=${state.chainId}\nAUTOPILOT-STAGE: ${state.autopilotReturnStage}`;
  const routed = cp.spawnSync('bash', [path.join(binding.pluginRoot, 'hooks/post-review-tdd-delegate.sh')], {
    env, input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: session, cwd: binding.projectRoot,
      review_completion: { execution, prompt, report_hash: reportHash } }),
    encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  if (routed.status !== 0 || !routed.stdout.trim()) {
    const diagnostic = String(routed.stderr || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1000);
    fail(`review routing failed (exit ${routed.status === null ? 'unavailable' : routed.status})${diagnostic ? ': ' + diagnostic : ''}; inspect --chain-status before retrying`);
  }
  const output = JSON.parse(routed.stdout);
  const after = core.readWorkflowState({ projectRoot: binding.projectRoot, sessionId: binding.sessionKey });
  if (!after.reviewTicketConsumed || after.reviewTicket !== ticket) fail('review ticket was not consumed');
  const result = { schema: activeSchema, execution, reportHash, report, tree: tree.tree, ...(assurance ? { assurance } : {}),
    directive: output.hookSpecificOutput?.additionalContext || '', consumedAt: Date.now() };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}

module.exports = { schema, delegatedSchema, schemaFor, validateAssurance, validateReport, reviewRoles, argumentsOf, assertCompletion, main };
