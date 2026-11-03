#!/usr/bin/env node
'use strict';

// Keep advisory composition in one process. The shell engines still execute
// in inventory order; principal verification and bootstrap happen in the shim.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const paths = require('./session-paths.js');
const { render } = require('./render-context.js');
const { verdict } = require('./emit-verdict.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function handlers(inventory, event, tool) {
  const groups = inventory.hooks && inventory.hooks[event];
  if (!Array.isArray(groups) || !groups.length) throw new Error('Missing engine chain inventory');
  const names = [];
  for (const group of groups) {
    if (group.matcher && !(new RegExp(`^(?:${group.matcher})$`)).test(tool)) continue;
    if (!Array.isArray(group.hooks)) throw new Error('Invalid engine chain inventory');
    for (const hook of group.hooks) {
      const match = typeof hook.command === 'string'
        && hook.command.match(/^bash "\$\{ZENSU_PLUGIN_ROOT\}\/hooks\/([A-Za-z0-9._-]+\.sh)"$/);
      if (!match) throw new Error('Invalid engine chain command');
      names.push(match[1]);
    }
  }
  if (!names.length) throw new Error('Empty engine chain inventory');
  return names;
}

function classify(output, script, payload) {
  let kind = 'raw', text = '';
  try {
    const value = JSON.parse(output), hook = value && value.hookSpecificOutput;
    if (hook && ['deny', 'ask', 'force_ask'].includes(hook.permissionDecision)) {
      kind = hook.permissionDecision;
      text = hook.permissionDecisionReason || 'zensu hook requires a decision.';
    } else if (value && value.decision === 'block') {
      kind = 'block'; text = value.reason || 'zensu blocked stopping.';
    } else if (hook && typeof hook.additionalContext === 'string' && hook.additionalContext) {
      kind = 'context'; text = hook.additionalContext;
    }
  } catch { /* Non-JSON hook output has no decision authority. */ }
  if (text) {
    text = String(text);
    text = render(text, script, payload) || text;
  }
  return { kind, text };
}

function appendDiagnostic(file, line) {
  if (!file || file.startsWith('/dev/')) return;
  try {
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) return;
    fs.appendFileSync(file, line + '\n');
  } catch { /* Diagnostics never change the host verdict. */ }
}

function firstThisTurn(data, payload, script, text, failOpen = true) {
  try {
    const sid = paths.safeSessionId(payload.session_id);
    const directory = paths.privateDirectory(data, 'advisory-turns');
    const file = path.join(directory, hash(sid) + '.json');
    const turn = hash(typeof payload.prompt === 'string' ? payload.prompt : '');
    const signature = hash(script + '\0' + text);
    let record = { sessionId: sid, turn, signatures: [] };
    try {
      const previous = paths.readPrivateJson(file, 65536);
      if (previous.sessionId === sid && previous.turn === turn && Array.isArray(previous.signatures)) record = previous;
    } catch { /* An invalid or absent advisory cache cannot suppress context. */ }
    if (record.signatures.includes(signature)) return false;
    record.signatures.push(signature);
    record.signatures = record.signatures.slice(-128);
    paths.writePrivateJson(file, record);
  } catch { return failOpen; /* Reads must not repeat when their de-bounce store is unavailable. */ }
  return true;
}

function pendingContext(data, payload) {
  try {
    if (typeof payload.session_id !== 'string' || !payload.session_id) return '';
    const directory = paths.privateDirectory(data, 'startup-pending');
    const file = path.join(directory, hash(payload.session_id) + '.json');
    const value = paths.readPrivateJson(file, 262144);
    if (value.sessionId !== payload.session_id || typeof value.text !== 'string') return '';
    fs.unlinkSync(file);
    return value.text;
  } catch { return ''; }
}

// Native USER_EXPLICIT transcript rows wrap user text separately from host
// metadata. Unwrap only that verified host envelope, never tags from a generic
// prompt. Feature keys in metadata must not influence automatic selection.
function contextPayload(payload) {
  if (payload.native_payload !== true || typeof payload.prompt !== 'string') return payload;
  const match = /^<USER_REQUEST>\r?\n([\s\S]*?)\r?\n<\/USER_REQUEST>([\s\S]*)$/.exec(payload.prompt);
  if (!match || /<\/?USER_REQUEST>/.test(match[1])) return payload;
  let rest = match[2].trim();
  while (rest) {
    const metadata = /^<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>\r?\n[\s\S]*?\r?\n<\/\1>/.exec(rest);
    if (!metadata) return payload;
    rest = rest.slice(metadata[0].length).trim();
  }
  return { ...payload, prompt: match[1] };
}

