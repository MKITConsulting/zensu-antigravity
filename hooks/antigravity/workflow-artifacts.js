#!/usr/bin/env node
'use strict';
const binder = require('../lib/runtime-hook-session-v1.js');
const artifacts = require('../lib/workflow-artifacts-v1.js');
const paths = require('./session-paths.js');
function parse(argv) {
  const [verb, ...rest] = argv, args = {};
  if (!['start', 'sync', 'report'].includes(verb)) throw Error('use start, sync or report');
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--log', '--claimed-review-ticket'].includes(rest[i]) || !rest[i + 1] || Object.hasOwn(args, rest[i])) throw Error('invalid or duplicate workflow-artifact argument');
    args[rest[i]] = rest[i + 1];
  }
  if ((verb === 'start' && (!args['--log'] || args['--claimed-review-ticket']))
      || (verb !== 'start' && args['--log']) || (verb === 'sync' && args['--claimed-review-ticket'])) throw Error('arguments do not match the workflow-artifact operation');
  return { verb, args };
}
function main(argv, env = process.env) {
  const { verb, args } = parse(argv);
  const parentId = paths.safeSessionId(env.ZENSU_HOST_SESSION_ID);
  // This resolver proves the immutable principal/project/runtime binding. The outer
  // session helper separately requires the actual host's one-use authorization.
  const binding = binder.resolveHookSession({ session_id: parentId }, env);
  const options = { projectRoot: binding.projectRoot, sessionId: binding.sessionKey };
  if (verb === 'start') return artifacts.start(options, args['--log']);
  if (verb === 'sync') return { plan: artifacts.syncProgress(options) };
  return artifacts.report(options, args['--claimed-review-ticket']);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write('workflow-artifacts: ' + error.message + '\n'); process.exitCode = 2; }
}
module.exports = { parse, main };
