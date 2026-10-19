# Review chain

The canonical v0.27.0 defaults remain: vanilla implementation, lean panel, critical-only automatic fixes, convergence and bounded rounds. Strict Red/Green is available through `/zensu-tdd-mode`; selecting vanilla keeps verification and review gates active. See `configuration.md` and `review-severity.md` for exact merge rules and severity.

The native execution procedure is `skills/tdd/references/review-chain.md`, with mandatory
`native-reviewers.md` dispatch instructions. Issue `log -- --review-ticket`, then
`review -- --begin --ticket <ticket>` before the native panel. The returned delegated
assignments pin exact role and ticket/tree prompt prefixes. Dispatch real `invoke_subagent`
children and retain each actual UUID. Children return full canonical finding fields:
title, severity, file, line, evidence, failure scenario, fix and confidence at least 80.

Raw child perspectives remain immutable in the parent report. The main conversation merges,
judges, verifies, reproduces and classifies findings in the separate merged report and ledger.
Those verified findings drive routing; raw child observations must not re-activate neutralized
or deferred findings. Submit through `review -- --ticket <ticket> --report <absolute-json>`;
the adapter checks actual normal child-Stop receipts, tree/runtime, generation and one-shot
ticket consumption. Any reproduction-test edit invalidates the earlier receipts: issue a
fresh review ticket and repeat the required native roles on the final tree, without resetting
the chain. Terminal self-review keeps its exact ticket and current suite/acceptance receipts.

Lean first-round roles are correctness/design/security; lean re-review uses correctness
when activation is enabled and all three otherwise. Full mode contains all five canonical
roles. Activation skips remain explicit summaries from actual child assignments, never
claims of an unperformed inspection. Judges use distinct native contexts and protected
`review-children` completion. Missing configured evidence remains a disclosed gap.

With `hooks.reviewConvergence`, classification runs only when both round-scope and findings-ledger helpers answer `status=ok`. A re-review keeps CRITICAL findings eligible and IMPORTANT findings the judge raised, tagged `[NOT FIXED]` or cited on code the previous fix pass edited. Under the default critical threshold, IMPORTANT findings are parked for the terminal self-review; with self-review disabled they remain routable. Unsupported helper evidence records `CONVERGENCE UNAVAILABLE` and retains ordinary routing, including IMPORTANT fallback when no reliable later carrier exists. Deferred findings remain visible with their original severity and stable ledger ID.

When `findingVerification` and `criticalReproduction` are enabled, every VERIFIED CRITICAL finding from a re-review needs a failing evidence-run test for the cited reason before it routes. `FINDING REPRODUCTION` records REPRODUCED, NOT-REPRODUCED or NOT-TESTABLE. The latter two keep the finding under `## Open` as `[Deferred — do not fix]`; neither becomes an automatic fix or an erased finding. First reviews are unaffected.

Plan and PR reviews retain upstream persona rosters, raw JSON schemas, challenge and
verification. Their bound `review-evidence` helper creates the private file/root lease before
native dispatch, finalizes only when the entire exact generation completed without drift,
collects by actual child UUID and expected role, and closes on success or failure. Missing
reviewers, malformed results or changed evidence require a complete fresh generation.

Custom `.agents/zensu-review-*.md` personas supply concern text inside the fixed registered
worker type; they cannot create executable types or widen capability. The source JavaScript
Workflow DSL remains an inert contract-test reference. `templates/workflows/zensu-review-v1.py`
is its native Python algorithm counterpart, exercised by deterministic tests. The actual
review gate uses direct `invoke_subagent`; optional `run_workflow` output alone is not a
trusted review receipt and has no documented native token-budget accessor.
