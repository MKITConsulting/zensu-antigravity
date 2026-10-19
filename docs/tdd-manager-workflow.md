# TDD workflow

The implementation runs in the current conversation. There is no tdd-manager worker. `/zensu-tdd` defaults to vanilla implementation while retaining the complete verification and review chain; `/zensu-tdd-mode strict` enables the canonical Red/Green phase gate. Preserve the user's explicit mode preference.

The complete procedure is split across `skills/tdd/SKILL.md` and its `references/`: `planning.md`, `execution.md`, `discipline.md`, `audit.md`, `modes.md` and `review-chain.md`. Plan approval, tracked criteria, per-step evidence, target suites, lint/build, full-suite policy, acceptance verification, exact-tree review and terminal self-review are separate stages. Do not skip a stage by renaming a failed observation.

All helper calls use the injected session-bound wrapper. The engine-neutral state machine owns workflow documents and receipts. Strict mode admits RED tests, records their real failure, admits implementation in GREEN and requires actual green verification. Vanilla mode changes the implementation order only. A one-shot native review ticket binds the resulting review to tree, runtime and generation; terminal self-review additionally requires current full-suite and acceptance evidence.

The four reporting surfaces are progress updates, plan, run log and final report. Logs use the helper's timestamp and redaction behavior; never append machine claim lines manually. `--stdin-file` provides multiline input without shell redirection. Use absolute bound project paths and native Cwd for non-helper commands. A deferred CI contract must remain labeled deferred.

## Finding history and publication safety

The bound `review-ledger` helper runs `review-ledger-v1.js` against the current chain's
known run log and immutable project root. Convergence reads history only on `status=ok`;
reporting uses `--report`, preserving readable entries on `status=partial`. Open entries
remain in the final report once per ID, including earlier-generation IDs. Add the
`FINDINGS LEDGER PARTIAL — <reason>` or `FINDINGS LEDGER UNAVAILABLE — <reason>` row when
the reporting read requires it; missing history is never an empty findings list.

On a re-review, the IMPORTANT findings the judge raised, tagged `[NOT FIXED]` or cited on
code the previous fix pass edited remain eligible under the configured threshold. Under
the default critical threshold every IMPORTANT is parked for self-review; with self-review
off every IMPORTANT remains routable. A deferred finding is ledgered `parked` when it is
IMPORTANT, `deferred` otherwise. A reproduced CRITICAL alone may route when the re-review
reproduction gate is enabled. The terminal self-review re-reads supported candidates and
fixes them in its one bounded fix round, preserving named blockers and unreproduced
CRITICAL observations under `## Open`.

Plans and logs may be published. Each ledger paraphrase is at most 100 characters and
contains no code, secret or concrete sensitive value; for a security finding it names only
the class of weakness, never how to exploit it. Create its message file with native file
tools and call the bound log helper using `--stdin-file` plus `append --message-stdin`.
Never shell-expand findings or override the secret scanner to publish a refused line.

## Durable run ownership

`--autopilot-adopt` and `--autopilot-release` remain separate operations with separate
owner-activity policies. `hooks.autopilotOwnerActivityTtlHours` defaults to one hour for
adoption; `hooks.autopilotReleaseOwnerActivityTtlHours` defaults to six hours for release.
A report does not transfer ownership. Use the corresponding native skill and its bound helper;
confirmation, exact run identity, current state and refusal conditions still apply.
