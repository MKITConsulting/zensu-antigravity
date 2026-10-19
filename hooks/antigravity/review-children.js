#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const paths = require('./session-paths.js');
const binder = require('../lib/runtime-hook-session-v1.js');
const evidence = require('../lib/evidence-run-v1.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function parse(argv) {
  if (argv[0] !== 'collect') throw Error('use collect --child-id UUID --type TYPE [--role ROLE]');
  const args = {};
  for (let i=1;i<argv.length;i+=2) {
    if (!['--child-id','--type','--role'].includes(argv[i]) || !argv[i+1] || Object.hasOwn(args,argv[i])) throw Error('invalid or duplicate collector argument');
    args[argv[i]]=argv[i+1];
  }
  if (!args['--child-id'] || !['zensu-plm','zensu-gauntlet-critic','zensu-review-aspect','zensu-review-judge','zensu-code-reviewer'].includes(args['--type'])) throw Error('a child id and supported read-only type are required');
  paths.safeSessionId(args['--child-id']);
  return args;
}
function collect(argv, env = process.env, options = {}) {
  const args = parse(argv), parentId = paths.safeSessionId(env.ZENSU_HOST_SESSION_ID);
  if (args['--child-id'] === parentId) throw Error('parent cannot count as an independent child');
  const binding = options.binding || binder.resolveHookSession({session_id:parentId},env);
  const readChild = options.completedChild || require('./native-agent-lifecycle.js').completedChild;
  const receipt = readChild(parentId,args['--child-id'],{pluginData:binding.pluginData});
  if (!receipt || receipt.parentId!==parentId || receipt.childId!==args['--child-id']
      || receipt.runtimeDigest!==binding.context.runtime_digest || receipt.descriptor?.typeName!==args['--type']
      || (args['--role'] && receipt.descriptor.role!==args['--role'])
      || typeof receipt.finalText!=='string' || receipt.finalHash!==hash(receipt.finalText)) throw Error('completion does not match this parent, runtime, role and type');
  const scratch = options.scratchDirectory || paths.privateDirectory(binding.pluginData,'native-child-collect');
  const tree = options.computeTree ? options.computeTree(binding.projectRoot,scratch) : evidence.computeTree(binding.projectRoot,scratch);
  if (receipt.sourceTree !== null && (!tree.tree || receipt.sourceTree!==tree.tree)) throw Error('source changed since this child was launched');
  let report;
  try { report=JSON.parse(receipt.finalText); } catch { throw Error('child final response is not a complete JSON report'); }
  if (!report || typeof report!=='object' || Array.isArray(report)) throw Error('child report must be a JSON object');
  return {execution:'delegated',parentId,childId:receipt.childId,type:receipt.descriptor.typeName,role:receipt.descriptor.role,
    finalHash:receipt.finalHash,sourceTree:receipt.sourceTree,sourceVerification:receipt.sourceTree===null?'artifact-snapshot-required':'current-tree',report};
}
if(require.main===module) {
  try { process.stdout.write(JSON.stringify(collect(process.argv.slice(2)),null,2)+'\n'); }
  catch(error) { process.stderr.write('review-children: '+error.message+'\n');process.exitCode=2; }
}
module.exports={parse,collect};
