# Native reviewer dispatch and evidence

Read this entire file before the first reviewer dispatch. These calls are actual native
`invoke_subagent` calls, not shell commands or source-platform Agent/Workflow requests.
Keep implementation, evidence runs, synthesis and routing in the main conversation.

## Open the generation before dispatch

For an Autopilot-bound chain first read fresh `--autopilot-status` and require the current
owner, `stage=TDD_RUNNING`, session, attempt, chain and return stage to match the immutable
caller envelope. Missing, duplicate or conflicting linkage blocks before ticket creation.
Issue a ticket and open its source-tree lease in separate shell calls:

```sh
{session-helper} --helper log -- --review-ticket
{session-helper} --helper review -- --begin --ticket "<returned-ticket>" --packet-input "<absolute-packet-input.json>"
```

Read the returned `schema: zensu-delegated-review-v1`, `execution: delegated`, exact ticket,
tree, round, role list, `packetHash`, `packetBlock`, `consumerAssignment` and `reportTemplate`. An empty ticket or refusal is a blocker: read
`--chain-status` and use its supported recovery route; never reset a chain to buy a budget.
The native runtime owns the required roles. Match the round actually reviewed.

## Dispatch the required perspectives

Run canonical aspect activation against the actual packet. For every required role dispatch
one child with the fixed `zensu-review-aspect` type; roles outside this required roster run
as additional fresh children. A required role the classifier safely skips still receives its
own role packet: it returns the observed `ASPECT SKIPPED — <role> (<reason>)` summary and no
findings, explicitly declining to claim an inspection. With activation disabled, every base
role actually reviews, on first and later rounds alike. Never replace a required child with
main-thread prose or silently omit a selected custom/aspect pass.

On agy 1.4.3, call the actual native tool once per role with these flat arguments,
expanding every placeholder:

```json
{
  "TypeName": "zensu-review-aspect",
  "Role": "<exact role from the lease>",
  "Workspace": "inherit",
  "Model": "inherit",
  "Prompt": "<complete REVIEW PACKET v1, assigned perspective, exact ticket/tree/role, inherited evidence and severity blocks, read-only boundary, output schema below>"
}
```

The historical `{"Subagents":[...]}` batch is supported only when the exposed native tool
schema accepts it. The observed 1.4.3 validator rejects `Subagents`, despite the public hooks
reference still listing it. Never combine flat fields with `Subagents`, add undeclared
arguments or turn a malformed array into a fallback flat request. If the actual schema
cannot accept the supported shape, report that conflict without changing the plugin or gates.

The exact `Role` equals the lease role, for example `correctness`, not a display label.
Use the returned assignment's `PromptPrefix` verbatim as the first three prompt lines:

```text
REVIEW-TICKET: <ticket>
REVIEW-TREE: <tree>
REVIEW-ROLE: <role>
```

Then append the exact returned `packetBlock` and output contract. Never prepend a greeting or omit a
prefix line; the adapter binds these exact identities to the actual native launch.
Dispatch every required role exactly once, using one flat call per role on the current host.
Every child starts with its own complete packet and isolated conversation; no prior role
conclusions enter a panel prompt. Custom
personas remain concern text inside this fixed type. Model overrides are not implicit.
Each child must return one raw JSON object as its entire ordinary final response:

```json
{
  "schema": "zensu-delegated-perspective-v1",
  "ticket": "<exact ticket>",
  "tree": "<exact tree>",
  "role": "<exact role>",
  "summary": "What this role actually checked, or the explicit activation skip",
  "findings": [{
    "title": "Concrete failure",
    "severity": "critical",
    "file": "src/example.js",
    "line": 12,
    "evidence": "Observed source and reason the behavior fails",
    "failure_scenario": "Concrete supported trigger",
    "fix": "Concrete correction",
    "confidence": 90
  }]
}
```

Use `findings: []` when appropriate. Severity is `critical`, `important` or `suggestion`;
file paths are repository-relative, lines are positive and confidence is at least 80.
Do not invent evidence. Keep uncertain observations below that confidence out of findings
and disclose the uncertainty in the summary.

## Collect actual completed children

