#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./session-paths.js');
const helpers = require('./session-helper.js');

// These modules write or authorize protected workflow state. Read-only format,
// diff, finding and activation utilities remain callable without a binding.
// Native state writers must also be recognized by basename: run_command can
// select the adapter directory as Cwd, and Node accepts extensionless imports.
const NATIVE_STATE_MODULES = [
  'antigravity-shim', 'autopilot-review', 'lazy-init', 'native-agent-lifecycle',
  'native-agent-provenance', 'native-review', 'native-spawn-allow', 'normalize-payload',
  'review-artifacts', 'review-children', 'session-bootstrap', 'session-command-guard',
  'session-helper', 'session-paths', 'session-trail', 'worker-launch', 'worker-runtime',
];
const STATE_MODULES = [
  ...NATIVE_STATE_MODULES,
  'acceptance-verify-v1', 'chain-recovery-v1', 'edit-landing-receipt-v1', 'evidence-run-v1',
  'external-review-v1', 'full-suite-policy-v1', 'in-thread-review', 'in-thread-review-v1',
  'plugin-data-guard-v1', 'post-review-tdd-delegate', 'review-evidence-hook-v1', 'review-evidence-lease-v1',
  'review-evidence-sweep-v1', 'review-ledger-v1', 'runtime-hook-session-v1',
  'runtime-session-control-v1', 'session-adopt-report-v1', 'session-auto-adopt-v1',
  'session-control-core-v1', 'session-reanchor-v1', 'verify-consent-v1',
  'work-order-v1', 'worktree-keep-v1', 'zen-anchor-v1',
  'zensu-autopilot-state', 'zensu-bypass-ledger', 'zensu-delivery-route',
  'zensu-doctor', 'zensu-doctor-report', 'zensu-edit-landing', 'zensu-full-suite',
  'zensu-full-suite-transport', 'zensu-log', 'zensu-marker-write', 'zensu-overlay',
  'zensu-prompt-ledger', 'zensu-review-evidence', 'zensu-session', 'zensu-session-adopt',
  'zensu-session-reanchor', 'zensu-tdd-mode', 'zensu-tdd-phase', 'zensu-work-order',
  'zensu-work-order-hook', 'zensu-worktree-keep', 'zensu-zen-mode', 'zensu-zen-shared',
];
// Node resolves extensionless require/import targets. Protect the module stem
// at a token boundary as well as its explicit script filename.
const STATE_MODULE_PATTERN = new RegExp(`(?:^|[^A-Za-z0-9_.-])(?:${STATE_MODULES.join('|')})(?:\\.(?:js|mjs|sh))?(?=$|[^A-Za-z0-9_.-])`);
function protectedText(command) {
  return STATE_MODULE_PATTERN.test(command)
    || /hooks\/antigravity\/[A-Za-z0-9_-]+(?:\.(?:js|sh))?(?=$|[^A-Za-z0-9_.-])|ZENSU_(?:HOST_SESSION_ID|SESSION_KEY|SESSION_CONTEXT|RUNTIME_DIGEST|PROJECT_ROOT|RUNTIME_PLUGIN_ROOT|PLUGIN_DATA)|antigravity\/plugin-data/.test(command);
}


// Detect protected paths across literal quote/escape spelling as well. This is
// a conservative detection view, never an executed command or an authorization
// parser: acceptance still requires literalWords and the exact bound wrapper.
// Fold before parsing so redirects cannot hide an obfuscated state helper.
function protectedResolvedPath(command, options) {
  const root = path.resolve(options.pluginRoot || paths.pluginRoot());
  const cwd = typeof options.cwd === 'string' && path.isAbsolute(options.cwd) ? options.cwd : process.cwd();
  const roots = new Set([root]);
  try { roots.add(fs.realpathSync.native(root)); } catch { /* lexical matching remains available */ }
  const candidates = command.match(/[A-Za-z0-9_./:@%+-]+/g) || [];
  // Retain a quoted path containing spaces for the simple literal-argv case.
  try { candidates.push(...literalWords(command)); } catch { /* detection also handles compound commands */ }
  for (const candidate of candidates) {
    if (!candidate || !/[A-Za-z]/.test(candidate)) continue;
    const absolute = path.resolve(cwd, candidate);
    for (const suffix of ['', '.js', '.mjs', '.sh']) {
      const file = absolute + suffix;
      const resolved = new Set([file]);
      try { resolved.add(fs.realpathSync.native(file)); } catch { /* an extensionless spelling may resolve below */ }
      for (const plugin of roots) for (const target of resolved) {
        const relative = path.relative(plugin, target).split(path.sep).join('/');
        if (/^hooks\/antigravity\/[A-Za-z0-9_-]+\.(?:js|mjs|sh)$/.test(relative)
            || relative === 'harness/launcher.js') return true;
      }
    }
  }
  return false;
}
function mentionsProtectedExecution(command, options = {}) {
  const folded = command.replace(/\\\r?\n/g, '').replace(/['"][ \t]*\+[ \t]*['"]/g, '').replace(/['"\\]/g, '');
  return protectedText(command) || protectedText(folded)
    || protectedResolvedPath(command, options) || protectedResolvedPath(folded, options);
}

