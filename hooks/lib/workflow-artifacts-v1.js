'use strict';
// Evidence-derived progress for the current workflow. Artifacts grant no authority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./session-control-core-v1.js');
const START = '<!-- zensu:workflow-status -->';
const END = '<!-- /zensu:workflow-status -->';
const MAX_BYTES = 1024 * 1024;
const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeArtifact(root, bucket, file) {
  if (typeof file !== 'string' || !file || /[\0\r\n]/.test(file)) throw Error('artifact path required');
  const base = fs.realpathSync(root), target = path.resolve(base, file), directory = path.join(base, '.zensu', bucket);
  if (path.dirname(target) !== directory || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(path.basename(target))) throw Error('artifact must be a direct safe file in .zensu/' + bucket);
  for (const part of [path.join(base, '.zensu'), directory]) {
    const stat = fs.lstatSync(part);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(part) !== part) throw Error('unsafe artifact directory');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw Error('unsafe artifact file');
  return target;
}
function read(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error('artifact exceeds bound');
  return text;
}
function progressText(text, state) {
  if (text.includes(START) !== text.includes(END) || text.split(START).length > 2 || text.split(END).length > 2) throw Error('ambiguous managed progress section');
  const first = text.indexOf(START), last = text.indexOf(END);
  if (first >= 0 && last < first) throw Error('invalid managed progress section');
  const labels = new Set(['Phase 6 audit', 'Phase 6 audits', 'Review chain', 'Chain close and final report', 'Implementation audit accepted', 'Code review converged', 'Workflow chain closed']);
  const reconcile = value => value.split('\n').map(line => {
    if (!line.startsWith('|') || /\b(?:blocked|cancelled|canceled|skipped)\b/i.test(line)) return line;
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length !== 5 || !labels.has(cells[0])) return line;
    cells[2] = 'see native status';
    cells[4] = 'Lifecycle status is recorded in the managed table below';
    return '| ' + cells.join(' | ') + ' |';
  }).join('\n');
  const row = (done, label, phase) => `| ${label} | ${phase} | ${done ? 'completed' : 'pending'} | Current generation | Observed workflow state |`;
  const block = [START, '## Native workflow status', '', '| Step | Phase | Status | Dependencies | Current action |', '| --- | --- | --- | --- | --- |',
    row(state.implComplete === true, 'Implementation audit accepted', 'Audit'), row(state.codeReviewDone === true, 'Code review converged', 'Review'),
    row(state.chainDone === true, 'Workflow chain closed', 'Closure'), '',
    `Workflow generation: ${state.reviewGeneration}. Observed revision: ${state.revision}.`,
    'Completion records remain authoritative. This table records workflow state, not report delivery.', END].join('\n');
  return first < 0 ? reconcile(text).trimEnd() + '\n\n' + block + '\n'
    : reconcile(text.slice(0, first)) + block + reconcile(text.slice(last + END.length));
}
function artifactLock(options, callback) {
  core.readWorkflowState(options);
  return core.withFileLock(path.join(fs.realpathSync(options.projectRoot), '.zensu', 'state'),
    'artifacts-' + core.sessionKey(options.sessionId), callback);
}
function syncProgress(options) {
  return artifactLock(options, () => syncProgressLocked(options));
}
function syncProgressLocked(options) {
  // Read only after owning the shared artifact lock: a delayed older sync must
  // never overwrite a newer lifecycle status that another call already wrote.
  const state = core.readWorkflowState(options);
  if (!state.workflowArtifacts) return null;
  const artifacts = state.workflowArtifacts;
  if (artifacts.schema !== 'zensu-workflow-artifacts-v1' || !GENERATION.test(state.reviewGeneration || '') || artifacts.generation !== state.reviewGeneration) throw Error('stale workflow artifact binding');
  const file = safeArtifact(options.projectRoot, 'plans', artifacts.plan), previous = read(file), next = progressText(previous, state);
  if (Buffer.byteLength(next) > MAX_BYTES) throw Error('progress artifact exceeds bound');
  if (previous !== next) {
    const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
      safeArtifact(options.projectRoot, 'plans', artifacts.plan);
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  return file;
}
function start(options, log) {
  // Serialize idempotent retries separately from the workflow state CAS. Without
  // this lock a second caller could observe the binding before the marker append.
  return artifactLock(options, () => startLocked(options, log));
}
function startLocked(options, log) {
  const state = core.readWorkflowState(options);
  if (!state.active || state.implComplete || state.chainDone || !GENERATION.test(state.reviewGeneration || '')) throw Error('execution start requires an active implementation generation');
  const file = safeArtifact(options.projectRoot, 'logs', log);
  if (!file.endsWith('.log') || !read(file).trim()) throw Error('initialize the matching plan and log first');
  const plan = safeArtifact(options.projectRoot, 'plans', '.zensu/plans/' + path.basename(file, '.log') + '.md');
  if (!read(plan).trim()) throw Error('matching plan is empty');
  const artifacts = { schema: 'zensu-workflow-artifacts-v1', generation: state.reviewGeneration,
    log: path.relative(options.projectRoot, file), plan: path.relative(options.projectRoot, plan) };
  if (state.workflowArtifacts && JSON.stringify(state.workflowArtifacts) !== JSON.stringify(artifacts)) throw Error('generation already owns another log or plan');
  const marker = 'EXECUTION STARTED — generation=' + state.reviewGeneration;
  const markers = read(file).split('\n').filter(line => /^(?:\[[^\]\r\n]*\] )?EXECUTION STARTED — generation=/.test(line));
  if (markers.length > 1 || markers.some(line => !line.endsWith(marker))) throw Error('log already belongs to another execution generation');
  if (!state.workflowArtifacts) {
    core.mutateWorkflowState({ ...options, expectedRevision: state.revision, workflowState: 'active', event: 'execution-started' }, current => {
      if (current.reviewGeneration !== state.reviewGeneration || !current.active || current.implComplete || current.chainDone) throw Error('workflow changed during execution start');
      current.workflowArtifacts = artifacts;
      return current;
    });
  }
  if (!markers.length) {
    safeArtifact(options.projectRoot, 'logs', artifacts.log);
    const fd = fs.openSync(file, fs.constants.O_APPEND | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0));
    try { fs.writeSync(fd, marker + '\n'); } finally { fs.closeSync(fd); }
  }
  syncProgressLocked(options);
  return { status: 'execution-started', generation: state.reviewGeneration, log: artifacts.log, plan: artifacts.plan };
}
function report(options, ticket) {
  const state = core.readWorkflowState(options);
  if (ticket !== undefined && (ticket !== state.reviewTicket || !state.reviewTicketConsumed)) throw Error('stale self-review ticket');
  return { status: state.chainDone ? 'closed' : 'pending', nextAction: state.chainDone ? 'render-report-only' : 'continue-current-generation',
    generation: state.reviewGeneration || null, revision: state.revision, implComplete: state.implComplete === true,
    codeReviewDone: state.codeReviewDone === true, selfReviewFixed: state.selfReviewFixed === true, chainDone: state.chainDone === true,
    reviewRound: state.reviewRound, plan: state.workflowArtifacts?.plan || null };
}
module.exports = { safeArtifact, progressText, syncProgress, start, report };
