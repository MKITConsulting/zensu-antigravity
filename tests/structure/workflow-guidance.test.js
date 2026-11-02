'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function markdownFiles(dir) {
 return fs.readdirSync(dir, {withFileTypes:true}).flatMap(item => item.isDirectory() ? markdownFiles(path.join(dir,item.name)) : item.name.endsWith('.md') ? [path.join(dir,item.name)] : []);
}
test('native workflow instructions stay within the established 24000-byte budget and resolve mandatory local links', () => {
 for (const folder of ['skills/tdd','skills/self-review','skills/verify-feature']) for (const file of markdownFiles(path.join(root,folder))) {
  const text=fs.readFileSync(file,'utf8');
  assert(Buffer.byteLength(text) < 24000, path.relative(root,file));
  for (const [,target] of text.matchAll(/\]\(([^)#]+\.md)\)/g)) {
   if (!target.includes(':')) assert(fs.existsSync(path.resolve(path.dirname(file),target)), file+' -> '+target);
  }
 }
 for (const folder of ['self-review','verify-feature']) {
  const entry=read('skills/'+folder+'/SKILL.md');
  assert.match(entry,/every file below in the listed order, in full/);
  assert.match(entry,/If a read is truncated, continue/);
 }
});
test('native capability, finding JSON and configured routing guidance agree with runtime support', () => {
 const config=read('docs/configuration.md'), review=read('skills/tdd/references/review-chain.md');
 assert.match(config,/externalReviewImport.*unavailable in the native workflow/);
 assert(fs.existsSync(path.join(root,'hooks/lib/external-review-v1.js')));
 assert(fs.existsSync(path.join(root,'templates/workflows/zensu-review-v1.js')));
 assert.match(review,/--input "<absolute-findings.json>"/);
 assert.match(review,/invalid-input.*truncated/);
 assert.match(read('agents/zensu-code-reviewer.md'),/quality verdict only/);
 assert.match(review,/effective `autoFixSeverity`/);
});
test('acceptance diagnostics and shared-run guidance preserve safety and one verdict per criterion', () => {
 const entry=read('skills/verify-feature/SKILL.md'), evidence=read('skills/verify-feature/rules/acceptance-evidence.md');
 assert.match(entry,/rules\/acceptance-evidence\.md/);
 assert.match(evidence,/at most 20 diagnostic lines, each at most 160 characters/);
 assert.match(evidence,/catch unexpected exceptions without printing their message or stack/);
 assert.match(evidence,/do not forward those buffers/);
 assert.match(evidence,/immediately record \*\*each covered AC separately\*\*/);
 assert.match(evidence,/do \*\*not\*\* record any criterion as `pass` from its nonzero record/);
 assert.match(evidence,/assertion-to-AC\n   mapping/);
 assert.match(evidence,/Import by package name from that consumer\nand invoke its installed npm bin/);
 assert.match(evidence,/Node's `-C` selects export conditions, not a working directory/);
});
test('lifecycle and terminal instructions use evidence-derived native helpers without restarting self-review', () => {
 const execution=read('skills/tdd/references/execution.md'), self=read('skills/self-review/SKILL.md'), fix=read('skills/self-review/instructions-02.md');
 assert.match(execution,/--helper workflow-artifacts -- start --log/);
 assert.match(self,/status: closed.*nextAction: render-report-only/);
 assert(self.indexOf('--helper workflow-artifacts -- report') < self.indexOf('## Phase 1:'));
 assert.match(fix,/Do not invoke `\/zensu-self-review` again/);
 assert.match(fix,/clean, fresh edit-landing receipt/);
 assert.doesNotMatch(self,/step 5b b\)/);
 const integrity=read('skills/tdd/references/audit-integrity.md');
 assert.match(integrity,/edit-landing-predicates-v1/);
 assert.match(integrity,/omitting `--dirty-before` cannot clear/);
 assert.match(integrity,/--session "\{conversation_id\}"/);
});

test('terminal report instructions preserve exact evidence under zen mode and forbid unobserved claims', () => {
 const report=read('skills/self-review/instructions-02.md');
 assert.match(report,/Tests, suites, assertions\n  and files are different units/);
 assert.match(report,/Do not infer a\n  per-file split from the total/);
 assert.match(report,/Rejecting malformed JSON does not establish denial-of-service or prototype-pollution/);
 assert.match(report,/installing that exact archive into a separate directory and importing the package\n  by name/);
 assert.match(report,/Node's `-C`\n  selects export conditions/);
 assert.match(report,/report corrections do not\n  restart self-review/);
 const zen=read('hooks/user-prompt-zen-mode.sh');
 assert.match(zen,/WORKFLOW REPORT EXCEPTION: keep the required report's exact form/);
 assert.equal((zen.match(/WORKFLOW REPORT EXCEPTION/g) || []).length,2,'both full and compact reminders preserve the report');
 assert.match(report,/Do not invent follow-up features, security claims or\n  new product advice/);
});

test('one real acceptance execution supports separate AC records but stops being reusable after a tree change', async t => {
  const av = require('../../hooks/lib/acceptance-verify-v1');
  const evr = require('../../hooks/lib/evidence-run-v1');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-acceptance-reuse-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const projectRoot = path.join(dir, 'project');
  fs.mkdirSync(projectRoot);
  const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), '.zensu/\n');
  fs.writeFileSync(path.join(projectRoot, 'checks.cjs'), `const assert = require('node:assert/strict');
assert.equal(2 + 2, 4); console.log('AC-001 check=sum result=pass');
assert.equal(2 * 3, 6); console.log('AC-002 check=product result=pass');\n`);
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  for (const name of ['logs', 'plans', 'state']) fs.mkdirSync(path.join(projectRoot, '.zensu', name), { recursive: true });
  const stem = '2026-10-19-0100_tdd-reuse';
  const logPath = path.join(projectRoot, '.zensu/logs', `${stem}.log`);
  fs.writeFileSync(logPath, 'TDD STARTED\n');
  fs.writeFileSync(path.join(projectRoot, '.zensu/plans', `${stem}.md`), `# Plan\n\n## Requirements
| ID | Requirement | Source |
|----|-------------|--------|
| AC-001 | Sum is correct | spec |
| AC-002 | Product is correct | spec |\n`);
  const receiptPath = path.join(projectRoot, '.zensu/state/edit-landing.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ schema: 'edit-landing-v2', session: 'fixture', log: `.zensu/logs/${stem}.log`, clean: true }));
  const sessionKey = `scv1_${'e'.repeat(64)}`;
  const pluginData = path.join(dir, 'data');
  fs.mkdirSync(pluginData, { mode: 0o700 });
  const sink = { text: '', write(value) { this.text += value; } };
  const code = await evr.run({ pluginData, sessionKey, projectRoot, cwd: projectRoot, scope: 'acceptance', command: 'node checks.cjs', show: 'tail', bashPath: 'bash', env: process.env, stdout: sink, stderr: sink });
  assert.equal(code, 0, sink.text);
  const recordFiles = fs.readdirSync(path.join(pluginData, 'evidence-run/v1/records', sessionKey));
  assert.equal(recordFiles.length, 1, 'the acceptance suite must execute only once');
  const evidenceRun = recordFiles[0].replace(/\.json$/, '');
  const options = { pluginData, sessionKey, projectRoot, receiptPath, logPath, bashPath: 'bash', driver: 'library', verdict: 'pass', evidenceRun };
  for (const [ac, evidenceText] of [['AC-001', 'The shared consumer asserted that two plus two is four.'], ['AC-002', 'The shared consumer asserted that two times three is six.']]) {
    const result = av.record({ ...options, ac, evidenceText });
    assert.equal(result.code, 0, result.error);
    assert.equal(result.record.evidence_run, evidenceRun);
  }
  assert.equal(av.status(options).code, 0);
  fs.appendFileSync(path.join(projectRoot, 'checks.cjs'), '// changed after observation\n');
  const stale = av.record({ ...options, ac: 'AC-002', evidenceText: 'Attempting to reuse the earlier product observation.' });
  assert.match(stale.error, /another tree/);
  assert.notEqual(av.status(options).code, 0);
});