Record each actual returned `conversation_id` from the native tool result, matched to
the exact dispatched type, role, prompt and workspace. Historical batch results use
`subagent_info.subagents[]`; do not infer a current result envelope or fabricate an ID when
that evidence is absent. The native adapter verifies that
parent step and child metadata before the first child tool call. A returned UUID or alive
state proves launch only. Wait for every exact child to complete, then read its ordinary
final response. Do not call messaging or task tools from a reviewer, fabricate a child ID,
write a completion receipt or infer completion from another conversation's logs.

Preserve each raw perspective payload verbatim in the parent report, adding its actual
`childId` to the corresponding perspective entry of `reportTemplate`. The protected normal
child-Stop receipt, exact descriptor, runtime and current tree must agree before submission.
Missing, failed, cancelled, malformed, mismatched or duplicate results block completion.
Never edit a worker's JSON to make it pass: repeat the affected generation with actual
children under a fresh ticket after correcting the cause.

## Judges and extra perspectives

Run the configured first judge as a fresh `zensu-review-judge` child over the full packet
and merged panel report. Use the same native shape, `Role: "judge"`, inherited model and
workspace. When enabled on the first review, dispatch the second judge through its own
flat call as another fresh child with `Role: "judge-b"` and the same original input
plus final line `judge_run: second`, excluding the first judge's deltas. Its distinct context is
real; the canonical add-only and rule-breach rules still apply. Require final raw JSON
`{"schema":"zensu-review-judge-result-v1","role":"<judge|judge-b>","report":"<complete canonical judge output>"}`.
For each actual judge UUID collect its protected completion:

```sh
{session-helper} --helper review-children -- collect --child-id "<actual-child-uuid>" --type zensu-review-judge --role "<judge-or-judge-b>"
```

Use the same protected collection route for additional `zensu-review-aspect` children,
with their exact type and role. Preserve raw results separately; custom roles do not enter
the base lease's required `perspectives` array or add keys to its strict report template.
Their verified findings still join the full merged report and ledger, with source labels. A missing, rejected, failed, empty or malformed required primary judge blocks consume review:
record `JUDGE UNAVAILABLE` and retry that actual native role on the same valid lease or
report the blocker. A completed second judge cannot substitute for it. Preserve each
completed judge UUID in the report template's `judges` array as `{role, childId}`; keep
second-run unavailability visible under the documented add-only failure policy.

Before submission dispatch the consume `zensu-code-reviewer` as its own native child using
`consumerAssignment.PromptPrefix` unchanged. It starts with
`PRE-MERGED FINDINGS (fan-out)`, then `REVIEW-TICKET:`, `REVIEW-TREE:` and `REVIEW-ROLE: consume`.
Append the exact canonical `packetBlock`, verified merge and the consume contract. Require
final raw JSON `{"schema":"zensu-code-review-result-v1","report":"<complete # Code Review Report including - Verdict:>"}`.
Preserve its normal final completion and set `consumer: {"childId":"<actual-child-uuid>"}` in the
report template. Neither main-thread prose nor an unfinished child satisfies this stage.

## Synthesis, reproduction and completion

The main thread merges and verifies findings, applies judge decisions, performs required
critical reproduction, and records the canonical convergence ledger. Raw child findings stay
immutable. Neutralized, unsupported, deferred and routed findings belong to the separate
merged report and findings ledger, with stable IDs and original evidence. Canonical routing
must use that post-verification merged report and ledger, never re-activate raw child findings.

A reproduction test edit or any other source change invalidates the current tree lease and
all its child receipts. Obtain a fresh `--review-ticket`, call `--begin`, rebuild the packet
with the new evidence and repeat all required perspectives on the final tree. This same-round
ticket replacement is supported while implementation is complete and review remains open;
do not call `--tdd-begin`, reset a round, relabel an old child or carry its receipt forward.
Previously created reproduction tests need not be created again; report their actual run.

Save the exact parent report outside source or in ignored `.zensu/review/`, then submit:

```sh
{session-helper} --helper review -- --ticket "<returned-ticket>" --report "<absolute-report.json>"
```

Follow the returned routing directive with the separate verified merged report/ledger.
A missing native capability, child receipt or validated result blocks review completion.
Stop with the concrete blocker; do not substitute an in-thread pass or bypass the required
native reviewer, independent-critic charter or evidence lease.
