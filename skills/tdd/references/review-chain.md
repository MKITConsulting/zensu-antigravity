# Phase 6 step 10: native delegated review and chain completion

Read this after Phase 6 steps 1–9 and at the start of every routed fix round.
Run every transition separately and wait for its result. Read
[native reviewer execution](native-reviewers.md) in full before dispatch. Registered native
reviewers run in distinct child conversations, with actual parent/child provenance and
normal-Stop receipts. The main conversation owns synthesis, verification and all edits.

## 1. Close implementation

Complete the clean Edit Landing Audit and the plan's stable `## Requirements` table first.
Use the absolute `{plan_file}` whose stem matches the audit log:

```sh
{session-helper} --helper log -- --tdd-complete --plan {plan_file}
```

For an Autopilot-bound chain append its existing `--autopilot-run`, `--autopilot-attempt`
and `--chain-id` values. Never derive a new binding from conversation memory or start a
fresh chain to bypass a refusal. Any refusal naming the edit-landing receipt or Requirements
table is a precondition failure: fix the actual audit/plan, then retry. A stale generation or
mismatched binding is a blocker. Do not forge a clean receipt or choose an unrelated plan.
The Stop backstop now keeps the unfinished chain visible.

## 2. Build the review packet

Use the complete Phase 6 step 5b changed-file enumeration, including untracked files,
unborn HEAD and commits made during this session. Read the current changed hunks and every
new file. Anchor all Git commands to the validated absolute project root and use literal
pathspecs. The review packet contains:

- the title `REVIEW PACKET v1`, `policy: reviewer-readonly-v1`, `changed_files`,
  `implementation_summary`, `requirements_baseline` (stable requirement IDs or `none`),
  `diff_summary`;
- the evidence runner's exact `test_evidence`, `build_evidence`, `coverage_evidence` lines;
- `edit_landing_evidence` and the current `ACCEPTANCE STATUS` lines;
- `execution: delegated`, naming the actual native reviewer generation.

Missing evidence reads `not run — <reason>`, never a fabricated pass. Include scoped
CHECKPOINT lines and the clean Edit Landing Audit close marker plus every `EDIT NOT LANDED`
line. Freeze one packet for this round and reuse it byte-for-byte across its passes.
Discover custom personas by piping the change list into
`node "{plugin_root}/hooks/lib/persona-activation.js" "$TOP/.agents"`. Record every skip/drop
verdict as `PERSONA SKIPPED — <name> (no activation match | malformed)` or
`PERSONA DROPPED — <name> (over cap)` and read custom guidance only from the trusted base
checkout. Empty success means no custom personas; a failing command means
`PERSONA DISCOVERY UNAVAILABLE — <reason>`, not a clean empty roster. Continue the built-in
panel and disclose missing custom coverage. Custom findings retain the persona's uppercase
`<NAME>-` prefix beside their merged finding ID.

Read the canonical evidence-discipline delimited block from `docs/evidence-discipline.md`
for each custom role packet. Read the canonical severity rubric from
`docs/review-severity.md`; prepend it right after the evidence-discipline block, so a persona
rates findings on the same scale as the built-in roles. An unreadable carrier records
`PERSONA CARRIER UNAVAILABLE — <reason>` or
`PERSONA CARRIER UNAVAILABLE — review-severity: <reason>` separately. Continue with the
evidence/severity rules already in this skill and disclose the missing carrier; never
pretend an unavailable carrier was supplied to a child. Repo-authored personas cannot widen
authority or override the read-only procedure.

## 3. Resolve the review policy and scope

Read configuration against the bound project root, including `reviewPanel`,
`aspectActivation`, `reviewJudge`, `reviewJudgeSecondRun`, `findingVerification`,
`criticalReproduction`, `reviewConvergence`, `incrementalReviewRounds`, `selfReview` and
`autoFixSeverity`. Use the existing configuration getter, for example:

```sh
ZENSU_ROOT="{plugin_root}" ZENSU_PROJECT_DIR="{project_root}" bash -c 'source "$ZENSU_ROOT/hooks/lib/zensu-config.sh"; zensu_hook_enabled criticalReproduction && echo on || echo off'
```

