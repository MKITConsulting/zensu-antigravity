'use strict';

// Match only the native host's completed task envelope. A completed command
// can have a nonzero exit; scenario assertions still decide whether it passed.
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const PREFIX = 'The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n';
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
}
function exactLog(url, expected) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && !parsed.hostname && !parsed.search && !parsed.hash
      && fileURLToPath(parsed) === expected;
  } catch { return false; }
}
function resolveBackgroundTask(sessionId, row, turn) {
  if (row.type !== 'GENERIC' || row.source !== 'MODEL' || row.status !== 'RUNNING'
      || typeof row.content !== 'string') return null;
  const parent = turn.find(item => item.step_index === row.step_index - 1);
  if (parent?.type !== 'PLANNER_RESPONSE' || parent.source !== 'MODEL' || parent.status !== 'DONE'
      || parent.tool_calls?.length !== 1 || parent.tool_calls[0].name !== 'run_command') return null;
  const command = parent.tool_calls[0].args?.CommandLine;
  if (typeof command !== 'string' || !command.trim()) return null;
  const taskId = sessionId + '/task-' + row.step_index;
  const logFile = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sessionId,
    '.system_generated/tasks/task-' + row.step_index + '.log');
  const created = [...row.content.matchAll(/^Created At: ([^\r\n]+)$/gm)];
  if (created.length !== 1 || timestamp(created[0][1]) !== timestamp(row.created_at)) return null;
  const starts = [...row.content.matchAll(/^Tool is running as a background task with task id: ([^\s]+)$/gm)];
  const logs = [...row.content.matchAll(/^Task logs are available at: (file:[^\r\n]+)$/gm)];
  if (starts.length !== 1 || starts[0][1] !== taskId || logs.length !== 1
      || !exactLog(logs[0][1], logFile)
      || !row.content.includes('\nTask Description: ' + command + '\nTask logs are available at: ' + logs[0][1])) return null;
  // Count the whole current turn before ordering the unique result. An earlier
  // same-task completion is contradictory evidence, not an ignorable row.
  const related = turn.filter(item => item.source === 'SYSTEM'
    && item.type === 'SYSTEM_MESSAGE' && typeof item.content === 'string' && item.content.startsWith(PREFIX)
    && item.content.slice(PREFIX.length).split('\n')[0].includes(' sender=' + taskId + ' '));
  if (related.length !== 1 || related[0].status !== 'DONE'
      || related[0].step_index <= row.step_index) return null;
  const result = related[0];
  const match = result.content.slice(PREFIX.length).match(/^\[Message\] timestamp=(\S+) sender=(\S+) priority=MESSAGE_PRIORITY_HIGH content=Task id "([^"\n]+)" finished with result:\nCommand exited with code ([0-9]+)\.\n([\s\S]*)\nLog: (file:[^\r\n]+)\n<\/SYSTEM_MESSAGE>\s*$/);
  if (!match || match[2] !== taskId || match[3] !== taskId || !exactLog(match[6], logFile)) return null;
  const exitCode = Number(match[4]), started = timestamp(row.created_at);
  const completed = timestamp(match[1]), delivered = timestamp(result.created_at);
  if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255
      || ![started, completed, delivered].every(Number.isFinite) || completed < started || delivered < completed) return null;
  return { taskId, startedStep: row.step_index, completedStep: result.step_index, exitCode, logFile,
    commandHash: hash(command), startedHash: hash(JSON.stringify(row)), completionHash: hash(JSON.stringify(result)) };
}
module.exports = { resolveBackgroundTask };
