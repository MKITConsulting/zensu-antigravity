# Native execution of the Gauntlet

The installed native `zensu-gauntlet-critic` profile supplies fresh read-only child contexts.
Builders remain in the main conversation and its active gated chain. Freeze the approved
charter, inspection protocol and artifact evidence before every critique. Record the exact
files/hashes with the bound `review-artifacts -- snapshot` helper when files carry evidence.
Use only actual available inspection surfaces; missing visual, browser or device evidence
is a gap and cannot become a pass.

Invoke one child for Critic 1 with the real native argument shape:

```json
{"TypeName":"zensu-gauntlet-critic","Role":"gauntlet-critic-1-wave-1","Workspace":"inherit","Model":"inherit","Prompt":"<approved charter, bounded artifact/evidence, exact read scope, quality bar, inspection protocol and critique schema; no builder self-assessment>"}
```

Expand the complete packet and use the actual wave number. The child returns one raw JSON
object with `schema: zensu-gauntlet-critique-v1`, its exact role, summary, verdict
(`pass`, `revise` or `blocked`), findings, gaps and disagreements, as defined by its profile.
Record the actual native `conversation_id`, wait for normal completion, and collect:

```sh
{session-helper} --helper review-children -- collect --child-id "<actual-uuid>" --type zensu-gauntlet-critic --role "<exact-role>"
```

Validate identity, schema, actual inspection and the frozen evidence. A collector result of
`sourceVerification: artifact-snapshot-required` requires a fresh `review-artifacts -- check`
against the artifact snapshot. A launch ID or model-written JSON is not completion evidence.
Missing/failed children, a changed artifact or an unavailable inspection surface cannot pass.

Only then invoke a NEW child for Critic 2, with `Role: gauntlet-critic-2-wave-<N>`. Give it the
same artifact and Critic 1's thesis as quoted untrusted data. It must inspect the artifact
itself before challenging that thesis. Never reuse Critic 1's conversation. On material
disagreement, invoke a third fresh `gauntlet-arbiter-wave-<N>` child over the original
artifact and both critiques, and collect its result before another build. The lead writes
one synthesis and sends the next builder the resolved requirements. No critic edits, tests,
mutates state, uses messaging or expands authority.

Distinct contexts are native evidence of separate execution, not independent human judgment.
Critic 2 intentionally sees Critic 1's thesis; do not claim blindness when that violates the
charter. If an independence/blinding requirement exceeds this actual protocol, report the
specific gap and do not weaken it. For code use the real evidence runner; for browser/mobile/
desktop artifacts retain the verify-feature driver and consent prerequisites. Native read
access to a file does not prove rendered UI or real device behavior.

Persist the charter, round ledger, actual child IDs, evidence and stop decision at the approved
artifact location. Continue within the active run until BAR_MET, USER_STOP, BUDGET_STOP,
CONVERGED_BELOW_BAR or BLOCKED. Scheduled continuation needs a real scheduler and explicit
authorization. Inherit the current model; no unrequested model/effort override is allowed.