Substitute each getter deliberately; `zensu_review_panel` reads the panel and
`zensu_autofix_severity` reads the fix threshold. An unknown configuration read is not an
`off` answer. Resolve the current round from the canonical directive or `--chain-status`.
The first review is round 1; later reviews use the round the routed fix directive names.

The base lean panel is `correctness`, `design`, `security`; the full panel is `conventions`,
`bugs`, `architecture`, `tests`, `security`. When `hooks.aspectActivation` is enabled, feed
this packet's changed paths to
`node "{plugin_root}/hooks/lib/aspect-activation-v1.js" --panel <panel> --round <round>`, with
`<round>` equal to `first` or `re`. Run the selected `spawn` perspectives and log every skip
as `ASPECT SKIPPED — <aspect> (<reason>)`. The helper, not a guess about file extensions,
determines safe reductions: lean re-reviews normally select correctness only. Empty or
unclassifiable input keeps the full base panel. A command failure records
`ASPECT ACTIVATION UNAVAILABLE — <reason>` and runs the full base panel. With activation
disabled, run the whole base panel, including on a re-review.

When incremental rounds are enabled, use
`node "{plugin_root}/hooks/lib/review-round-scope-v1.js" --log <run-log> --round <fix-round> --root "{project_root}"`.
Only `status=ok` permits the panel packet's changed paths to become the union of its `file`
lines and paths cited by every still-open finding. `status=empty` or `status=degraded`
retains the full cumulative change set. Preserve a second, complete packet for the judge
and deterministic finding validator; neither is narrowed to the panel's delta.

Open the exact ticket/tree lease before dispatch as `native-reviewers.md` requires.
Any subsequent reproduction-test edit invalidates those receipts and requires a fresh ticket
and a complete required-role re-review on the final tree, without resetting the chain.

## 4. Dispatch each perspective, then synthesize

Use one native `invoke_subagent` batch with the configured registered aspect profile and
complete original packets. Collect actual child UUIDs, wait for their normal completion,
and preserve their raw JSON exactly. Each child records a truthful nonempty summary and
concrete findings or an empty list. No reviewer runs tests, builds, edits, state transitions,
task mutations or nested agents. Custom concerns run as additional fixed-type children.

Merge duplicate findings by defect and location, retaining source perspectives and the
highest supported severity and confidence. Order CRITICAL, IMPORTANT, SUGGESTION, then
path; number the merged findings `R<k>-F<n>` in that order, with `k` the actual review
round. Keep each ID in the finding text, along with source-role labels. Preserve
disagreements and missing evidence.

When `hooks.reviewJudge` is enabled, dispatch a separate native judge child using
`agents/zensu-review-judge.md` over the full cumulative change set plus merged findings,
plus `findings_ledger` when the post-review directive resolved both the current round scope
and the ledger as `status=ok`. The ledger is history for the judge only, never a finding
list or a verification verdict. On a re-review with the lean panel, skip this step,
matching the upstream cost policy. The first review's
`hooks.reviewJudgeSecondRun` enables a second fresh native child labelled `JUDGE-B`. Supply
the same original input without injecting the first judge's deltas into its separate context. The second pass adds findings only. It
cannot neutralize, re-ID or replace the first judge's coverage decisions.

A first-judge `Panel-FP:` neutralization keeps both findings visible, annotates the original
`[Panel-FP-neutralized — do not fix]`, sets it to SUGGESTION and exempts it from all automatic
fix routing, including the `all` threshold. Never silently delete a critical finding.
Every ordinary judge finding takes the next free `R<k>-F<n>` id after the panel findings,
beside its `JUDGE-n` label, even when it quotes an earlier ledger ID. A covers line such as
`[STILL OPEN] <id> covers <panel-id>` or `[NOT FIXED] <id> covers <panel-id>` is different:
it is a meta-verdict like `Panel-FP:`, takes no id, and names the panel finding it covers.
`[STILL OPEN]` retains the earlier ledger ID; `[NOT FIXED]` leaves the panel finding its own
new ID. A CRITICAL re-raise is judged fresh on current evidence.

