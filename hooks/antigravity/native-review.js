#!/usr/bin/env node
'use strict';

// Native child identities and Stop receipts are interpreted only in this adapter.
const crypto = require('node:crypto');
const review = require('../lib/in-thread-review-v1.js');
const packet = require('./native-review-packet.js');
const paths = require('./session-paths.js');
const childSchema = 'zensu-delegated-perspective-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const assignmentPrefix = (ticket, tree, role) => `${role === 'consume' ? 'PRE-MERGED FINDINGS (fan-out)\n' : ''}REVIEW-TICKET: ${ticket}\nREVIEW-TREE: ${tree}\nREVIEW-ROLE: ${role}\n`;
const fail = message => { throw new Error(`native-review: ${message}`); };

function verifyReport(report, lease, binding, options = {}) {
  (options.validatePacket || packet.validatePacket)(lease, binding, options);
  const parentId = paths.safeSessionId(options.parentId || process.env.ZENSU_HOST_SESSION_ID);
  const readChild = options.completedChild || require('./native-agent-lifecycle.js').completedChild;
  const children = [], seen = new Set();
  for (const perspective of report.perspectives) {
    const childId = perspective.childId;
    if (typeof childId !== 'string' || childId === parentId || seen.has(childId)) fail('each perspective requires a distinct real child');
    paths.safeSessionId(childId);
    const receipt = readChild(parentId, childId, { pluginData: binding.pluginData });
    if (!receipt || receipt.parentId !== parentId || receipt.childId !== childId
        || receipt.runtimeDigest !== binding.context.runtime_digest || receipt.sourceTree !== lease.tree
        || receipt.descriptor?.typeName !== 'zensu-review-aspect' || receipt.descriptor.role !== perspective.role
        || typeof receipt.descriptor.prompt !== 'string'
        || !receipt.descriptor.prompt.startsWith(assignmentPrefix(lease.ticket, lease.tree, perspective.role))
        || !receipt.descriptor.prompt.includes('REVIEW PACKET v1')
        || typeof receipt.finalText !== 'string' || hash(receipt.finalText) !== receipt.finalHash) {
      fail('child completion does not match this parent, runtime, role or source tree');
    }
    packet.assertPrompt(receipt.descriptor.prompt, lease);
    let child;
    try { child = JSON.parse(receipt.finalText); } catch { fail('child final response must be a complete JSON report'); }
    if (child.schema !== childSchema || child.ticket !== lease.ticket || child.tree !== lease.tree
        || child.role !== perspective.role || child.summary !== perspective.summary
        || JSON.stringify(child.findings) !== JSON.stringify(perspective.findings)) {
      fail('perspective differs from the independently completed child report');
    }
    seen.add(childId);
    children.push({ id: childId, role: perspective.role, finalHash: receipt.finalHash });
  }
  const judges = [];
  if (!Array.isArray(report.judges) || report.judges.length > 2) fail('judge completion identities are required');
  for (const judge of report.judges) {
    if (!judge || !['judge', 'judge-b'].includes(judge.role) || seen.has(judge.childId) || judges.some(item => item.role === judge.role)) fail('judge completion was reused or malformed');
    judges.push(validateJudge(judge.childId, judge.role, lease, binding, options)); seen.add(judge.childId);
  }
  if (lease.primaryRequired && !judges.some(item => item.role === 'judge')) fail('required primary judge has not completed; second-judge output cannot substitute');
  if (!report.consumer || seen.has(report.consumer.childId)) fail('distinct completed consume reviewer is required');
  const consumer = validateConsumer(report.consumer.childId, lease, binding, options);
  return { execution: 'delegated', reportHash: hash(JSON.stringify(report)), packetHash: lease.packetHash, children, judges, consumer };
}

