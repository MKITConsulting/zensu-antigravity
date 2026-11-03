#!/usr/bin/env node
'use strict';

// Host translation only. Output is workspace root, then normalized JSON.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const paths = require('./session-paths.js');
const TOOL_NAMES = Object.freeze({ run_command: 'Bash', write_to_file: 'Write', write_file: 'Write', edit_file: 'Edit', read_file: 'Read',
  replace_file_content: 'Edit', multi_replace_file_content: 'MultiEdit',
  view_file: 'Read', grep_search: 'Grep', find_by_name: 'Glob',
  read_url_content: 'WebFetch', search_web: 'WebSearch' });
function firstString(...values) { return values.find((value) => typeof value === 'string' && value) || ''; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function transcriptPrompt(raw, sessionId) {
  const file = firstString(raw.transcriptPath, raw.transcript_path);
  if (!file || !path.isAbsolute(file) || !file.split(path.sep).includes(sessionId)) return '';
  let descriptor;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync.native(file) !== file) return '';
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) return '';
    const start = Math.max(0, opened.size - 2 * 1024 * 1024);
    const bytes = Buffer.alloc(opened.size - start);
    fs.readSync(descriptor, bytes, 0, bytes.length, start);
    const lines = bytes.toString('utf8').split('\n');
    if (start) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (entry.type !== 'USER_INPUT' || entry.source !== 'USER_EXPLICIT' || entry.status !== 'DONE'
          || typeof entry.content !== 'string' || !Number.isSafeInteger(entry.step_index)) continue;
      if (Number.isSafeInteger(raw.initialNumSteps) && raw.initialNumSteps > 0
          && entry.step_index >= raw.initialNumSteps) continue;
      return entry.content;
    }
  } catch { return ''; } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return '';
}
function correlate(payload, event, options = {}) {
  if (!['PreToolUse', 'PostToolUse'].includes(event)
      || !Number.isSafeInteger(payload.step_idx) || payload.step_idx < 0) return payload;
  paths.safeSessionId(payload.session_id);
  const directory = paths.privateDirectory(options.pluginData || paths.dataRoot(), 'tool-calls');
  const key = crypto.createHash('sha256').update(`${payload.session_id}\0${payload.step_idx}`).digest('hex');
  const file = path.join(directory, `${key}.json`);
  const now = options.now === undefined ? Date.now() : options.now;
  if (event === 'PreToolUse') {
    if (!payload.tool_name) return payload;
    paths.writePrivateJson(file, { schema: 'zensu.antigravity.tool-call.v1',
      session_id: payload.session_id, step_idx: payload.step_idx,
      tool_name: payload.tool_name, tool_input: payload.tool_input,
      native_tool_name: payload.native_tool_name, native_tool_input: payload.native_tool_input,
      cwd: payload.cwd, workspace_root: payload.workspace_root, created_at_ms: now });
    return payload;
  }
  let receipt;
  try { receipt = paths.readPrivateJson(file); } catch (error) {
    if (error.code === 'ENOENT') return payload;
    throw error;
  }
  if (receipt.schema !== 'zensu.antigravity.tool-call.v1'
      || receipt.session_id !== payload.session_id || receipt.step_idx !== payload.step_idx
      || !Number.isFinite(receipt.created_at_ms) || receipt.created_at_ms > now
      || now - receipt.created_at_ms > 24 * 60 * 60 * 1000
      || (payload.workspace_root && receipt.workspace_root !== payload.workspace_root)
      || (payload.tool_name && receipt.tool_name !== payload.tool_name)) {
    throw new Error('PostToolUse receipt does not match this host invocation');
  }
  if (!payload.tool_name) payload.tool_name = receipt.tool_name;
  if (!payload.native_tool_name && receipt.native_tool_name) payload.native_tool_name = receipt.native_tool_name;
  if ((!payload.native_tool_input || Object.keys(payload.native_tool_input).length === 0) && receipt.native_tool_input) payload.native_tool_input = receipt.native_tool_input;
  if (Object.keys(payload.tool_input).length === 0) payload.tool_input = receipt.tool_input;
  if (!payload.cwd && receipt.cwd) payload.cwd = receipt.cwd;
  // No exit status is inferred from missing host result metadata.
  return payload;
}
function normalize(input, event = '', options = {}) {
  const raw = object(input), call = object(raw.toolCall), args = object(call.args);
  const prior = object(raw.tool_input), out = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'conversationId')) out.native_payload = true;
  const nativeName = firstString(call.name, raw.tool_name, raw.toolName, args.ToolName);
  out.tool_name = TOOL_NAMES[nativeName] || nativeName;
  if (nativeName) out.native_tool_name = nativeName;
  out.native_tool_input = { ...args };
  // AGY 1.4.3 writes through Path/Content. Compatibility fields must never
  // shadow the actual target or body (including an empty-file write).
  if (nativeName === 'write_file' && (typeof args.Path !== 'string' || !args.Path
      || typeof args.Content !== 'string')) throw new Error('write_file requires Path and Content strings');
  const currentFileTool = ['read_file', 'write_file', 'edit_file'].includes(nativeName);
  // Native fields are authoritative: compatibility aliases cannot redirect a file gate.
  const ti = currentFileTool ? {} : { ...prior };
  const command = firstString(args.CommandLine, args.command, prior.command);
  if (command) ti.command = command;
  const file = currentFileTool ? firstString(args.Path)
    : firstString(args.TargetFile, args.AbsolutePath, args.FilePath, args.file_path, prior.file_path);
  if (file) ti.file_path = file;
  if (nativeName === 'grep_search') {
    if (Object.prototype.hasOwnProperty.call(args, 'SearchPath')) ti.path = args.SearchPath;
    if (Object.prototype.hasOwnProperty.call(args, 'Query')) ti.pattern = args.Query;
    if (Object.prototype.hasOwnProperty.call(args, 'Includes') && (!Array.isArray(args.Includes) || args.Includes.length)) ti.include = args.Includes;
  }
  if (nativeName === 'find_by_name') {
    if (Object.prototype.hasOwnProperty.call(args, 'SearchDirectory')) ti.path = args.SearchDirectory;
    if (Object.prototype.hasOwnProperty.call(args, 'Pattern')) ti.pattern = args.Pattern;
    if (Object.prototype.hasOwnProperty.call(args, 'Excludes') && (!Array.isArray(args.Excludes) || args.Excludes.length)) ti.exclude = args.Excludes;
    if (Object.prototype.hasOwnProperty.call(args, 'Extensions') && (!Array.isArray(args.Extensions) || args.Extensions.length)) ti.include = args.Extensions;
    // An absolute-path glob is a broader grammar than the canonical lease.
    // Preserve it as an unsafe pattern so the lease gate refuses it explicitly.
    if (args.FullPath === true && typeof args.Pattern === 'string') ti.glob = args.Pattern;
  }
  if (nativeName === 'send_message') {
    if (Object.prototype.hasOwnProperty.call(args, 'Recipient')) ti.recipient = args.Recipient;
    if (Object.prototype.hasOwnProperty.call(args, 'Message')) ti.message = args.Message;
  }
  const content = currentFileTool ? (nativeName === 'write_file' ? args.Content : '')
    : firstString(args.CodeContent, args.Content, args.content, args.NewContent, args.CodeEdit, prior.content);
  if (content) ti.content = content;
  const replacement = currentFileTool ? '' : firstString(args.ReplacementContent, args.NewContent, args.new_string, prior.new_string);
  if (replacement) ti.new_string = replacement;
  const old = currentFileTool ? '' : firstString(args.TargetContent, args.old_string, prior.old_string);
  if (old) ti.old_string = old;
  // CLI 1.4.7 uses Path/Target/Replacement, including an empty replacement for deletion.
  if (nativeName === 'edit_file') {
    if (typeof args.Target === 'string') ti.old_string = args.Target;
    if (typeof args.Replacement === 'string') ti.new_string = args.Replacement;
  }
  const edits = [];
  for (const chunks of currentFileTool ? [] : [args.ReplacementChunks, args.Chunks, args.Edits]) {
    if (!Array.isArray(chunks)) continue;
    for (const chunk of chunks) {
      if (typeof chunk === 'string') edits.push({ new_string: chunk });
      else if (chunk && typeof chunk === 'object') edits.push({
        old_string: firstString(chunk.TargetContent, chunk.old_string),
        new_string: firstString(chunk.ReplacementContent, chunk.NewContent, chunk.Content, chunk.content, chunk.new_string) });
    }
  }
  if (edits.length) ti.edits = edits;
  const bodies = [content, nativeName === 'edit_file' ? ti.new_string : replacement, ...edits.map((edit) => edit.new_string)].filter(Boolean);
  if (nativeName === 'write_file') ti.content = content;
  else if (bodies.length) ti.content = bodies.join('\n');
  if (out.tool_name === 'Edit' && !ti.new_string && content) ti.new_string = content;
  out.tool_input = ti;
  const workspaces = Array.isArray(raw.workspacePaths) ? raw.workspacePaths : raw.workspace_paths;
  out.workspace_root = firstString(Array.isArray(workspaces) && workspaces[0], raw.workspaceRoot, raw.workspace_root);
  const cwd = firstString(args.Cwd, args.cwd, raw.cwd, out.workspace_root);
  if (cwd) out.cwd = cwd;
  // The documented conversationId outranks compatibility aliases.
  out.session_id = firstString(raw.conversationId, raw.conversation_id, raw.session_id, raw.sessionId);
  out.host_session_id = out.session_id;
  const transcript = firstString(raw.transcriptPath, raw.transcript_path);
  if (transcript) out.transcript_path = transcript;
  // The host's current human input outranks legacy aliases and transcript fallback.
  const prompt = firstString(raw.lastUserInput, raw.prompt, raw.userMessage, raw.user_message, raw.message,
    raw.ephemeralMessage, raw.text, object(raw.input).text,
    event === 'PreInvocation' ? transcriptPrompt(raw, out.session_id) : '');
  if (prompt) out.prompt = prompt;
  const step = raw.stepIdx === undefined ? raw.step_idx : raw.stepIdx;
  if (Number.isSafeInteger(step) && step >= 0) out.step_idx = step;
  if (event) out.hook_event_name = event === 'PreInvocation' ? 'UserPromptSubmit' : event;
  else if (typeof raw.hook_event_name === 'string') out.hook_event_name = raw.hook_event_name;
  const response = object(raw.toolResponse || raw.tool_response || raw.result), result = {};
  const exitCode = [response.exit_code, response.exitCode, response.ExitCode, response.code]
    .find((value) => typeof value === 'number' && Number.isFinite(value));
  if (exitCode !== undefined) result.exit_code = exitCode;
  const stdout = firstString(response.stdout, response.Output, response.output, response.result);
  if (stdout) result.stdout = stdout;
  if (response.interrupted === true || raw.interrupted === true) result.interrupted = true;
  if (Object.keys(result).length) out.tool_response = result;
  if (typeof raw.error === 'string' && raw.error) out.error = raw.error;
  if (typeof raw.terminationReason === 'string') out.termination_reason = raw.terminationReason;
  if (typeof raw.fullyIdle === 'boolean') out.fully_idle = raw.fullyIdle;
  if (Number.isSafeInteger(raw.executionNum)) out.execution_num = raw.executionNum;
  // Never fabricate native worker identities. Preserve malformed reported
  // fields too, so an unknown identity cannot silently gain main authority.
  for (const [flat, camel] of [['agent_id', 'agentId'], ['agent_type', 'agentType']]) {
    if (Object.prototype.hasOwnProperty.call(raw, camel)) out[flat] = raw[camel];
    else if (Object.prototype.hasOwnProperty.call(raw, flat)) out[flat] = raw[flat];
  }
  if (options.correlate !== false && event && out.session_id) correlate(out, event, options);
  return out;
}
function main() {
  try {
    const raw = fs.readFileSync(0);
    if (raw.length > 1024 * 1024) throw new Error('Hook payload is too large');
    const out = normalize(JSON.parse(raw.toString('utf8') || '{}'), process.argv[2] || '');
    process.stdout.write(`${out.workspace_root}\n${JSON.stringify(out)}`);
  } catch (error) {
    process.stdout.write(`\n${JSON.stringify({ normalization_error: error.message })}`);
  }
}
if (require.main === module) main();
module.exports = { TOOL_NAMES, normalize, correlate, transcriptPrompt, main };