function run(payload, options = {}) {
  const root = options.root || paths.pluginRoot();
  const environment = options.environment || process.env;
  const data = environment.ZENSU_PLUGIN_DATA;
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'hooks/inventory.json'), 'utf8'));
  const normal = handlers(inventory, 'UserPromptSubmit', payload.tool_name || '');
  let startup = [];
  if (options.created) {
    try { startup = handlers(inventory, 'SessionStart', payload.tool_name || ''); }
    catch { /* Match the transport's optional startup inventory behavior. */ }
  }
  const contexts = [];
  const pending = pendingContext(data, payload);
  if (pending) contexts.push(pending);
  if (options.bootContext && firstThisTurn(data, payload, 'session-bootstrap.js', options.bootContext)) {
    contexts.push(options.bootContext);
  }
  let finalKind = '', finalText = '';
  const execute = options.execute || spawnSync;
  for (const [index, name] of [...startup, ...normal].entries()) {
    const isStartup = index < startup.length;
    // PreInvocation fires before every model step. Claim the automatic read
    // before executing it, so repeated steps do not create new retrievals.
    // Reuse the native adapter's per-session/per-prompt advisory store.
    if (name === 'user-prompt-context-auto-load.sh'
      && !firstThisTurn(data, payload, 'context-auto-load-attempt', 'attempted', false)) continue;
    const file = path.join(root, 'hooks', name);
    let exists = false;
    try { exists = fs.statSync(file).isFile(); } catch { /* A missing or unreadable script is not executed. */ }
    if (!exists) {
      appendDiagnostic(environment.ZENSU_SHIM_TRACE, `PreInvocation ${name} bail-missing-script`);
      continue;
    }
    appendDiagnostic(environment.ZENSU_SHIM_TRACE, `PreInvocation ${name} ran`);
    const input = isStartup ? { ...payload, hook_event_name: 'SessionStart', source: 'startup' }
      : name === 'user-prompt-context-auto-load.sh' ? contextPayload(payload) : payload;
    const result = execute('bash', [file], {
      input: JSON.stringify(input), encoding: 'utf8', env: name === 'user-prompt-context-auto-load.sh'
        ? { ...environment, ZENSU_CONTEXT_AGENT: 'antigravity' } : environment,
      cwd: isStartup && environment.ZENSU_PROJECT_DIR ? environment.ZENSU_PROJECT_DIR : undefined,
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = (result.stdout || '').replace(/\n+$/, '');
    let { kind, text } = classify(output, name, payload);
    if (isStartup && name === 'session-start-pulse.sh' && result.status === 0 && output) {
      kind = 'context'; text = output;
    }
    const toolInput = payload.tool_input || {};
    const content = typeof toolInput.content === 'string' ? toolInput.content
      : typeof toolInput.new_string === 'string' ? toolInput.new_string : '';
    appendDiagnostic(environment.ZENSU_SHIM_DECISIONS, JSON.stringify({
      event: 'PreInvocation', script: name, decision: kind,
      sessionId: String(payload.host_session_id || payload.session_id || ''),
      parentSessionId: payload.agent_id ? String(payload.session_id || '') : undefined,
      agentId: payload.agent_id, agentType: payload.agent_type,
      terminationReason: payload.termination_reason, fullyIdle: payload.fully_idle,
      tool: String(payload.tool_name || ''), target: String(toolInput.file_path || toolInput.notebook_path || ''),
      commandDigest: hash(String(toolInput.command || '')), contentDigest: hash(content),
    }));
    if (kind === 'deny' || kind === 'block') { finalKind = kind; finalText = text; break; }
    if (kind === 'force_ask' || (kind === 'ask' && finalKind !== 'force_ask')) {
      finalKind = kind; finalText = text;
    } else if (kind === 'context') {
      if (firstThisTurn(data, payload, name, text)) contexts.push(text);
    } else if (kind === 'raw' && result.stderr) {
      (options.stderr || process.stderr).write(result.stderr);
    }
    if (result.error) throw result.error;
  }
  return finalKind ? verdict('PreInvocation', finalKind, finalText)
    : verdict('PreInvocation', contexts.length ? 'context' : '', contexts.join('\n\n'));
}

function main() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    const output = run(payload, {
      created: process.env.ZV_BOOT_CREATED === 'true',
      bootContext: process.env.ZV_BOOT_CONTEXT || '',
    });
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch (error) {
    process.stderr.write(`zensu: invocation chain could not complete: ${error.message}\n`);
    process.stdout.write('{}\n');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { handlers, classify, firstThisTurn, pendingContext, contextPayload, run };
