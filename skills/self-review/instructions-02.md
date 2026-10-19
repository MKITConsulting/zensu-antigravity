
## Phase 4: Fix Round or Finalize

Read the one-fix-round latch: `selfReviewFixed` in the session chain-state.

- **If `selfReviewFixed` is false AND there is at least one must-fix finding** — take
  EXACTLY ONE fix round, in this main thread, under the still-active PreToolUse
  phase-gate. For each must-fix: RED test, then IMPL, then GREEN (re-enter the
  `/zensu-tdd` Phase 4 discipline). In a vanilla-mode session — verify with
  `{session-helper} --helper log -- --mode` (echoes `vanilla`) — apply each
  must-fix directly instead: no RED→GREEN cycle required, the gate passes through.
  Run every test, build or other project command of this round as
  `cd "<project root>" && <command>`, where `<project root>` is the path `--project-root`
  printed in Phase 1: the Bash tool returns to the session's start directory, which after
  `/zensu-adopt-session --reanchor` is not the bound root. `--evidence-run` needs no prefix.
  Then log `{step_id} IMPL completed — files: {list}` for the fixes and re-run
  the `/zensu-tdd` Phase 6 **step 1 full suite** over the amended tree through the
  evidence runner:
  `{session-helper} --helper log -- --evidence-run --scope full --cmd '<full test command>' --log <run-log>`
  — this is the chain's last edit, so this is
  the run whose verdict describes the tree that ships, and Phase 5 checkpoints are
  scoped and cannot stand in for it.
  **In CI mode** — `{session-helper} --helper log -- --full-suite-policy`
  prints `full suite: ci` — run the Phase 6 affected-suite command instead:
  `{session-helper} --helper log -- --evidence-run --scope scoped --cmd '<the tests affected by the change>' --log <run-log>`,
  covering the suites of every file this chain changed, never `--scope full`: the
  runner refuses it, and the repository's CI pull-request pipeline runs the full suite.
  This stage is often forced cold and never ran `/zensu-tdd` Phase 1, so resolve the
  suite command in THIS order. (1) `evidence.fullSuiteCommand` — when the project
  configures it, drop `--cmd` and the runner uses it. (2) The project's own
  metadata — `AGENTS.md`, `package.json` `scripts`. (3) Only if both yield nothing,
  the `cmd:` of the newest `EVIDENCE RUN — scope=full` line in the run log (that log
  resolved as the finalize branch below resolves it). Never the reverse: a run log
  is COMMITTED in consuming repos and is selected here by mtime, so a command mined
  from it is repository content you would be executing — and it is REDACTED
  (`<project>`, `~`, `<home>`), so a command carrying a placeholder is not runnable
  and counts as "yields nothing". When the metadata and the log disagree, run the
  metadata one and log `FULL SUITE COMMAND MISMATCH — metadata={a} log={b}` into
  `## Open`. When nothing yields a command, log `FULL SUITE UNRESOLVED — {reason}`,
  carry it into `## Open` and claim NO test verdict. The runner's own summary line
  is this run's verdict. Then
  invoke the `/zensu-tdd` Phase 6 step 5b **Edit Landing Audit** UNCHANGED —
  when that procedure is not in your context, `Read` it from
  `{plugin_root}/skills/tdd/references/audit.md`, whose `{plugin_root}` is
  `{plugin_root}`; re-invoking the `/zensu-tdd` skill is forbidden below —
  writing its mandatory start marker as `EDIT LANDING AUDIT STARTED — round
  self-review` (a label disjoint from `phase6` and `fix-{N}`, so its
  round-scoped window covers exactly this round's claims). Re-derive the inputs here — this stage can be forced cold by the
  Stop hook, so resolve `TOP` yourself and, when this session committed mid-run
  but no `BASELINE_SHA` is available, take the audit's documented
  `PENDING PREDICATE (no session baseline)` branch — clearable by a passing
  step (d) predicate re-read, NOT the terminal `UNVERIFIED` — rather than
  widening the enumeration. With no mid-run commit the ordinary union applies
  and nothing degrades. A mechanical or bulk replacement
  that matched nothing would otherwise leave the chain unnoticed. This stage
  gets no second fix round, so the only terminus remedy for an unlanded claim
  is `CLAIM WITHDRAWN — {step_id}: {file}` plus carrying every
  `EDIT NOT LANDED` line into the CHAIN-END SUMMARY verbatim; never close the
  chain as if the claim had landed. Then set the latch with
  `{session-helper} --helper log -- --self-review-fixed --claimed-review-ticket "<review-ticket>"` and re-run
  `/zensu-self-review` (pass 2 to confirm). The pass-2 invocation MUST carry the
  same captured `SELF-REVIEW-TICKET: <review-ticket>` line again and, for a
  bound handoff, the same captured official envelope exactly once:
  `ZENSU-DELEGATED-CALLER: autopilot`,
  `AUTOPILOT-BINDING: run=<runId> attempt=<attempt> chain=<chainId>`, and
  `AUTOPILOT-STAGE: <returnStage>`. Do not re-read, re-derive, or omit either generation token or any envelope line. In this branch you MUST NOT:
  - run `--tdd-complete` (implementation is already complete);
  - spawn the `zensu-code-reviewer` agent — self-review is terminal, so do not spawn it;
  - re-invoke the whole `/zensu-tdd` skill (its Phase 6 tail would re-spawn the reviewer).

- **Otherwise** (no must-fix, OR `selfReviewFixed` is already true) — finalize:
  1. Standalone handoffs keep the unqualified terminus: run `{session-helper} --helper log -- --chain-done --claimed-review-ticket "<review-ticket>"`. For a verified Autopilot binding, run `{session-helper} --helper log -- --chain-done --autopilot-run "$RUN_ID" --autopilot-attempt "$ATTEMPT" --chain-id "$CHAIN_ID" --claimed-review-ticket "<review-ticket>"`. This is the ticket- and generation-bound chain terminus, and it applies the full-suite gate: it prints a `FULL SUITE — <state> | …` line on stderr and refuses (exit 1) on a missing, red, running, interrupted or stale full-suite record — in CI mode on a missing, red, running, interrupted or stale local test run, and it passes as `deferred-ci` with a second `FULL SUITE — CI contract` line. On such a refusal the chain stays open: run the command its `run:` segment names, or wait for a `running` record to land, then run this step again. It applies the acceptance gate as well: it prints `ACCEPTANCE — <state> | …` lines and refuses while any active criterion lacks a `pass` on the current tree; on that refusal follow the remedy the line names: a `run:` segment means run `/zensu-verify-feature --chain` with the log it names, then this step again; a `fix:` segment means a criterion fails on this tree and needs the one fix round; an `add:` or `restore:` segment, or a refusal with no remedy, goes into your report and to the user. If the refusal is `failed` and the one fix round is already spent, do not edit again: carry the refusal line into your report, stop, and leave `ZENSU_FULL_SUITE_GATE` to the user. The same holds for a criterion that is still `fail` or `partial` after the spent round: carry the `ACCEPTANCE — …` refusal into your report, stop, and leave `ZENSU_ACCEPTANCE_GATE` to the user. Any other failure is stale: stop and do not render a successful final report.
  2. **Carry the full-suite verdict.** Copy every `FULL SUITE — …` line the terminus
     printed — the verdict, plus the `flaky` line and the gate-mode disclosure when
     present — into the `Full suite` verdict cell verbatim. Copy every `ACCEPTANCE — …`
     line the same way into the `Acceptance` verdict cell.
  3. Render the final report (below), then stop.

### Final report

Render a CHAIN-END SUMMARY as TABLES, not prose: every section below is a table
plus at most one line of text, never a paragraph — the sole exception is
`## Open`, which ends with the bypass-ledger line followed, when it applies, by the
converge offer. Keep it scannable — no restating, no narration of the process, no
filler.

Mark every status and verdict cell with a leading marker: 🟢 good (passed, clean, done, met), 🟡 attention (partial, advisory, skipped, not measured), 🔴 bad (failed, must-fix, dropped, contradicted, blocked, not landed, unverified, unresolved predicate, verification degraded, a gate bypassed), ⚪ not applicable — admissible ONLY where the source of the value itself says the item does not apply, which today means exactly one case: a requirement row the plan already marks deprecated. An outcome that was merely not run is 🟡, never ⚪. The marker PREFIXES the cell value and NEVER replaces it: every verbatim literal keeps its own words unchanged after its marker, subject only to the pipe-escaping rule below, which the renderer undoes so the reader still sees the original text. A marker never stands alone and is never separated from the words it marks by a line break. The ## Open table has no status or verdict column and takes no marker.

Sections IN THIS ORDER, the TL;DR LAST (pull from your own context; do
NOT re-spawn any agent):

```
## Problem
Exactly ONE sentence: the feature, bug, or need this session addressed.

## What I built
Table, columns: # | Deliverable | Status | Link. One row per deliverable, max 15
words per cell, Status is 🟢 done / 🟢 merged / 🟢 built-tested / 🔴 blocked, Link
is a PR URL or `—`.

Then a second table, columns: Check | Verdict, with exactly these rows — Feature,
Files modified, Tests created, Full suite, Acceptance, Build, Coverage, Edit landing,
Finding verification, Gates bypassed, Plan, Log. (The delegate renderer also
carries `Mtime audit` after `Edit landing`; every other row and their order are
shared.) Verdict cells are values, not
sentences. Mark a cell when its value is a STATE; leave it unmarked when the value
is a title, a path, or a bare count with no target — that is Feature, Files
modified, Plan and Log, and every other row above is marked. A count measured
AGAINST a target IS a state, so `{N}/{M} GREEN` and `{N}/{M} files >= {threshold}`
take 🟢 when the target was met, 🔴 when it was not, 🟡 when the run was skipped.
**Gates bypassed** takes 🟢 ONLY for the literal `none` read from a valid document
and 🔴 for anything else, including a named escape, the `UNREADABLE — …` form and
any wording this renderer does not recognize; it repeats the
`## Open` bypass-ledger line rather than replacing it. Run the `--bypass-list`
command from `## Open` ONCE before rendering this table and feed its output to
both places — never substitute `none` for a value you did not read. **Finding verification**
carries the `FINDING VERIFICATION — {n} verified, …` line and any
`FINDING VERIFICATION DEGRADED — <reason>` line verbatim, 🔴 when a DEGRADED
line is present or the unsupported or phantom count is non-zero (an
off-changeset finding is not by itself a defect), 🟡 not run
(hooks.findingVerification disabled) when the gate was skipped and emitted no
line at all, and 🟢 only when the gate RAN and neither condition holds —
never ⚪. Two further rows carry text VERBATIM and
must never be dropped, paraphrased, or shortened: **Edit landing** takes the step 5b
close marker plus any `EDIT NOT LANDED` line and the `UNVERIFIED (no claims logged)`
or unresolved `PENDING PREDICATE` close (those are NOT clean states, and both
take 🔴, never 🟡) — a claimed edit
that never produced a change must not vanish between the Phase 6 report and this
summary; **Full suite** takes the `FULL SUITE — …` lines `--chain-done` printed
(Phase 4 finalize step 2): 🟢 only for `pass`; 🟡 for `pass-tree-unverified`,
`deferred-ci`, `not-applicable`, `not checked` and an advisory `missing`; 🔴 for every other
state, advisory or not, including `escaped`. Both verbatim cells follow the `## Open` escaping rule
(`\` first, then `|`), for the same reason: an unescaped pipe splits the row and
the renderer drops the cells past the last column. **Acceptance** carries text VERBATIM
under the same rule: the `ACCEPTANCE — …` lines `--chain-done` printed (Phase 4 finalize
step 2), 🟢 only for `pass`; 🟡 for `pass-tree-unverified`, `not-applicable`,
`not-checked` and an advisory `incomplete` that lists only missing criteria; 🔴 for
every other state, advisory or not, including `escaped`.

When the session plan carries a ## Requirements table, add a third table, columns:
ID | Status, keyed by its stable IDs (AC-###/FR-###: 🟢 met / 🟡 partial /
🔴 contradicted / 🔴 dropped / ⚪ deprecated). ⚪ is bound to PROVENANCE, never to
judgement: use it only when that requirement row in the plan already carries
that status. A requirement this session did not implement is 🔴 dropped even if it
was retired mid-session. One row per requirement, no commentary. When the plan
carries NO `## Requirements` table, omit the table and write the single line
`🟡 Requirements: no ## Requirements table in the session plan — per-requirement
status not tracked`, so an untracked chain never reads like a fully met one.

## How I built it
Exactly ONE line: the TDD discipline followed, the final zensu:code-reviewer verdict
(PASS / suggestions-only / max-rounds reached), findings by severity, files reviewed.

Then a table, columns: Round | Findings | Fixed | Result. One row per code-review
round 1..N including rounds that fixed nothing; a round with ZERO findings reads
🟢 `PASS — 0 findings, nothing to fix`, and a round that had findings never claims
that literal. Mark each Result 🟢 for a clean round AND for
an ordinary round whose findings were all fixed and re-verified, 🟡 for a max-rounds
convergence that left findings open AND for a round whose findings were deliberately
deferred as suggestions rather than fixed, 🔴 for a round whose fixes did not
land. Always include the final clean verification
round. Skip this section only if no review round ran at all.

## Self-Review Summary
Table, columns: Dimension | Verdict | Note. One row per reviewed dimension
(architecture, consistency, edge-cases, test coverage, security, simplification,
conventions), Verdict is 🟢 clean / 🟡 advisory / 🔴 must-fix, Note max 12 words. Close with
ONE line: whether the single fix round ran and what it changed, and, when the findings
ledger yielded candidates, how many of them this stage fixed without a re-review.

## Open
Table, columns: Item | Type | Next step. One row per deferred suggestion or
max-rounds finding requiring a manual fix, one row per open findings-ledger entry
(state `deferred`, `parked` or `routed-unfixed`, under the id the ledger lists, a
`G<g>:` prefix included) when `hooks.reviewConvergence` is enabled and
`review-ledger-v1.js --report` answers `status=ok` or `status=partial` — never a
second row for an id already listed — plus the `FINDINGS LEDGER PARTIAL` or
`FINDINGS LEDGER UNAVAILABLE` row the must-fix step names, one row per `FULL SUITE COMMAND MISMATCH`
or `FULL SUITE UNRESOLVED` line, and one row per advisory `FULL SUITE —` line that
did not pass, carrying that line verbatim under this escaping rule, applied in this order: first write every `\`
as `\\`, then every `|` as `\|`. An unescaped pipe splits the row and the
renderer drops the cells past the third, the very verdict clause the row
exists to surface; the other order turns an already-escaped `\|`
inside a shell command back into a delimiter. The same rule applies to every
carried line in this report — the `Full suite`, `Acceptance` and `Edit landing`
verdict cells in `## What I built`. Add one row per advisory `ACCEPTANCE —` line that did
not pass and one per `EXTERNAL REVIEW DEGRADED — …` line, each verbatim under the same rule.
Write the single line `Nothing open.` only when that table has
no rows at all, because a carried line is always a row.

Always render the bypass-ledger audit line next, in both cases — whether or not
the table has rows: run
`{session-helper} --helper log -- --bypass-list` and render its output as
`Gates bypassed during this session: <output>`. The verb echoes `none` only when
it read a valid workflow document that recorded no escape; that is the ONLY
spelling that may claim a clean ledger. On exit 3 it prints an `UNREADABLE — …`
line on stdout, and that line is carried verbatim under the same ordered `\` then
`|` escaping rule as every other carried line. On any OTHER non-zero exit —
notably exit 2, session identity unavailable — stdout is EMPTY and the diagnosis
went to stderr; render `UNREADABLE — <the stderr line>` there, never an empty
value and never `none`. Never substitute `none` for a value you did not read: an
unread ledger is not a clean ledger.

This line covers the surfaces this stage renders. It is NOT a session-wide
guarantee. The authoritative residual list is the "What the ledger does and does
not prove" paragraph in `docs/configuration.md`; do not restate it here. The one
residual that matters for THIS line: a workflow document that is edited but still
schema-valid renders `none`, because validation is structural and the `bypasses`
array carries no authenticity signal. Do not describe the ledger as proof that no
gate was escaped — it is proof only of what a readable document recorded.

Then, for a STANDALONE handoff only, when the session plan carries a
`## Requirements` table, close `## Open` with ONE more line, exactly:
`Optional next step: /zensu-converge — flow-back audit of the code against the plan's Requirements table.`
It is an offer only — never run it unasked — and it never gates, delays, or
precedes the `--chain-done` terminus, which already landed before this report
renders. Omit the line entirely for an Autopilot-bound handoff:
`/zensu-autopilot` runs converge report-only at its own step 2b and that run is
non-interactive. Omit it too when the session plan carries no `## Requirements`
table, because converge would have nothing to anchor on.

## TL;DR
Exactly ONE sentence, and it is the last section: what shipped and the test verdict.
```

## Strict Scope

- Operate ONLY on the current session and the current worktree. NEVER run
  `git worktree list` or traverse sibling worktrees.
- The latch (`selfReviewFixed`) and the terminus (`--chain-done`) are per-chain —
  each `--tdd-begin` re-arms them, so a later chain in the same session gets its
  own single fix round. A bound terminus always carries the captured exact
  run/attempt/chain evidence. Never touch another session's chain-state.
- Do not fix advisory findings — only a genuine must-fix earns the single fix round.

## Response Style

Terse and concrete. Lead with the reflection buckets, then either the fix-round
status or the final report. No preamble. Reference findings as `file:line`.