Merge second-judge `JUDGE-B<n>` findings after the first judge's deltas. The same defect at
the same `file:line` adds its label to an existing non-neutralized finding and raises severity
when justified; a different finding, or a re-raise of a neutralized one, receives the next
free ID at its own severity. A second-judge `Panel-FP:`, `[NOT FIXED]`, `[STILL OPEN]` or
`## Gaps` directive changes nothing: log `JUDGE SECOND RUN RULE BREACH — <what>` and merge
only its ordinary findings. Failure, `REVIEW PACKET INVALID` or an unparseable second report
records `JUDGE SECOND RUN UNAVAILABLE — <reason>` and leaves the first result standing.
Carry both disclosures into the final report. External Workflow import is unavailable on
this host: do not claim one occurred or skip the panel because an unrelated workflow
produced prose. Source import-only gap-worker branches therefore have no native execution.

## 5. Verify findings before fixing them

When `hooks.findingVerification` is off, skip all three stages. When it is on, grade every
merged panel, custom and judge finding in this thread before any fix routing.

**Stage 1 (deterministic, model-free).** Run
`node "{plugin_root}/hooks/lib/finding-verify-v1.js" --root "{project_root}"` with a quoted
heredoc containing `CHANGED-FILES`, the full cumulative change list, `FINDINGS`, then one
line per merged finding in order. The stateless validator accepts this input directly;
the session helper's stricter standalone command grammar applies only to bound helpers.
Its verdicts are `anchor-ok`, `off-changeset`, `line-out-of-range`, `phantom-path`,
`out-of-root` and `no-anchor`. Exit 0 means verdict data, not a pass. Its returned `total`
must equal the count submitted. Missing Node, non-zero exit, an unparsable summary or a
count mismatch records `FINDING VERIFICATION DEGRADED — <reason>`; continue Stage 2 by hand
instead of wedging the chain or inventing a successful check.

**Stage 2 (your own read).** Read every `anchor-ok` or `off-changeset` cited region with
offset `max(1, line - 10)` and limit 25, and compare its actual contents with that finding's
own `Evidence:` claim. Classify VERIFIED or UNSUPPORTED. `off-changeset` alone is not a
defect in the finding: an unchanged caller may expose the bug. Hard Stage-1 failures are
PHANTOM; `no-anchor` meta-verdicts such as `Panel-FP:` are exempt. Preserve every unsupported
or phantom observation as `[Unverified — do not fix]`, set its routing severity to
SUGGESTION and exclude it in every fix mode, including `all`. Preserve its original
severity in the human report; never delete a CRITICAL observation. A genuine observation
without an anchor is deferred for a human with original severity and anchor `-`, rather
than represented as a verified defect or invented path.

**Stage 3 (reproduction, re-reviews only, config-gated).** Resolve
`hooks.criticalReproduction` with the bound project configuration getter from step 3. When
on, and only when a routed fix round made this a re-review, reproduce every Stage-2 VERIFIED
CRITICAL finding before it may route. Write or extend a test for its cited behavior that
must fail on the current tree, then run it through the real evidence runner:

```sh
{session-helper} --helper log -- --evidence-run --scope scoped --cmd '<reproduction test command>' --log <run-log>
```

Write the exact result to a private regular absolute message file, then append it with
the standalone stdin-file command in the ledger section below:
`FINDING REPRODUCTION — <ledger-id> <REPRODUCED|NOT-REPRODUCED|NOT-TESTABLE> <record id or one-line reason>`.
Use the merged finding ID when no ledger is kept. REPRODUCED requires a test failure for
the cited reason, not an unrelated command/setup failure; route it and retain its regression
test. NOT-REPRODUCED means the run passed: retitle the finding `[Deferred — do not fix]` with
`CRITICAL (not reproduced)` in its text, set its routing severity to SUGGESTION, exempt it
from every automatic-fix mode and list it under `## Open`. Keep that test only when it
asserts specified behavior. NOT-TESTABLE means no test can express the concern: apply the
same deferral with `CRITICAL (not testable: <reason>)` and leave it under `## Open` for a
human. An infrastructure failure proves no reproduction; explain the unavailable evidence
instead of classifying it REPRODUCED. Never delete these findings. With criticalReproduction
off, re-review CRITICAL findings route after verification as before. The first review is
unaffected, and findingVerification off disables Stage 3 as well.

