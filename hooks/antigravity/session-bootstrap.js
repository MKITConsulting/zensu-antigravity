#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./session-paths.js');
const core = require('../lib/session-control-core-v1.js');

function bootstrap(payload, options = {}) {
  if (payload.agent_id !== undefined || payload.agent_type !== undefined
      || (payload.host_session_id && payload.host_session_id !== payload.session_id)) {
    throw new Error('A native child cannot create or reset a main workflow baseline');
  }
  const root = options.pluginRoot || paths.pluginRoot();
  const data = options.pluginData || paths.dataRoot();
  const sessionId = paths.safeSessionId(payload.session_id);
  const recordsDir = paths.privateDirectory(data, 'session-control', 'v1', 'records');
  const locks = paths.privateDirectory(data, 'session-control', 'v1', 'locks');
  const key = core.sessionKey(sessionId);
  return core.withFileLock(locks, `bootstrap-${key}`, () => {
    const file = path.join(recordsDir, `${key}.json`);
    let existing;
    try { existing = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      const requested = payload.workspace_root;
      if (typeof requested !== 'string' || !path.isAbsolute(requested)) {
        throw new Error('The host payload has no absolute workspace root');
      }
      const projectRoot = fs.realpathSync.native(requested);
      const context = core.registerContext({ recordsDir, host: 'native', sessionId,
        projectRoot, pluginRoot: root, pluginData: data });
      core.initializeWorkflowState({ projectRoot: context.project_root, sessionId });
      return { created: true, context };
    }
    // A repeated model invocation is not SessionStart. In particular, never
    // recreate a missing workflow document here: that would erase an armed chain.
    const binder = options.binder || require('../lib/runtime-hook-session-v1.js');
    const binding = binder.resolveHookSession(payload, {
      ...process.env, ZENSU_PLUGIN_ROOT: root, ZENSU_PLUGIN_DATA: data,
    }, { autoAdopt: true });
    core.readWorkflowState({ projectRoot: binding.projectRoot, sessionId });
    return { created: false, context: binding.context, adoption: binding.adoption };
  });
}

function advisory(payload, result, root = paths.pluginRoot()) {
  const prefix = paths.helperPrefix(payload.session_id, root);
  return `Zensu Session Control is bound to this Antigravity conversation. `
    + `Verified placeholders: {plugin_root} = ${JSON.stringify(root)}; {project_root} = ${JSON.stringify(result.context.project_root)}; {conversation_id} = ${JSON.stringify(payload.session_id)}. `
    + `Resolve {session-helper} to this exact command prefix: ${prefix}. `
    + `Append --helper <name> [--stdin-file <absolute input file>] -- <arguments>. Run it as a standalone shell command; `
    + `capture the tool's stdout without shell substitutions or redirections. `
    + `Supported helper names: ${Object.keys(require('./session-helper.js').HELPERS).join(', ')}. `
    + `Do not export session selectors or invoke state helpers directly. `
    + `Native review agents require an accepted session-bound dispatch and a verified child completion receipt.`
    + (result.created ? ' This session has a fresh inactive workflow baseline.' : ' The existing workflow baseline is preserved.');
}

function recoveryInvocation(payload) {
  if (!payload || Object.prototype.hasOwnProperty.call(payload, 'agent_id')
      || Object.prototype.hasOwnProperty.call(payload, 'agent_type')) return false;
  try {
    const guard = require('./session-command-guard.js');
    const inspected = guard.inspectCommand(payload);
    if (inspected.kind !== 'helper' || !['doctor', 'session-adopt'].includes(inspected.request.helper)) return false;
    return require('../lib/zensu-doctor-invocation.js').isRecognizedInvocation(guard.gatePayload(payload));
  } catch { return false; }
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--data-root') {
    process.stdout.write(`${paths.dataRoot()}\n`);
    return;
  }
  if (argv.length !== 2 || argv[0] !== '--event') throw new Error('Expected --event <hook event>');
  const event = argv[1];
  if (!['PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop'].includes(event)) {
    throw new Error('Unsupported hook event');
  }
  let payload;
  try {
    const raw = fs.readFileSync(0);
    if (!raw.length || raw.length > 1024 * 1024) throw new Error('Hook payload size is invalid');
    payload = JSON.parse(raw.toString('utf8'));
    const result = bootstrap(payload);
    const output = event === 'PreInvocation'
      ? { hookSpecificOutput: { additionalContext: advisory(payload, result) } } : {};
    // Private shim transport metadata. It is produced from the protected record
    // operation above, never copied from anything the model supplies.
    output.zensuBootstrap = { created: result.created };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const reason = `Zensu Session Control could not bind this conversation: ${error.message}. `
      + 'Run the session-bound doctor helper for the diagnosis; no workflow state was reset.';
    const output = event === 'PreToolUse' && recoveryInvocation(payload) ? {}
      : event === 'PreToolUse'
      ? { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason } }
      : event === 'Stop' ? {}
        : { hookSpecificOutput: { additionalContext: reason } };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = 1;
  }
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  }
}
module.exports = { bootstrap, advisory, recoveryInvocation, main };
