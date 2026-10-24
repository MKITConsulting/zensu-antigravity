#!/usr/bin/env node
'use strict';

// Adapt instructions as well as JSON dialects. Hook processes cannot export
// environment variables into later model tool calls.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const helpers = {
  'zensu-log.sh': 'log', 'zensu-doctor.sh': 'doctor',
  'zensu-work-order.sh': 'work-order', 'zensu-session-adopt.sh': 'session-adopt',
  'zensu-session-reanchor.sh': 'session-reanchor', 'zensu-review-evidence.sh': 'review-evidence',
  'zensu-tdd-mode.sh': 'tdd-mode', 'zensu-delivery-route.sh': 'delivery-route',
  'zensu-zen-mode.sh': 'zen-mode', 'zensu-full-suite.sh': 'full-suite',
  'zensu-edit-landing.sh': 'edit-landing', 'review-ledger-v1.js': 'review-ledger',
};
function command(session, helper) {
  return `bash ${quote(path.join(root, 'hooks/antigravity/session-helper.sh'))} --session ${quote(session)} --helper ${helper} --`;
}
function render(text, script, payload = {}) {
  const session = payload.session_id;
  if (typeof text !== 'string' || !text) return '';
  if (typeof session !== 'string' || !session || /[\0\r\n]/.test(session)) return text;
  let out = text.replaceAll('/zensu-zensu-help', '/zensu-help');
  if (script === 'session-start-banner.sh') {
    out = out.replace(/^zensu- Reviewer spawns —.*$/gm,
      'zensu- Review execution — registered native reviewers run in distinct child conversations with verified parent/child provenance and normal-Stop receipts. Plan/PR evidence leases enforce exact read scope; implementation and final routing stay in the main conversation.');
  }
  if (script === 'session-start-primer.sh') {
    out = out.replaceAll('the plan-approval hook directs you to ASK', 'ASK');
    out = out.replace('This is a one-time per-session orientation; the plan-approval hook gives the authoritative directive at approval time.',
      'This is a one-time per-conversation orientation. There is no native plan-approval event; retain an explicit route choice across the conversation and apply it when acting on an approved plan.');
  }
  for (const [file, helper] of Object.entries(helpers)) {
    const name = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The upstream renderer uses printf %q, whose simple-path spelling is bare.
    // Quoted paths are accepted too; no shell command here is executed.
    const token = `(?:'(?:[^']|'\\\\'')*'|"[^"\\n]*"|(?:\\\\.|[^\\s])+?)`;
    const scriptPath = `(?:"[^"\\n]*/hooks/lib/${name}"|'[^'\\n]*/hooks/lib/${name}'|(?:\\\\.|[^\\s"'])+/hooks/lib/${name})`;
    const runtime = file.endsWith('.js') ? 'node' : 'bash';
    const pattern = new RegExp(`(?:ZENSU_PLUGIN_DATA=${token}\\s+)?${runtime}\\s+${scriptPath}(?=\\s|$)`, 'g');
    out = out.replace(pattern, command(session, helper));
  }
  out = out.replace(/--helper log -- append --log \{log_file\} --message-stdin fed by a heredoc whose delimiter is quoted, so no finding text is ever shell-expanded, and never through --message/g,
    "--helper log --stdin-file '<absolute-input-file>' -- append --log {log_file} --message-stdin. Write the exact finding text to that bounded UTF-8 file first; never use shell heredocs, redirection, substitutions or --message");
  out = out.replace(/the Skill tool with skill='zensu-([a-z-]+)'/g, 'load and follow the bundled /zensu-$1 skill in this thread');
  out = out.replace(/AskUserQuestion tool/g, 'available user-question interface (or ask in conversation when none exists)');
  if (script === 'stop-chain-enforcer.sh' && out.includes('A main-thread TDD session finished implementation')) {
    return `The implementation-complete review chain is still open. Continue /zensu-tdd at its native delegated review phase. `
      + `Read the bundled skills/tdd/references/review-chain.md and native-reviewers.md completely. Preserve every configured judge, finding-verification, reproduction, convergence and evidence check. `
      + `Issue a fresh ticket with ${command(session, 'log')} --review-ticket, then call ${command(session, 'review')} --begin --ticket <ticket>. `
      + `Dispatch each returned required role through its own real invoke_subagent call with flat TypeName, Role, Workspace: inherit, Model: inherit and complete Prompt arguments. Use each returned PromptPrefix verbatim and record actual child UUIDs. `
      + `Wait for normal completion, keep raw child findings immutable and submit the returned reportTemplate with actual childId values using ${command(session, 'review')} --ticket <ticket> --report <absolute-report.json>. `
      + `Verification and convergence belong in a separate merged report and ledger; route from them, never from unclassified raw child findings. Any source edit, including a reproduction test, requires a fresh ticket and required-role re-review of the final tree. `
      + `Follow the returned directive. Terminal /zensu-self-review owns --chain-done and its current-tree full-suite/acceptance checks. Never fabricate child metadata or close an unreviewed chain.`;
  }
  if (script === 'post-review-tdd-delegate.sh') {
    out = out.replace(/The zensu-code-reviewer subagent above just finished/g, 'The native child-backed review report was validated and its one-shot ticket was consumed');
    out = out.replace(/Your NEXT action must be the Agent tool[\s\S]*?Do NOT reuse a prior ticket\./g,
      `Read the native reviewer reference, call ${command(session, 'review')} --begin --ticket <ticket>, dispatch the exact returned assignments through invoke_subagent, collect actual normal child completions, preserve raw results and submit ${command(session, 'review')} --ticket <ticket> --report <absolute-report.json>. Use the separately verified merged report/ledger for routing; source edits require a fresh ticket and re-review. Never reuse a consumed ticket.`);
    out = out.replace(/re-fan-out the zensu-review-aspect agents/g, 'repeat the configured native reviewer batch');
    out = out.replace(/re-run the zensu-review-judge second pass/g, 'repeat the native adversarial judge child');
    out = out.replace(/the prior zensu-code-reviewer Agent results/g, 'the prior validated native child-backed review reports');
    out = out.replace(/Do NOT spawn a tdd subagent — TDD now runs in this main thread\./g, 'Keep implementation and synthesis in this thread; native reviewer children are read-only.');
  }
  return out;
}
module.exports = { render, command };
if (require.main === module) {
  try { const input = JSON.parse(fs.readFileSync(0, 'utf8')); process.stdout.write(render(input.text, input.script, input.payload)); }
  catch { process.exitCode = 2; }
}