Reproduction may change the tree: log those test-file edits under this round's current
claim prefix, re-run Edit Landing Audit, update the packet and read the added/changed test
through the selected perspectives before opening the native lease in step 6. Recheck finding
anchors on this final tree. Do not fix production code during reproduction. A later source
edit invalidates the lease; never submit the old tree or bypass its freshness refusal.

Log `FINDING VERIFICATION — {n} verified, {n} unsupported, {n} phantom, {n} off-changeset`.
Carry that line, reproduction outcomes and every DEGRADED line into both the final report
and CHAIN-END SUMMARY. A degraded check is never a clean state.

### Convergence classification and safe findings ledger

Resolve the configured automatic-fix threshold; the default is **critical**. Apply the
canonical directive for the current generation. Under critical, park IMPORTANT findings
for the terminal self-review, including on the first review, when selfReview and
reviewConvergence are enabled. With either disabled, or on CONVERGENCE UNAVAILABLE, route
IMPORTANT findings as under `important`, because no reliable later carrier would fix them.

When reviewConvergence is off, do not read or write this ledger and do not add its rows to
the final report. When on, follow the directive's ledger contract before fixing and after
each fix. Read it only through the bound helper:

```sh
{session-helper} --helper review-ledger -- --log <run-log> --root "{project_root}"
```

On a re-review, classification requires BOTH the round-scope helper and this ledger to
answer `status=ok`. Give those entries to the judge as history when a judge runs. After
finding verification, CRITICAL findings remain eligible only under the reproduction rule.
An IMPORTANT finding remains eligible when the judge raised it, tagged it `[NOT FIXED]`,
or it cites code the previous fix pass edited; under critical it is still parked. When
selfReview is off, keep every IMPORTANT eligible. Retitle every other finding
`[Deferred — do not fix]`, preserve original severity in its text, set routing severity to
SUGGESTION and exempt it from every mode. Panel-FP and Unverified annotations take precedence.
Eligibility is not permission to exceed the configured severity threshold. Any other helper
status means ordinary routing for that review, with
`CONVERGENCE UNAVAILABLE — <reason>` and IMPORTANT fallback as described above. Never guess
that missing history is an empty history or reuse an earlier verification verdict.

Append each merged finding exactly once under its stable ID before fixing, except an
Unverified finding, which receives no ledger line. Use
`FINDING LEDGER — R<k>-F<n> <routed|deferred|neutralized|parked|fixed> <CRITICAL|IMPORTANT|SUGGESTION> <path>:<line> | <paraphrase>`.
Use routed for a fix being taken, neutralized for Panel-FP, parked for an unfixed IMPORTANT,
and deferred for other retained findings. The severity field always preserves original
severity, even after a routing downgrade. After each actual fix append fixed under that same
ID. A `[STILL OPEN] <id> covers <panel-id>` retains its earlier ID, adds no second finding
line or new ID, and its later fixed/parked line uses that earlier ID. Immediately ledger a
newly deferred finding before the ticket, even when this review will close the loop.

All ledger and reproduction lines use a native-created regular private absolute input file:

```sh
{session-helper} --helper log --stdin-file '<absolute-message.txt>' -- append --log <run-log> --message-stdin
```

No heredoc, shell expansion, redirection or `--message` wraps this bound command. For a
line range use its first line; use `-` for a genuinely anchorless observation. Keep the
paraphrase at most 100 characters, without code, secrets or values; for a security finding
name only the weakness class, never an exploit. On secret-scan refusal rewrite the
paraphrase, never add `zensu-secret-allow` or disable ZENSU_SECRET_SCAN. The final renderer
reads with `--report` and discloses partial/unavailable history rather than claiming none.

