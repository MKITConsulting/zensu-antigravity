#!/usr/bin/env node
'use strict';

// Native child identities and Stop receipts are interpreted only in this adapter.
const crypto = require('node:crypto');
const review = require('../lib/in-thread-review-v1.js');
const paths = require('./session-paths.js');
const childSchema = 'zensu-delegated-perspective-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const assignmentPrefix = (ticket, tree, role) => `REVIEW-TICKET: ${ticket}\nREVIEW-TREE: ${tree}\nREVIEW-ROLE: ${role}\n`;
const fail = message => { throw new Error(`native-review: ${message}`); };

function verifyReport(report, lease, binding, options = {}) {
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
  return { execution: 'delegated', reportHash: hash(JSON.stringify(report)), children };
}

function enrichLease(result) {
  if (!result.reportTemplate) return result;
  for (const perspective of result.reportTemplate.perspectives) perspective.childId = '';
  result.childSchema = childSchema;
  result.assignments = result.roles.map(role => ({ TypeName: 'zensu-review-aspect', Role: role,
    Workspace: 'inherit', Model: 'inherit', PromptPrefix: assignmentPrefix(result.ticket, result.tree, role) }));
  result.instructions = 'Use invoke_subagent once per required role with top-level TypeName zensu-review-aspect, Role, Prompt, Workspace inherit, Model inherit. Only older host schemas require a Subagents array of these descriptors. Use the exact returned Role and PromptPrefix; append the REVIEW PACKET v1 and require a final JSON object with schema, ticket, tree, role, summary and findings. The child schema is zensu-delegated-perspective-v1. Each finding carries title, severity, file, line, evidence, failure_scenario, fix and integer confidence from 80 through 100. Copy each exact final report into its perspective and attach the actual returned child UUID as childId. Do not synthesize, rewrite or merge away a child finding in this receipt. Perform critical reproduction and convergence in the calling skill, retaining immutable child reports separately from the final merged report and finding ledger. Route fixes from that validated merged report and ledger, never directly from raw child findings. Any source edit requires a fresh review ticket and a complete review on the final tree.';
  return result;
}

function main(argv) {
  const result = enrichLease(review.main(argv, process.env, { execution: 'delegated', verifyReport }));
  if (result.directive) result.directive = require('./render-context.js').render(result.directive,
    'post-review-tdd-delegate.sh', { session_id: process.env.ZENSU_HOST_SESSION_ID, review_execution: 'delegated' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 2; }
}
module.exports = { childSchema, assignmentPrefix, verifyReport, enrichLease, main };