function stageChild(childId, type, role, lease, binding, options = {}) {
  const parentId = paths.safeSessionId(options.parentId || process.env.ZENSU_HOST_SESSION_ID);
  paths.safeSessionId(childId);
  if (childId === parentId) fail('parent cannot count as an independent reviewer');
  const receipt = (options.completedChild || require('./native-agent-lifecycle.js').completedChild)(parentId, childId, { pluginData: binding.pluginData });
  if (!receipt || receipt.parentId !== parentId || receipt.childId !== childId
      || receipt.runtimeDigest !== binding.context.runtime_digest || receipt.sourceTree !== lease.tree
      || receipt.descriptor?.typeName !== type || receipt.descriptor.role !== role
      || typeof receipt.descriptor.prompt !== 'string' || !receipt.descriptor.prompt.startsWith(assignmentPrefix(lease.ticket, lease.tree, role))
      || typeof receipt.finalText !== 'string' || hash(receipt.finalText) !== receipt.finalHash) fail('stage completion does not match this parent, runtime, role or source tree');
  packet.assertPrompt(receipt.descriptor.prompt, lease);
  let result;
  try { result = JSON.parse(receipt.finalText); } catch { fail('stage child final response must be complete JSON'); }
  return { receipt, result };
}
function validateJudge(childId, role, lease, binding, options = {}) {
  const { receipt, result } = stageChild(childId, 'zensu-review-judge', role, lease, binding, options);
  if (result.schema !== 'zensu-review-judge-result-v1' || result.role !== role || typeof result.report !== 'string'
      || (role === 'judge' ? !require('../lib/review-packet-v1.js').validatePrimaryResult(result.report)
        : !/^## Aspect: judge \(second run\)\s*$/m.test(result.report) || result.report.includes('REVIEW PACKET INVALID'))) {
    fail('primary judge must supply substantive completed output; an additive second judge cannot substitute');
  }
  return { id: childId, role, finalHash: receipt.finalHash };
}
function validateConsumer(childId, lease, binding, options = {}) {
  const { receipt, result } = stageChild(childId, 'zensu-code-reviewer', 'consume', lease, binding, options);
  if (result.schema !== 'zensu-code-review-result-v1' || typeof result.report !== 'string'
      || !/^# Code Review Report\s*$/m.test(result.report)
      || !/^- Verdict: (PASS|PASS WITH SUGGESTIONS|NEEDS CHANGES)\s*$/m.test(result.report)
      || result.report.includes('REVIEW PACKET INVALID')) fail('consume reviewer must supply a substantive completed report');
  return { id: childId, role: 'consume', finalHash: receipt.finalHash };
}

function enrichLease(result) {
  if (!result.reportTemplate) return result;
  for (const perspective of result.reportTemplate.perspectives) perspective.childId = '';
  result.reportTemplate.judges = [];
  result.reportTemplate.consumer = { childId: '' };
  result.childSchema = childSchema;
  result.packetBlock = packet.block(result.packet);
  result.assignments = result.roles.map(role => ({ TypeName: 'zensu-review-aspect', Role: role,
    Workspace: 'inherit', Model: 'inherit', PromptPrefix: assignmentPrefix(result.ticket, result.tree, role) }));
  result.judgeAssignments = ['judge', 'judge-b'].map(role => ({ TypeName: 'zensu-review-judge', Role: role,
    Workspace: 'inherit', Model: 'inherit', PromptPrefix: assignmentPrefix(result.ticket, result.tree, role) }));
  result.consumerAssignment = { TypeName: 'zensu-code-reviewer', Role: 'consume', Workspace: 'inherit', Model: 'inherit',
    PromptPrefix: assignmentPrefix(result.ticket, result.tree, 'consume') };
  result.instructions = 'Use one invoke_subagent call per required role with flat TypeName, Role, Workspace, Model and Prompt arguments, TypeName zensu-review-aspect, Workspace inherit, Model inherit. Use the exact returned Role and PromptPrefix; append packetBlock unchanged exactly once to every aspect, custom, judge and consume prompt. Require final raw JSON with schema, ticket, tree, role, summary and findings. The child schema is zensu-delegated-perspective-v1. Each finding carries title, severity, file, line, evidence, failure_scenario, fix and integer confidence from 80 through 100. Copy each exact final report into its perspective and attach the actual returned child UUID as childId. Preserve actual judge UUIDs in judges and the consume UUID in consumer.childId. Judges return zensu-review-judge-result-v1 with role and report; consume returns zensu-code-review-result-v1 with report. A required primary judge must complete before consume dispatch; the additive second judge cannot substitute. Keep raw child findings immutable. Perform critical reproduction, synthesis and convergence in the calling skill; route fixes only from the verified merged report and ledger. Any source edit requires a fresh ticket, packet and complete review on the final tree.';
  return result;
}

function main(argv) {
  const result = enrichLease(review.main(argv, process.env, { execution: 'delegated', verifyReport, prepareLease: packet.prepareLease }));
  if (result.directive) result.directive = require('./render-context.js').render(result.directive,
    'post-review-tdd-delegate.sh', { session_id: process.env.ZENSU_HOST_SESSION_ID, review_execution: 'delegated' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 2; }
}
module.exports = { childSchema, assignmentPrefix, stageChild, validateJudge, validateConsumer, verifyReport, enrichLease, main };
