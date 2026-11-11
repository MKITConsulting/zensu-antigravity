'use strict';

// Terminal admission uses the host's completed reads, never a model-authored
// checklist. It proves rereading current bytes, not the quality of reflection.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const provenance = require('./native-agent-provenance.js');
const completed = require('../lib/completed-review-v1.js');
const core = require('../lib/session-control-core-v1.js');
const fail = message => { throw Error(`SELF-REVIEW REQUIRED: ${message}`); };
const terminal = require('./session-helper.js').terminalReviewRequest;

function enabled(binding, env) {
  const result = cp.spawnSync('bash', ['-c', 'source "$1/hooks/lib/zensu-config.sh" || exit 2; if zensu_hook_enabled selfReview; then printf on; else printf off; fi', 'self-review-policy', binding.pluginRoot], {
    env: { ...env, ZENSU_PROJECT_DIR: binding.projectRoot }, encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
  });
  if (result.status !== 0 || !['on', 'off'].includes(result.stdout)) fail('configuration is unavailable');
  return result.stdout === 'on';
}
function records(payload) {
  const loc = provenance.location(payload);
  const file = path.join(path.dirname(loc.transcript), 'transcript_full.jsonl');
  const rows = provenance.transcriptRows(file);
  let previous = -1;
  for (const row of rows) {
    if (!Number.isInteger(row.step_index) || row.step_index <= previous) fail('host transcript ordering is unavailable');
    previous = row.step_index;
  }
  return rows.filter(row => row.step_index < payload.step_idx);
}
function completedCommand(rows, planner, offset, sid) {
  const index = planner.step_index + offset + 1;
  const row = rows.find(item => item.step_index === index);
  if (!row || row.source !== 'MODEL' || row.type !== 'GENERIC') return null;
  if (row.status === 'DONE' && /(?:^|\n)Command exited with code 0\.(?:\n|$)/.test(row.content || '')) return index;
  if (row.status !== 'RUNNING') return null;
  const task = `${sid}/task-${index}`;
  const header = new RegExp(`^\\[Message\\](?: timestamp=\\S+)? sender=${task} (?:priority=\\S+ )?content=Task id "${task}" finished with result:\\r?\\nCommand exited with code 0\\.(?:\\r?\\n|$)`);
  const done = rows.find(item => {
    if (item.step_index <= index || item.source !== 'SYSTEM' || item.type !== 'SYSTEM_MESSAGE' || item.status !== 'DONE') return false;
    const content = String(item.content || '');
    const wrapper = 'The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n';
    const body = content.startsWith(wrapper) && content.endsWith('\n</SYSTEM_MESSAGE>')
      ? content.slice(wrapper.length, -'\n</SYSTEM_MESSAGE>'.length) : content;
    return header.test(body);
  });
  return done?.step_index ?? null;
}
function completionBoundary(rows, request, root, ticket) {
  let boundary = -1;
  const guard = require('./session-command-guard.js');
  for (const planner of rows) {
    if (planner.type !== 'PLANNER_RESPONSE' || planner.source !== 'MODEL' || planner.status !== 'DONE'
        || !Array.isArray(planner.tool_calls)) continue;
    planner.tool_calls.forEach((call, offset) => {
      if (call.name !== 'run_command') return;
      const command = call.args?.CommandLine;
      const inspected = guard.inspectCommand({ tool_name: 'Bash', session_id: request.sessionId, tool_input: { command } }, { pluginRoot: root });
      const previous = inspected.request;
      if (inspected.kind !== 'helper' || !previous.args.includes(ticket)
          || !(previous.helper === 'log' && previous.args.includes('--code-review-done')
            || previous.helper === 'review' && previous.args.includes('--report'))) return;
      const done = completedCommand(rows, planner, offset, request.sessionId);
      if (done !== null) boundary = Math.max(boundary, done);
    });
  }
  if (boundary < 0) fail('no completed code-review command belongs to this ticket');
  return boundary;
}
function readCoverage(rows, boundary, file, content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const seen = new Set();
  for (const planner of rows) {
    if (planner.step_index <= boundary || planner.type !== 'PLANNER_RESPONSE'
        || planner.source !== 'MODEL' || planner.status !== 'DONE' || !Array.isArray(planner.tool_calls)) continue;
    planner.tool_calls.forEach((call, offset) => {
      if (!['read_file', 'view_file'].includes(call.name) || (call.args?.Path ?? call.args?.AbsolutePath) !== file) return;
      const row = rows.find(item => item.step_index === planner.step_index + offset + 1);
      if (!row || row.type !== 'GENERIC' || row.source !== 'MODEL' || row.status !== 'DONE') return;
      const match = /(?:^|\n)Showing lines (\d+)-(\d+) of (\d+)\n([\s\S]*)$/.exec(row.content || '');
      if (!match || Number(match[3]) !== lines.length) return;
      const first = Number(match[1]), last = Number(match[2]);
      if (first < 1 || last < first || last > lines.length) return;
      const shown = match[4].split('\n');
      if (shown.at(-1) === '') shown.pop();
      if (shown.length !== last - first + 1) return;
      for (let index = first; index <= last; index++) {
        if (shown[index - first] !== `${index}: ${lines[index - 1]}`) return;
      }
      for (let index = first; index <= last; index++) seen.add(index);
    });
  }
  // Empty files contain no source lines to reread; the current packet records
  // their addition/deletion/mode and still has to be inspected below.
  return lines.length > 0 && seen.size === lines.length;
}
function verify(request, payload, options = {}) {
  if (!terminal(request)) return null;
  const env = options.environment || process.env;
  const binding = (options.resolve || require('../lib/runtime-hook-session-v1.js').resolveHookSession)({ session_id: request.sessionId }, env);
  const state = (options.readState || core.readWorkflowState)({ projectRoot: binding.projectRoot, sessionId: binding.sessionKey });
  if (state.chainDone || !(options.enabled || enabled)(binding, env)) return null;
  // No-review and synthetic zero-change tickets remain subject to the canonical
  // helper's zero-change/landing gates. They have no delegated result to reread.
  if (!state.reviewTicket || /^zc_.+/.test(state.reviewTicket)) return null;
  if (payload?.session_id !== request.sessionId || !Number.isInteger(payload.step_idx)) fail('native command provenance is missing');
  const evidence = (options.load || completed.load)(binding, state, { allowSelfReviewFix: true });
  if (!evidence) fail('a consumed current-tree review is required');
  const files = new Set(evidence.lease.packet.payload.changed_files);
  const packetFiles = [evidence.leaseFile];
  if (evidence.treeChanged) {
    const auditFile = path.join(binding.projectRoot, ...core.WORKFLOW_STATE_SEGMENTS, `edit-landing-${binding.sessionKey}.json`);
    const audit = require('../lib/edit-landing-receipt-v1.js').receiptFresh({ receiptPath: auditFile,
      projectRoot: binding.projectRoot, session: request.sessionId });
    const baseline = evidence.lease.packet.payload.baseline || '';
    if (audit.auditScope.baseline !== baseline) fail('the self-review fix changed the original review baseline');
    const changes = require('../lib/review-packet-v1.js').collectChanges({ root: binding.projectRoot, baseline });
    if (changes.kind !== 'git') fail('the cumulative self-review fix inventory is unavailable');
    changes.changed_files.forEach(file => files.add(file));
    packetFiles.push(auditFile);
  }
  const rows = records(payload);
  const boundary = completionBoundary(rows, request, binding.pluginRoot, state.reviewTicket);
  const missing = [];
  let packetNeeded = false;
  for (const relative of files) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('unsafe changed-file inventory');
    const file = path.join(binding.projectRoot, relative);
    let content;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) { packetNeeded = true; continue; }
      content = provenance.readHostFile(file, 2 * 1024 * 1024);
    } catch (e) {
      if (e.code === 'ENOENT') { packetNeeded = true; continue; }
      throw e;
    }
    if (!content.length || content.includes('\0')) { packetNeeded = true; continue; }
    if (!readCoverage(rows, boundary, file, content)) missing.push(file);
  }
  if (packetNeeded) for (const file of packetFiles) {
    if (!readCoverage(rows, boundary, file, provenance.readHostFile(file, 2 * 1024 * 1024))) missing.push(file);
  }
  if (missing.length) fail(`read the complete current files after code review, then reflect before retrying closure: ${missing.join(', ')}`);
  return { session_id: request.sessionId, transcript_path: payload.transcript_path, step_idx: payload.step_idx };
}
module.exports = { terminal, enabled, records, completedCommand, completionBoundary, readCoverage, verify };