// Deliberately a small literal-argv grammar, not an attempted shell evaluator.
// Unsupported shell syntax around a session helper is denied with a pastable
// command. Ordinary commands do not go through this parser at all.
function literalWords(command) {
  const words = [];
  let word = '', quote = '', present = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = ''; else word += char;
      present = true; continue;
    }
    if (quote === '"') {
      if (char === '"') { quote = ''; continue; }
      if (char === '$' || char === '`' || char === '\n' || char === '\r') throw new Error('Shell expansion is not supported around session helpers');
      if (char === '\\') {
        const next = command[++index];
        if (next === undefined) throw new Error('Incomplete shell escape');
        word += ['"', '\\', '$', '`'].includes(next) ? next : `\\${next}`;
      } else word += char;
      present = true; continue;
    }
    if (char === "'" || char === '"') { quote = char; present = true; continue; }
    if (char === '\\') {
      const next = command[++index];
      if (next === undefined || next === '\n' || next === '\r') throw new Error('Incomplete shell escape');
      word += next; present = true; continue;
    }
    if (/[ \t]/.test(char)) {
      if (present) { words.push(word); word = ''; present = false; }
      continue;
    }
    if (/[\n\r;&|<>`$(){}*?\[\]~#]/.test(char)) throw new Error('Use a standalone literal session-helper command');
    word += char; present = true;
  }
  if (quote) throw new Error('Unterminated shell quote');
  if (present) words.push(word);
  return words;
}

function inspectCommand(payload, options = {}) {
  if (payload.tool_name !== 'Bash') return { kind: 'ordinary' };
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string') return { kind: 'ordinary' };
  const root = options.pluginRoot || paths.pluginRoot();
  const detection = { pluginRoot: root, cwd: payload.cwd || payload.workspace_root };
  if (!mentionsProtectedExecution(command, detection)) return { kind: 'ordinary' };
  try {
    const words = literalWords(command);
    if (!['bash', '/bin/bash', '/usr/bin/bash'].includes(words[0])
        || words[1] !== path.join(root, 'hooks/antigravity/session-helper.sh')) {
      throw new Error('State helpers must use the exact session-helper wrapper');
    }
    const request = helpers.parseArguments(words.slice(2));
    if (request.sessionId !== paths.safeSessionId(payload.session_id)) {
      throw new Error('The requested helper session does not match this host conversation');
    }
    for (let index = 0; index < request.args.length; index += 1) {
      if (['--cmd', '--command'].includes(request.args[index])
          && mentionsProtectedExecution(request.args[index + 1] || '', detection)) {
        throw new Error('A nested command may not invoke protected session modules or supply session selectors');
      }
    }
    return { kind: 'helper', request };
  } catch (error) {
    return { kind: 'deny', reason: error.message };
  }
}
function guard(payload, options = {}) {
  const result = inspectCommand(payload, options);
  if (result.kind === 'helper') {
    try { helpers.authorize(result.request, options); } catch (error) {
      return { kind: 'deny', reason: `Could not authorize the session-bound helper: ${error.message}` };
    }
  }
  return result;
}
function gatePayload(payload, options = {}) {
  const result = inspectCommand(payload, options);
  if (result.kind === 'deny') throw new Error(result.reason);
  if (result.kind !== 'helper') return payload;
  const root = options.pluginRoot || paths.pluginRoot();
  const data = options.pluginData || paths.dataRoot();
  // The native doctor decorates the canonical diagnosis. Preserve the exact
  // neutral recovery recognizer while executing the authorized adapter command.
  const [runtime, relative] = result.request.helper === 'doctor'
    ? ['bash', 'hooks/lib/zensu-doctor.sh'] : helpers.HELPERS[result.request.helper];
  const policyQuote = (value) => /^[A-Za-z0-9 _./:=+@,-]+$/.test(value) ? JSON.stringify(value) : paths.shellQuote(value);
  const command = `ZENSU_PLUGIN_DATA=${policyQuote(data)} ${runtime} `
    + [path.join(root, relative), ...result.request.args].map(policyQuote).join(' ');
  // Only the input seen by neutral policy scripts changes. The actual host
  // command and its decision-witness digest retain the original wrapper call.
  return { ...payload, tool_input: { ...payload.tool_input, command } };
}
function main() {
  const raw = fs.readFileSync(0);
  if (!raw.length || raw.length > 1024 * 1024) throw new Error('Invalid hook payload size');
  const payload = JSON.parse(raw.toString('utf8'));
  if (process.argv[2] === '--gate-payload' && process.argv.length === 3) {
    process.stdout.write(`${JSON.stringify(gatePayload(payload))}\n`);
    return;
  }
  const mode = process.argv[2] || '--inspect';
  if (!['--inspect', '--authorize'].includes(mode) || process.argv.length > 3) throw new Error('Unsupported command guard mode');
  // Inspection is side-effect free. Only the shim's final allow path may mint
  // a one-use receipt, after every engine gate has accepted this exact command.
  const result = mode === '--authorize' ? guard(payload) : inspectCommand(payload);
  if (result.kind !== 'deny') { process.stdout.write('{}\n'); return; }
  let command = 'the session-helper command supplied by the bootstrap context';
  try { command = `${paths.helperPrefix(payload.session_id)} --helper <name> -- <arguments>`; } catch { /* keep generic remedy */ }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny',
    permissionDecisionReason: `${result.reason}. Use ${command} as one standalone shell command.` } })}\n`);
}
if (require.main === module) {
  try { main(); } catch (error) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny',
      permissionDecisionReason: `Session helper correlation failed: ${error.message}` } })}\n`);
    process.exitCode = 1;
  }
}
module.exports = { NATIVE_STATE_MODULES, STATE_MODULES, mentionsProtectedExecution, literalWords, inspectCommand, guard, gatePayload, main };
