# Zen-mode 0.7.0 release readiness

Prepared on 2026-11-03. Status: local release candidate ready, with the advisory limits below; not published.

## Problem

Complete the two Zen-mode review improvements, verify the outstanding native behavior, and remove the packaging blocker across the user-authorized complete repository state while preserving the original working tree.

## What I built

1. **Zen-mode and progress presentation — built and tested.** The candidate includes the earlier 25-file Zen implementation: answer first, closing session goal and history, native current-user-input handling, and state-derived workflow progress. This follow-up improves `evals/zen-mode-reaction/scenarios/session-block-first-turn.yaml`, its short twin, and `tests/structure/zen-anchor-assertions.test.js`. Completed work and recaps no longer satisfy the covered next-action cases. Thirteen new vectors bring the first-turn table to 24; comments identify the actual native provider and synthetic markers correctly.
2. **Complete tracked release source — ready locally.** Branch `codex/zen-mode-release-ready` integrates current main at `6a1626664340ca38ebd420bbe6bfc67aaee256ea`, the workflow repairs from [PR #9](https://github.com/MKITConsulting/zensu-antigravity/pull/9) through `681272e14e9dc233c121152200fa4b5583240481`, and the local Zen work. Manual integration fixes only update the test registry and generated overview to retain the current capture counts. Version 0.7.0 is synchronized in `plugin.json`, the README badge and CHANGELOG by `f4f3ade14acf0d14d301e6335a033ddfb4a07222`. Reviewed implementation: `c4e98e1e2c048059c0e63d1257258e9131b60632`; the final documentation commit adds only this report and its evidence summary.
3. **Native package — built and verified.** `zensu-antigravity-native-v0.7.0.zip` contains 337 curated regular files. The previously untracked workflow implementation is tracked in the integrated source. `package-native.sh` and its tracked-file guard were not weakened. Every package file matches the final source or the exact portable `hooks.json` template rendering. ZIP SHA-256: `1967bb168b4ec6c8bdb2358123737ebb96d8eae45405dd925c2060301b19463a`. Runtime digest: `sha256:4cccbef8d178d459d1b7b969e63a9efba50ce73f8d394f4a49ddf13b65916a38`.
4. **Attributable validation and preservation — done.** The private evidence directory retains raw observations, exact commands, source mappings, checksums, failed attempts and review packets. Settings backups and promptfoo account state are excluded from the preserved handoff. The original branch, HEAD and unstaged work remain in place; only the three authorized follow-up files were changed there. The release source is isolated under `.zensu/releases/0.7.0/source`.

Validation results:

| Check | Result | Scope |
|---|---:|---|
| Full deterministic gate | 83/83 suites | Frozen runtime source at `f4f3ade`; 81 structure suites plus the two offline gates |
| Configuration gate | 57/57 | Included in the full gate |
| Offline promptfoo | 110/110 | Included in the full gate |
| Zen-mode structure | 142/142 | Included in the full gate |
| Source-write gate | 274/274 | Permanent source location; included in the full gate |
| Grader tests after review fix | 15/15 | Includes all 24 first-turn vectors and full/short equivalence |
| Reaction structure after review fix | 32/32 | Current eval/test source |
| Native adapter tests | 30/30 | Separate coverage run |
| Native CLI acceptance | 45/45 attributable | AGY 1.4.12; 43 initial verified results plus two targeted retries |
| Package/source comparison | 337/337 | Same frozen ZIP after all implementation edits |

The full deterministic gate ran before the later test/eval-only changes and two imported historical validation documents. The affected 15 grader tests and 32 reaction checks were rerun afterward; all shipped runtime bytes stayed identical. This is not a claim that a fresh full gate ran at the final documentation commit.

The complete native run initially exited 1: two command-resolution observations were invalidated by overlapping settings changes. An unchanged, sequential retry verified both. The aggregate preserves per-scenario result sources and hashes, passes the canonical 45-scenario verifier and has zero unverified rows. This is **43 initial results plus two retries**, not one clean full native run. All eight previously outstanding functional probes passed, including paired deny/control writes, hook firing, Stop block and same-session continuation, native children and read-only denials. The bounded Stop test proves blocking and resumption, not full workflow closure.

All 52 owned native transports exited. Both sets of temporary workspace trust entries were removed and original settings bytes restored. Six one-time native approvals were inspected by Codex under task authorization; they are not human acceptance. The installed plugin was not changed.

The first deterministic attempt under `/tmp` was terminated after location-dependent source-write fixture failures. The unchanged source passed from its permanent isolated location. The failed attempt is retained; no assertion, gate or timeout was relaxed.

Coverage: `hooks/antigravity/normalize-payload.js` has **84.18% line, 79.43% branch and 88.89% function coverage**. The added native current-input assignment is covered. Existing uncovered paths remain below the workflow-default 90% line target; no repository hard coverage threshold is configured, and the target is not claimed passed.

Plan: `.zensu/plans/2026-11-02_tdd-zen-release-ready.md`. Log: `.zensu/logs/2026-11-02_tdd-zen-release-ready.log`. Exact validation audit: `.zensu/logs/2026-11-02_zen-release-validation.json` (13 finished command checks, witness-matched; numerical exits come from actual tool completion records).

## How I built it

The user selected the Zensu workflow. Its configured implementation mode was vanilla; meaningful failing regression tests preceded both fixes, without claiming strict phase-gated RED/GREEN execution. The complete candidate runtime received deterministic and real native validation. Source review focused on the earlier Zen delta and the follow-up/integration delta; this is not a new line-by-line audit of all inherited repository code.

- **Round 1:** Five packet-only aspect reviewers and one consume reviewer consolidated 0 Critical and 1 Important finding. The predicate still accepted completed-status phrases and labelled recaps. Fixed in `c4e98e1` by stripping next-step labels, rejecting status prefixes and requiring action content. Eight additional vectors and the raised 24-case floor passed the affected checks.
- **Round 2:** Five packet-only aspect reviewers and one consume reviewer converged at **suggestions-only: 0 Critical, 0 Important, 1 Suggestion**. Tests, security, architecture and conventions each returned PASS with zero findings. No code was changed in this verification round. The suggestion below is deferred under `autoFixIncludeSuggestions=false`; no further review loop was triggered.

Round 1 reviewed the three follow-up files, two registry/inventory integration files, three version fields and two imported historical validation documents. Round 2 reviewed the current three-file fix. Every reviewer confirmed the complete immutable packet and used no tools. Packet SHA-256 values: round 1 `7b544a56326b72b9ba3c197334cb22df260e9b2ffa227b7ab472ae5af65f845b`; round 2 `ada9bf6b0fc74655036aab7722330896e8352e300f5d90910890bfb9bbe76198`.

## Self-Review Summary

**Positive:** Source integration preserves the existing work, the package guard remains intact, and native evidence is tied to the exact unchanged runtime. Failed observations and retries remain visible.

The seven-dimension review found no additional must-fix. Architecture boundaries are preserved; mirrored graders and release versions are consistent; negative edge cases have regression vectors; test claims are limited to their actual execution scope; security permissions are unchanged; the predicate remains small; English content and Conventional Commits follow the repository rules.

**Improvements:** The advisory grading ambiguity below and the existing normalizer coverage gap remain documented. **Risks:** The finite English grader is heuristic; native CLI success does not certify the IDE importer or human acceptance. No self-review fix round ran.

## Open

No Critical or Important review finding remains. Deferred finding, verbatim:

> **Suggestion — REL-1** at `evals/zen-mode-reaction/scenarios/session-block-first-turn.yaml:110`, mirrored in `evals/zen-mode-reaction/scenarios/short-session-block-first-turn.yaml`.
>
> **Title:** Status filter also rejects an imperative with a participial object.
>
> **Explanation:** The new statusOnly expression rejects the valid next action “Review completed dry-run output.” because it matches “Review completed” without examining the following object. The added positive vector “Review the completed dry-run output.” does not cover this ambiguity. This affects advisory grading accuracy, not shipped runtime behavior.
>
> **Suggested fix:** In a subsequent grader refinement, distinguish completed-status phrases from completed modifying an object, and add this exact positive vector to both mirrored graders’ shared cases.

The 90% default coverage target remains unmet as quantified above. Automatic AI-work capture was skipped because the repository had no confirmed product binding; no work goal, review URL or human acceptance is claimed. No remote push, PR creation, merge, release publication or installed-plugin update occurred. The next delivery action is a separately authorized PR/publication of this prepared candidate.

## TL;DR

Zen-mode 0.7.0 is prepared locally with the two requested improvements, an intact native package, 83 passing deterministic suites and 45 attributable native scenarios, with one advisory grader finding and the existing coverage gap disclosed.
