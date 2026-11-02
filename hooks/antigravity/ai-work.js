#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const capture = require('../lib/ai-work-capture-v1.js');
const paths = require('./session-paths.js');
const INCOMPLETE = 'Zensu AI work capture incomplete. No acceptance was recorded. Check personal CLI OAuth, capture prerequisites and connection; retry the same goal.';
function options(payload, args = [], env = process.env, resolver) {
  if (Object.hasOwn(payload, 'agent_id') || Object.hasOwn(payload, 'agent_type') || (payload.host_session_id && payload.host_session_id !== payload.session_id)) throw new Error('Only the native main conversation can capture work');
  const id = paths.safeSessionId(payload.session_id);
  const bind = resolver || require('../lib/runtime-hook-session-v1.js').resolveHookSession;
  const binding = bind(payload, env);
  const values = { source: 'antigravity', sourceVersion: require('../../plugin.json').version, workspace: binding.projectRoot,
    session: 'awcv1_' + crypto.createHash('sha256').update('zensu.ai-work.v1\0antigravity\0' + id).digest('hex') };
  for (let i = 0; i < args.length; i += 2) {
    if (!['--task', '--title', '--criteria', '--run-kind', '--cross-product-reason', '--feature', '--feature-revision', '--maintenance-reason'].includes(args[i]) || typeof args[i + 1] !== 'string' || Object.hasOwn(values, args[i].slice(2))) throw new Error('Invalid capture arguments');
    values[args[i].slice(2)] = args[i + 1];
  }
  return values;
}
function run(payload, action, args = [], env = process.env) {
  if (action === 'checkpoint' && args.length) throw new Error('Checkpoint takes no selectors');
  return capture.run(action, options(payload, args, env), 20000);
}
function primer(payload, root) {
  const prefix = paths.helperPrefix(payload.session_id, root);
  return ` AI work capture applies to direct implementation too. For an authorized implementation goal, read ${root}/docs/ai-work-capture.md, then declare it only with a confirmed repository product binding. Obtain explicit human confirmation before zensu ai-work bind --product <id> --confirm; never infer consent from repository names or config. Without a binding skip capture and continue the task. For each goal obtain explicit human confirmation of --feature <uuid>, optionally --feature-revision <uuid>; never infer it from a task key or repository. Product maintenance without a feature requires an explicit per-goal --maintenance-reason. Missing goal scope skips capture without blocking coding. Cross-product work requires explicit human intent and --cross-product-reason for this goal; never use it as a fallback. Declare with ${prefix} --helper ai-work -- begin --task <stable-goal-key> --title <agreed-objective> --criteria <criteria-version-or-digest>. Quote each value; reuse them on retries. Explicit validation/demo/probe tasks must use --run-kind test; normal product work including tests uses --run-kind work. Use the same helper with checkpoint after the final clean commit and include the exact reviewUrl. Startup alone creates no work. Personal CLI OAuth binds the reporting account; no inferred authorship, transcripts or token usage. Stop only retries a declared goal. Only a human can accept or revoke a result in the web application.`;
}
function main(argv) {
  if (argv[0] === 'checkpoint-hook') {
    const raw = fs.readFileSync(0);
    if (raw.length > 1024 * 1024) throw new Error('Oversized input');
    const payload = JSON.parse(raw.toString('utf8'));
    if (Object.hasOwn(payload, 'agent_id') || Object.hasOwn(payload, 'agent_type')) return;
    const result = run(payload, 'checkpoint');
    if (result.status !== 'not_started') process.stdout.write(`Zensu AI work capture: ${JSON.stringify(result)}. Submission is not acceptance.\n`);
    return;
  }
  // Only session-helper supplies this selector after consuming the host's
  // one-use PreToolUse receipt. The command guard refuses direct invocation.
  const result = run({ session_id: process.env.ZENSU_HOST_SESSION_ID }, argv[0], argv.slice(1));
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch {
    process.stderr.write(INCOMPLETE + '\n');
    process.exitCode = process.argv[2] === 'checkpoint-hook' ? 0 : 1;
  }
}
module.exports = { options, run, primer, INCOMPLETE };
