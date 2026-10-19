# Upstream parity and native execution

This port takes its feature baseline from `zensu-claude-code` **0.27.0**. All 32 skill
entry points, corresponding native command shims, six canonical reviewer/PLM profiles plus one native Gauntlet critic, persona
rosters, reference rubrics and templates are present. The target package keeps its own
version. Runtime provenance is recorded in `upstream-runtime.json`.

Parity means preserving the required behavior, defaults and fail-closed evidence rules.
Host facilities without a verified equivalent remain explicit limitations. Registering a
skill or a reference agent does not prove a host can execute that facility.

## Complete feature inventory

| Command | Preserved behavior and native execution |
|---|---|
| `/zensu-adopt-session` | Report/confirm runtime adoption and missing-root recovery through the bound helper; reanchor requires live ownership proof and otherwise refuses |
| `/zensu-autopilot` | Approved plan through implementation, review, acceptance and ready PR; durable state machine, explicit approval event and bounded recovery |
| `/zensu-autopilot-adopt` | Inspect and adopt an eligible orphaned run with its canonical ownership and state checks |
| `/zensu-autopilot-release` | Release/cancel an eligible foreign run with its canonical refusal conditions |
| `/zensu-bootstrap` | Product bootstrap from a vision with workflow-scoped typed CLI mutations |
| `/zensu-converge` | Drive the remaining bounded fix/review/verification chain to its actual terminus |
| `/zensu-cover` | Discover coverage gaps, add meaningful tests, run evidence and native reviewer children |
| `/zensu-delivery-route` | Session-bound delivery route and explicit publication authority |
| `/zensu-docs` | Code-grounded feature/wiki documentation and workflow-scoped publication |
| `/zensu-doctor` | Read-only native session/runtime/state diagnosis before narrowly authorized repair |
| `/zensu-full-suite` | Real local full-suite evidence or an explicit deferred CI contract |
| `/zensu-gauntlet-loop` | Bounded build, two sequential critics, synthesis and disagreement arbiter; distinct native critics and a conditional arbiter; unavailable inspection/blinding requirements remain explicit |
| `/zensu-ghost-scan` | Repository-grounded feature discovery, validation and tracked import |
| `/zensu-implement` | Tracked feature/security context, implementation, artifact linking and revision |
| `/zensu-pilot` | Ordered feature delivery orchestration through the sibling skills |
| `/zensu-plan-review` | Canonical persona/schema review, private evidence leases, native reviewer children and concrete amendments |
| `/zensu-pr-fix-findings` | Resolve actual open review findings, verify fixes, push and resolve authorized review threads |
| `/zensu-pr-team-review` | Full persona roster, coverage audit, challenge, verified findings and forge publication; native children with exact private lease validation |
| `/zensu-pulse` | Lazy native session tracking with canonical idempotent CLI lifecycle |
| `/zensu-recover-chain` | Guarded repair of contradictory receipt/document state, never arbitrary receipt fabrication |
| `/zensu-reset-review-limit` | Explicit additional bounded review-round budget |
| `/zensu-security-review` | Classification, security analysis, STRIDE/testing and tracked completion |
| `/zensu-self-review` | Ticket-bound terminal reflection, at most one fix round and current evidence before completion |
| `/zensu-session-trail` | Native index/transcript inspection, handoff and explicit lineage; no inferred ownership or account/task-chip management |
| `/zensu-setup` | Project configuration, mappings and authorized instruction/template setup |
| `/zensu-tdd` | Vanilla by default, optional strict Red/Green, real verification and native ticketed review |
| `/zensu-tdd-mode` | Session-bound implementation-mode selection without disabling the evidence chain |
| `/zensu-verify-feature` | Browser/service/CLI/desktop/mobile recipes and criterion-bound pass/fail/partial evidence |
| `/zensu-wargame` | Explicit mission contracts, evidence, native challenge and honest non-convergence |
| `/zensu-work` | Exact claimed work-order/session/lease binding and canonical worker pipeline |
| `/zensu-zen-mode` | Session-bound Zen behavior with unchanged authority and evidence requirements |
| `/zensu-help` | Source-routed explanation of current plugin behavior and limitations |

The eleven additions over the original 21-entry port are adopt-session, autopilot-adopt,
autopilot-release, delivery-route, full-suite, gauntlet-loop, recover-chain, session-trail,
tdd-mode, work and zen-mode.

## Rules and defaults

Implementation defaults to **vanilla**; explicit strict mode retains Red/Green enforcement.
The default review panel is **lean**, and automatic fixes default to **critical** findings.
Convergence, round budgets, the judge/finding-verification checks, acceptance criteria,
full-suite receipts, tree freshness, one-shot tickets and terminal self-review are retained.
The helper outputs and `configuration.md` are authoritative for resolved settings. A CI
handoff stays `deferred-ci` until CI evidence exists; a partial acceptance result blocks.

