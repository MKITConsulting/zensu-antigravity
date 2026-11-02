#!/usr/bin/env node
'use strict';

// Native process provenance is correlated with a protected, accepted launch.
// Host sidecars and transcripts are evidence, never instructions or authority
// to manufacture a launch. No undocumented database format is used here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const paths = require('./session-paths.js');
const core = require('../lib/session-control-core-v1.js');
const SCHEMA = 'zensu.antigravity.native-launch.v1';
const CHILD_SCHEMA = 'zensu.antigravity.native-child.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES = new Set(['zensu-code-reviewer', 'zensu-review-aspect', 'zensu-review-judge',
  'zensu-plan-review-worker', 'zensu-pr-review-worker', 'zensu-gauntlet-critic', 'zensu-plm']);
function validType(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value); }
const MAX_TRANSCRIPT = 16 * 1024 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function fail(message) { throw new Error(`Native agent provenance: ${message}`); }
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('invalid conversation id'); return value; }
function recordDirs(options = {}) {
  const data = options.pluginData || paths.dataRoot();
  const root = paths.privateDirectory(data, 'native-agents', 'v1');
  return { root, launches: paths.privateDirectory(root, 'launches'),
    children: paths.privateDirectory(root, 'children'), mains: paths.privateDirectory(root, 'mains'), locks: paths.privateDirectory(root, 'locks') };
}
function readHostFile(file, maximum = MAX_TRANSCRIPT) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file) fail('host path is not canonical');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || fs.realpathSync.native(file) !== file) fail('host file is unsafe or too large');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > maximum) fail('host file changed while opening');
    const content = fs.readFileSync(fd, 'utf8');
    if (Buffer.byteLength(content) > maximum) fail('host file grew beyond the limit');
    return content;
  } finally { fs.closeSync(fd); }
}
function location(payload) {
  const sessionId = id(payload.host_session_id || payload.session_id);
  const transcript = payload.transcript_path;
  if (typeof transcript !== 'string' || !path.isAbsolute(transcript)) fail('the host transcript path is missing');
  const basename = path.basename(transcript);
  if (!['transcript.jsonl', 'transcript_full.jsonl'].includes(basename)) fail('the host transcript name is unsupported');
  const suffix = path.join(sessionId, '.system_generated', 'logs', basename);
  if (!transcript.endsWith(path.sep + suffix)) fail('the host transcript does not belong to this conversation');
  const brain = transcript.slice(0, -(suffix.length + 1));
  if (!brain || fs.realpathSync.native(brain) !== brain) fail('the host transcript root is aliased');
  return { sessionId, transcript, brain };
}
function transcriptRows(file) {
  const rows = [];
  for (const [index, line] of readHostFile(file).split('\n').entries()) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { fail(`invalid host transcript record ${index}`); }
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.step_index) || row.step_index < 0) fail('invalid host transcript step');
    rows.push(row);
  }
  return rows;
}
function safeRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) fail('workspace root is missing');
  const real = fs.realpathSync.native(value);
  if (real !== value || !fs.statSync(real).isDirectory()) fail('workspace root is aliased');
  return real;
}
function decodeArgument(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function descriptors(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('invalid native dispatch arguments');
  // Current native calls expose one descriptor; earlier calls used a batch.
  // Parse both here so admission and actual parent transcript checks agree.
  // Never choose one interpretation of mixed arguments or rewrite host input.
  const batch = Object.hasOwn(args, 'Subagents');
  if (batch && Object.keys(args).some((key) => key !== 'Subagents')) fail('unsupported or mixed native dispatch wrapper field');
  const items = batch ? decodeArgument(args.Subagents) : [args];
  if (!Array.isArray(items) || !items.length || items.length > 16) fail('Subagents must contain between one and sixteen roles');
  const roles = new Set();
  return items.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('invalid native agent descriptor');
    if (Object.keys(entry).some((key) => !['TypeName', 'Role', 'Prompt', 'Model', 'Workspace'].includes(key))) fail('unsupported native agent descriptor field');
    const { TypeName: typeName, Role: role, Prompt: prompt } = entry;
    if (!validType(typeName)) fail('the named agent type is missing or unsafe');
    if (typeof role !== 'string' || !role.trim() || role.length > 256 || /[\0\r\n]/.test(role) || roles.has(role)) fail('each launch role must be unique and bounded');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 128 * 1024 || prompt.includes('\0')) fail('the launch prompt is missing or too large');
    if ((Object.hasOwn(entry, 'Model') && entry.Model !== 'inherit') || (Object.hasOwn(entry, 'Workspace') && entry.Workspace !== 'inherit')) fail('review agents must inherit the verified model and workspace');
    roles.add(role);
    return { index, typeName, role, prompt, promptSha256: hash(prompt), model: 'inherit', workspace: 'inherit' };
  });
}
function inspectLaunch(payload) {
  const tool = payload.native_tool_name || payload.tool_name;
  if (tool !== 'invoke_subagent') return [];
  if (payload.agent_id !== undefined || payload.agent_type !== undefined
      || (payload.host_session_id && payload.host_session_id !== payload.session_id)) fail('read-only children cannot dispatch agents');
  id(payload.session_id);
  if (!Number.isSafeInteger(payload.step_idx) || payload.step_idx < 0) fail('the native dispatch step is missing');
  safeRoot(payload.workspace_root);
  const items = descriptors(payload.native_tool_input || payload.tool_input);
  return items.map((entry) => ({ ...entry, canonicalPayload: { ...payload, tool_name: 'Agent',
    tool_input: { subagent_type: entry.typeName, description: entry.role, prompt: entry.prompt } } }));
}
function parentBinding(payload, options) {
  const binder = options.binder || require('../lib/runtime-hook-session-v1.js');
  return binder.resolveHookSession(payload, { ...process.env,
    ZENSU_PLUGIN_ROOT: options.pluginRoot || paths.pluginRoot(),
    ZENSU_PLUGIN_DATA: options.pluginData || paths.dataRoot() }, { autoAdopt: false });
}
function launchFile(dirs, parent, step) { return path.join(dirs.launches, `${hash(parent)}-${step}.json`); }
function authorizeLaunch(payload, options = {}) {
  const inspected = inspectLaunch(payload);
  if (!inspected.length) return { authorized: false };
  const source = location(payload), root = safeRoot(payload.workspace_root);
  const binding = parentBinding(payload, options);
  if (binding.projectRoot !== root) fail('launch workspace differs from the bound project');
  const entries = inspected.map(({ canonicalPayload, ...entry }) => entry);
  const dirs = recordDirs(options);
  const computeTree = options.computeTree || require('../lib/evidence-run-v1.js').computeTree;
  const snapshot = computeTree(binding.projectRoot, dirs.root), sourceTree = snapshot.tree;
  if (!(typeof sourceTree === 'string' && /^[a-f0-9]{40,64}$/.test(sourceTree))
      && !(sourceTree === null && snapshot.reason === 'not a git work tree')) fail('source tree snapshot is unavailable');
  (options.validateReviewLaunch || require('./native-review-packet.js').validateLaunch)({
    entries, binding, sourceTree, parentId: source.sessionId,
  });
  const record = { schema: SCHEMA, parentSessionId: source.sessionId, spawnStepIndex: payload.step_idx,
    workspaceRoot: root, brain: source.brain, parentTranscript: source.transcript,
    pluginRoot: binding.pluginRoot, runtimeDigest: binding.context.runtime_digest,
    sessionKey: binding.sessionKey, sourceTree, launchReceiptId: hash(`${source.sessionId}:${payload.step_idx}`), createdAtMs: options.now === undefined ? Date.now() : options.now,
    entries, claimedChildren: {} };
  const file = launchFile(dirs, source.sessionId, payload.step_idx);
  return core.withFileLock(dirs.locks, `launch-${hash(`${source.sessionId}:${payload.step_idx}`)}`, () => {
    let previous;
    try { previous = paths.readPrivateJson(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      if (previous.schema !== SCHEMA || previous.parentSessionId !== record.parentSessionId
          || previous.spawnStepIndex !== record.spawnStepIndex || previous.workspaceRoot !== root
          || previous.runtimeDigest !== record.runtimeDigest || previous.sourceTree !== sourceTree || !same(previous.entries, entries)) fail('a different invocation already owns this dispatch step');
      return { authorized: true, receipt: previous };
    }
    paths.writePrivateJson(file, record);
    return { authorized: true, receipt: record };
  });
}
function initialParentMessage(rows) {
  const firstUser = rows.find((row) => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT' && row.status === 'DONE');
  const messages = rows.filter((row) => (!firstUser || row.step_index < firstUser.step_index) && row.type === 'SYSTEM_MESSAGE' && row.source === 'SYSTEM'
    && row.status === 'DONE' && typeof row.content === 'string');
  for (const row of messages) {
    const match = row.content.match(/(?:^|\n)\[Message\] timestamp=[^\s]+ sender=([a-f0-9-]{36}) priority=MESSAGE_PRIORITY_HIGH content=([\s\S]*?)(?:\n<\/SYSTEM_MESSAGE>)?$/i);
    if (match && UUID.test(match[1])) return { parentSessionId: match[1], prompt: match[2], stepIndex: row.step_index };
  }
  return null;
}
function spawnedChildren(content) {
  if (typeof content !== 'string') fail('native dispatch result is missing');
  const marker = /^Created the following (subagents?):\n/gm;
  const match = marker.exec(content);
  if (!match || marker.exec(content)) fail('native dispatch result is missing or ambiguous');
  let rest = content.slice(match.index + match[0].length).trimStart();
  const values = [];
  while (rest.startsWith('{')) {
    let depth = 0, quote = false, escaped = false, end = -1;
    for (let index = 0; index < rest.length; index += 1) {
      const char = rest[index];
      if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quote = false; continue; }
      if (char === '"') quote = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) { end = index + 1; break; }
    }
    if (end < 0) fail('native dispatch result JSON is incomplete');
    values.push(JSON.parse(rest.slice(0, end)));
    rest = rest.slice(end).trimStart();
  }
  if (!values.length || values.length > 16 || (match[1] === 'subagent' && values.length !== 1)) fail('native dispatch result has an invalid child count');
  return values;
}
function launchBatch(rows, step) {
  if (!rows.every((row, index) => !index || row.step_index > rows[index - 1].step_index)) fail('parent transcript steps are not ordered');
  const planner = [...rows].reverse().find((row) => row.step_index < step
    && row.source === 'MODEL' && row.type === 'PLANNER_RESPONSE');
  if (!planner || planner.status !== 'DONE' || !Array.isArray(planner.tool_calls)
      || !planner.tool_calls.length || planner.tool_calls.length > 256) fail('native dispatch batch is unavailable');
  const index = step - planner.step_index - 1;
  if (index < 0 || index >= planner.tool_calls.length
      || planner.tool_calls[index]?.name !== 'invoke_subagent') fail('native dispatch step is not an agent call in this batch');
  return { planner, index };
}
function verifyParentLaunch(receipt, childId, childTranscript, options = {}) {
  const rows = transcriptRows(receipt.parentTranscript);
  const { planner, index } = launchBatch(rows, receipt.spawnStepIndex);
  const result = rows.find((row) => row.step_index === receipt.spawnStepIndex);
  if (!result || result.source !== 'MODEL' || result.type !== 'GENERIC' || result.status !== 'DONE') fail('the accepted native dispatch has no completed host result');
  const children = spawnedChildren(result.content);
  if (children.length !== receipt.entries.length || new Set(children.map((entry) => entry.conversationId)).size !== children.length) fail('native child results differ from the accepted batch');
  const child = children.find((entry) => entry.conversationId === childId);
  if (!child || !same(child.workspaceUris, [pathToFileURL(receipt.workspaceRoot).href])) fail('native dispatch child path or workspace does not match');
  // The CLI hook names transcript_full.jsonl, while its dispatch result names
  // transcript.jsonl. Both must identify this exact child in the same host root.
  const published = location({ session_id: childId, transcript_path: fileURLToPath(child.logAbsoluteUri) });
  const observed = location({ session_id: childId, transcript_path: childTranscript });
  if (published.brain !== observed.brain || path.dirname(published.transcript) !== path.dirname(observed.transcript)) fail('native dispatch child path or workspace does not match');
  readHostFile(published.transcript);
  if (!same(descriptors(planner.tool_calls[index].args), receipt.entries)) fail('native dispatch arguments differ from the accepted invocation');
  return { resultStep: result.step_index, children };
}
function validateReceipt(receipt, source, workspace, options) {
  const now = options.now === undefined ? Date.now() : options.now;
  if (!receipt || receipt.schema !== SCHEMA || receipt.brain !== source.brain || receipt.workspaceRoot !== workspace
      || !(receipt.sourceTree === null || (typeof receipt.sourceTree === 'string' && /^[a-f0-9]{40,64}$/.test(receipt.sourceTree)))
      || !Number.isFinite(receipt.createdAtMs) || receipt.createdAtMs > now || now - receipt.createdAtMs > MAX_AGE) fail('launch receipt is missing, stale, or belongs to another workspace');
  const binding = parentBinding({ session_id: receipt.parentSessionId, workspace_root: workspace,
    cwd: workspace, hook_event_name: 'PreToolUse' }, options);
  if (binding.projectRoot !== workspace || binding.pluginRoot !== receipt.pluginRoot
      || binding.context.runtime_digest !== receipt.runtimeDigest || binding.sessionKey !== receipt.sessionKey) fail('launch context is no longer valid');
  return binding;
}
function childLaunchStep(source, parent, sidecar) {
  const file = path.join(source.brain, parent.parentSessionId, '.system_generated', 'logs', path.basename(source.transcript));
  const rows = transcriptRows(file);
  if (!rows.every((row, index) => !index || row.step_index > rows[index - 1].step_index)) fail('parent transcript steps are not ordered');
  const anchor = rows.find(row => row.step_index === sidecar.spawnStepIndex);
  if (anchor) {
    if (anchor.type !== 'GENERIC' || anchor.source !== 'MODEL' || anchor.status !== 'DONE') fail('native sidecar batch anchor is incomplete');
    spawnedChildren(anchor.content);
  }
  const matches = rows.filter(row => {
    if (row.type !== 'GENERIC' || row.source !== 'MODEL' || row.status !== 'DONE') return false;
    try { return spawnedChildren(row.content).some(child => child.conversationId === source.sessionId); }
    catch { return false; }
  });
  if (matches.length !== 1) fail('the child has no unique completed parent result');
  const result = matches[0];
  if (sidecar.spawnStepIndex !== result.step_index) {
    // CLI 1.4.7 assigns every sidecar in a multi-call planner response the final
    // tool-step index. Accept only that observed shape, with the child's exact
    // UUID in its own completed result and its descriptor at the matching offset.
    const planner = [...rows].reverse().find(row => row.step_index < result.step_index
      && row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL' && row.status === 'DONE');
    const calls = planner?.tool_calls;
    if (!Array.isArray(calls) || calls.length < 2 || calls.length > 16
        || sidecar.spawnStepIndex !== planner.step_index + calls.length
        || calls.some(call => call.name !== 'invoke_subagent' || !call.args || Object.hasOwn(call.args, 'Subagents'))) {
      fail('native sidecar dispatch step differs from the completed result');
    }
    const entries = calls.map(call => descriptors(call.args)[0]);
    const index = result.step_index - planner.step_index - 1;
    const entry = entries[index];
    if (!entry || entry.typeName !== sidecar.subagentDescriptor.typeName
        || entry.role !== sidecar.subagentDescriptor.role || entry.prompt !== parent.prompt
        || new Set(entries.map(item => item.role)).size !== entries.length
        || rows.some(row => row.step_index > planner.step_index && row.step_index <= sidecar.spawnStepIndex
          && row.type === 'PLANNER_RESPONSE')) fail('native multi-call sidecar does not match its exact role and result');
  }
  return result.step_index;
}
function verifyChild(payload, options = {}) {
  const source = location(payload), workspace = safeRoot(payload.workspace_root);
  const rows = transcriptRows(source.transcript), parent = initialParentMessage(rows);
  if (!parent) return { status: 'pending', reason: 'The native parent message is not yet available' };
  if (parent.parentSessionId === source.sessionId) fail('a child cannot be its own parent');
  const sidecarPath = path.join(source.brain, parent.parentSessionId, '.system_generated', 'subagents', `${source.sessionId}.json`);
  const sidecar = JSON.parse(readHostFile(sidecarPath, 64 * 1024));
  if (sidecar.conversationId !== source.sessionId || !Number.isSafeInteger(sidecar.spawnStepIndex)
      || sidecar.spawnStepIndex < 0 || !sidecar.subagentDescriptor || !validType(sidecar.subagentDescriptor.typeName)
      || !same(sidecar.workspaceUris, [pathToFileURL(workspace).href])) fail('native child descriptor does not match');
  const spawnStepIndex = childLaunchStep(source, parent, sidecar);
  const dirs = recordDirs(options), file = launchFile(dirs, parent.parentSessionId, spawnStepIndex);
  return core.withFileLock(dirs.locks, `launch-${hash(`${parent.parentSessionId}:${spawnStepIndex}`)}`, () => {
    const receipt = paths.readPrivateJson(file);
    validateReceipt(receipt, source, workspace, options);
    if (receipt.parentSessionId !== parent.parentSessionId || receipt.spawnStepIndex !== spawnStepIndex) fail('launch receipt selectors do not match');
    const entries = receipt.entries.filter((entry) => entry.typeName === sidecar.subagentDescriptor.typeName
      && entry.role === sidecar.subagentDescriptor.role && entry.prompt === parent.prompt && entry.promptSha256 === hash(parent.prompt));
    if (entries.length !== 1) fail('native child prompt or role differs from the accepted dispatch');
    verifyParentLaunch(receipt, source.sessionId, source.transcript, options);
    const entry = entries[0], claim = receipt.claimedChildren[String(entry.index)];
    if (claim && claim !== source.sessionId) fail('the accepted role is already bound to another child');
    if (!claim) {
      receipt.claimedChildren[String(entry.index)] = source.sessionId;
      paths.writePrivateJson(file, receipt);
    }
    const provenance = { schema: CHILD_SCHEMA, parentSessionId: parent.parentSessionId,
      childSessionId: source.sessionId, typeName: entry.typeName, readOnlyProfile: TYPES.has(entry.typeName), role: entry.role,
      prompt: entry.prompt, promptSha256: entry.promptSha256, spawnStepIndex,
      workspaceRoot: workspace, childTranscript: source.transcript, parentTranscript: receipt.parentTranscript,
      runtimeDigest: receipt.runtimeDigest, sourceTree: receipt.sourceTree, launchReceiptId: receipt.launchReceiptId, launchCreatedAtMs: receipt.createdAtMs };
    const childFile = path.join(dirs.children, `${hash(source.sessionId)}.json`);
    let previous;
    try { previous = paths.readPrivateJson(childFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous && !same(previous, provenance)) fail('the native child principal changed');
    if (!previous) paths.writePrivateJson(childFile, provenance);
    return { status: 'child', provenance, rows };
  });
}
function prepare(payload, options = {}) {
  try {
    const source = location(payload);
    const dirs = recordDirs(options), childFile = path.join(dirs.children, `${hash(source.sessionId)}.json`);
    let knownChild = false;
    try { fs.lstatSync(childFile); knownChild = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const mainFile = path.join(dirs.mains, `${hash(source.sessionId)}.json`);
    let knownMain;
    try { knownMain = paths.readPrivateJson(mainFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (knownMain && !knownChild) {
      if (knownMain.schema !== 'zensu.antigravity.native-main.v1' || knownMain.sessionId !== source.sessionId
          || knownMain.workspaceRoot !== safeRoot(payload.workspace_root) || knownMain.brain !== source.brain
          || payload.agent_id !== undefined || payload.agent_type !== undefined) fail('the verified main principal changed');
      return { status: 'main', skipMainLifecycle: false, payload: { ...payload, host_session_id: source.sessionId } };
    }
    const rows = transcriptRows(source.transcript), parent = initialParentMessage(rows);
    if (parent || knownChild) {
      const child = verifyChild(payload, options);
      if (child.status !== 'child') return { ...child, skipMainLifecycle: true, payload };
      const canonical = { ...payload, host_session_id: source.sessionId,
        session_id: child.provenance.parentSessionId, agent_id: source.sessionId, agent_type: child.provenance.typeName };
      const args = payload.native_tool_input || {};
      if (payload.native_tool_name === 'send_message' && args.Recipient === child.provenance.parentSessionId
          && typeof args.Message === 'string') {
        canonical.tool_name = 'SubagentHandback';
        canonical.tool_input = { message: args.Message };
      }
      return { status: 'child', skipMainLifecycle: true, provenance: child.provenance, payload: canonical };
    }
    const explicit = rows.some((row) => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT' && row.status === 'DONE');
    if (!explicit) return { status: 'pending', skipMainLifecycle: true, payload,
      reason: 'The host has not yet recorded an explicit main input or verified parent launch' };
    if (payload.agent_id !== undefined || payload.agent_type !== undefined) fail('unverified agent identity fields are present');
    paths.writePrivateJson(mainFile, { schema: 'zensu.antigravity.native-main.v1', sessionId: source.sessionId,
      workspaceRoot: safeRoot(payload.workspace_root), brain: source.brain });
    return { status: 'main', skipMainLifecycle: false, payload: { ...payload, host_session_id: source.sessionId } };
  } catch (error) { return { status: 'deny', skipMainLifecycle: true, payload, reason: error.message }; }
}
function latestChildResponse(payload, options = {}) {
  const verified = verifyChild(payload, options);
  if (verified.status !== 'child') fail('child provenance is not ready');
  const final = verified.rows[verified.rows.length - 1];
  if (!final || final.source !== 'MODEL' || final.type !== 'PLANNER_RESPONSE' || final.status !== 'DONE'
      || typeof final.content !== 'string' || !final.content.trim()
      || (Array.isArray(final.tool_calls) && final.tool_calls.length)) fail('the child has no terminal model response');
  return { provenance: verified.provenance, text: final.content, stepIndex: final.step_index,
    type: final.type, source: final.source, status: final.status, tool_calls: [],
    responseSha256: hash(final.content) };
}
function main(argv) {
  const raw = fs.readFileSync(0);
  if (!raw.length || raw.length > 1024 * 1024) fail('hook input size is invalid');
  const payload = JSON.parse(raw.toString('utf8'));
  let result;
  if (argv[0] === '--prepare' && argv.length === 2) result = prepare(payload, { event: argv[1] });
  else if (argv[0] === '--inspect-launch' && argv.length === 1) result = inspectLaunch(payload);
  else if (argv[0] === '--authorize-launch' && argv.length === 1) result = authorizeLaunch(payload);
  else if (argv[0] === '--child-response' && argv.length === 1) result = latestChildResponse(payload);
  else fail('unsupported provenance operation');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'deny', skipMainLifecycle: true, reason: error.message })}\n`);
    process.exitCode = 1;
  }
}
module.exports = { TYPES, validType, SCHEMA, CHILD_SCHEMA, readHostFile, location, transcriptRows, descriptors,
  inspectLaunch, authorizeLaunch, initialParentMessage, spawnedChildren, verifyParentLaunch,
  verifyChild, prepare, latestChildResponse, main };