## 6. Submit the bound native report

First verify a bound Autopilot chain with a fresh `--autopilot-status`: require its current
session owner, `stage=TDD_RUNNING`, `tdd.sessionId`, `tdd.attempt`, `tdd.chainId` and
`tdd.returnStage` to match the immutable run/attempt/chain/return-stage envelope. Stale,
missing, duplicate or conflicting linkage blocks before issuing a ticket. Preserve the
same envelope into terminal self-review; never reconstruct it from conversation memory.

Use the delegated generation opened before the fan-out. Its schema is
`zensu-delegated-review-v1` with `execution: delegated`. Preserve ticket, tree, round and
required role identities. Copy each raw child result verbatim into the returned template,
adding its actual `childId`; do not overwrite findings after synthesis. The separate merged
report and canonical findings ledger carry verified, neutralized, deferred and routed states.

If Stage 3 added a reproduction test, all old receipts are stale. Follow the exact fresh
`--review-ticket` and `--begin` sequence in `native-reviewers.md`, re-review the final tree
with every required role, and use only those new children. Do not reuse an old ticket or
start a fresh implementation chain to obtain another budget.

For activation, a skipped required role gets a truthful `ASPECT SKIPPED` summary with its
exact reason and no findings from its actual child, never a claimed inspection. Additional
selected roles still run; preserve their distinct child evidence and findings in the merged
report. With activation disabled the entire base panel runs, including on a re-review.

Submit the immutable raw report through:

```sh
{session-helper} --helper review -- --ticket "<returned-ticket>" --report "<absolute-report.json>"
```

The adapter verifies actual child completions, descriptors, tree/runtime freshness,
generation, expiry and the one-shot ticket. The canonical next-step directive operates on
the verified merged report and ledger, not raw child findings. A refusal never authorizes
synthetic metadata, handwritten workflow state, a reused ticket or early `--chain-done`.

## 7. Fix rounds and termination

When routed to fix findings, implement them in this thread under the mode frozen at begin.
For every changed file log the current `R<N>-<step> IMPL completed — files:` claim, re-run the
Edit Landing Audit and the round's own affected suites. Rebuild the packet and repeat this
review procedure with a fresh ticket. Keep the bound Autopilot run/attempt/chain on every
required transition. Never re-arm from scratch to obtain extra rounds.

At convergence or the configured maximum, re-run the original evidence command with
`--if-stale`: `--scope full` in local mode, `--scope scoped` under a verified CI full-suite
policy. CI deferral stays explicitly `FULL SUITE — deferred-ci`; it is not a full-suite pass.
Check `--acceptance-status --log <run-log>` on the current tree and invoke
`/zensu-verify-feature --chain` when it names missing/stale acceptance evidence.

Use the exact ticket-bound `--code-review-done` command the native routing directive gives,
then execute `/zensu-self-review`. That skill owns `--chain-done` and its one bounded final
fix round. If self-review is disabled, use the directive's ticket-bound terminus only after
current suite and acceptance receipts pass. Do not bundle completion, review submission and
chain termination into one shell call. The zero-change exception applies only when the
runtime confirms no changed files; never commit, stash or revert to manufacture that state.

The final report identifies native child UUIDs, active panel, actual rounds,
verification gaps, unverified/neutralized observations, retained noncritical findings,
acceptance status, suite/CI evidence and every bypass. A completed ticket is evidence of a
validated child-backed report on this tree, not a guarantee that every defect was found.

When self-review is disabled, render the canonical combined-summary directive only on its
terminal branch. For a standalone plan with a `## Requirements` table, put this offer only
under `## Open`: `Optional next step: /zensu-converge — flow-back audit of the code against the plan's Requirements table.`
Never run it unasked. Never render it for an Autopilot-bound chain, in a nonterminal round,
or when no combined summary is emitted. When self-review is enabled it owns this offer;
do not duplicate it here. The zero-change branch emits no final review report or offer.