Typed Zensu CLI operations keep their real backend names, including the historical
`zensu doc claude-md` and `generate_claude_md` identifiers. Their generated instruction
content is adapted for the user's workspace AGENTS.md only when editing it is authorized.
Renaming these CLI identifiers would invoke nonexistent backend operations.

## Native replacements and proof boundaries

| Source-host facility | Native implementation or explicit limit |
|---|---|
| Plugin/session environment exported into a shell | Bootstrap injects exact root/project/conversation/helper values. Stateful calls use the standalone `session-helper.sh --session ... --helper ... -- ...` wrapper with per-call receipt validation. No inherited shell variables are assumed. |
| SessionStart and prompt injection | The adapter performs lazy first-invocation bootstrap and uses the real native lifecycle/payload fields. A native transcript path is authority only when linked to the exact current conversation. |
| Native reviewer launch and child lifecycle | Verified `invoke_subagent` on agy 1.4.2 supplies actual child UUIDs and separate contexts. The adapter binds exact parent launch/type/role/prompt/workspace and normal child Stop. Child IDs and completion receipts are never model-authored. Reviewers return ordinary final responses; plan/PR workers cannot message. IDE behavior remains unverified. |
| Native reviewer launch permission | `reviewerSpawnAutoAllow` grants only an entirely audited manifest-owned read-only reviewer/worker batch after all gates accept and launch provenance is recorded. Strict config withdrawal, explicit ask/deny or a mixed batch prevents the grant. Child capability remains confined. |
| Ticketed post-implementation review | `review -- --begin --ticket ...` returns delegated role assignments and the exact prompt prefixes. Submission verifies actual child receipts and immutable raw results, tree/runtime/generation/expiry and consumes the ticket. Separate verified merged findings/ledger drive routing. |
| Confined plan/PR review evidence | The bound `review-evidence` create/finalize/collect/close lifecycle enforces private exact-file/safe-root leases and canonical schemas for actual native children. Complete generation and evidence freshness are required; the main thread owns discovery and publication. |
| Workflow DSL | The JavaScript DSL is an inert canonical reference. The Python counterpart targets documented native `run_workflow`, preserving finder/refuter algorithms; no token-budget accessor is invented. Direct `invoke_subagent` remains the receipt-backed review route. Python output alone cannot import a completed review. |
| Plan-mode approval hook | Save and present the exact plan, obtain explicit approval, then apply the canonical four-route question as the skill procedure. No synthetic approval event or digest-recording API is assumed. |
| Session Trail and account/window/task-chip state | The native adapter reads the summary database, exact workspace cache and bounded native transcript records. It supplies handoff/resume information and explicit lineage. Snapshot status does not establish process liveness, account limit, exclusive ownership or a successful resume. |
| Worktree keep/archive release, Desktop receipts and session forks | No verified native equivalent. Do not synthesize source-host files or claim an archive protection, desktop handoff or fork occurred. Ordinary registered Git worktrees remain usable under explicit task authority. |
| Reanchor ownership registry | Canonical checks remain strict. Native indexed conversations are insufficient liveness proof; missing registry evidence refuses with `live-sessions-unverifiable`. Start a fresh conversation in the desired worktree. |
| Headless work-order launcher | Prepare a real native conversation before the external claimant binds its UUID; resume that exact conversation for the order. No invented session-id option or claim alias. See `work-order-mode.md`. |
| Browser origin approval | Host `ask`/`force_ask` is documented and translated. The complete native interactive answer/success-receipt cycle is not live verified. Missing context/result proof fails closed; validated parent-environment policy is the alternative where required. |
| Desktop/mobile/browser driver tools | Use only installed concrete drivers and observed outputs. Recipe availability does not prove tool/device execution. Do not invent preview/browser/desktop APIs. |
| Always-on plugin rules | agy 1.4.2 loads the plugin-owned `rules/AGENTS.md` through native discovery without a manifest rules key. It carries current routing, authority and evidence policy; rules are shipped and runtime-digest-bound. The earlier 1.1.10 limitation is historical. User workspace AGENTS.md remains untouched without authorization; installed-artifact model ingestion is verified by the live suite. |

## Validation

`test-command-skill-pairing.sh` and `test-skill-frontmatter.sh` independently pin the full
32-entry inventory. Manifest/agent tests pin native registration and honest role assets.
`test-native-skill-adapters.sh` tests native transcript kinds and handoff/lineage limits,
selector ambiguity, file alias rejection, canonical review schema rejection and evidence
drift. These are deterministic checks, not a claim of live host acceptance.

The native live suite is mandatory after host-facing changes. Its actual report must identify
which scenarios ran, exact hook traces, command resolutions, gating decisions and Stop
block/resume evidence. Skipped, inconclusive or unavailable probes cannot establish parity.

Native dispatch supports flat parent-owned batches with inherited model and workspace. Nested
child dispatch and alternate child model/workspace selectors are not supported by the provenance
adapter. Unknown native profiles retain a non-main host principal; they cannot acquire Zensu
reviewer or main-thread authority by claiming a familiar role. This matrix describes the ported
Zensu routes, not equivalence with every capability of either host.
