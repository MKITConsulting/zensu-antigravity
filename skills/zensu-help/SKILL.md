---
name: zensu-help
description: Answer questions about how Zensu (the SaaS Product Lifecycle Manager) and the zensu-antigravity plugin itself work. Acts as an in-conversation glossary, architecture explainer, and config reference — does NOT execute workflows. Use when the user asks "what is X?", "how does Y work?", "where is Z configured?", about plugin internals, Zensu concepts, version changes, or invokes /zensu-help.
---

# /zensu-help

Answer questions about how Zensu (the SaaS Product Lifecycle Manager) and the zensu-antigravity plugin itself work. Acts as an in-conversation glossary, architecture explainer, and config reference — does NOT execute workflows.

## When to Use

- User asks "what is X?", "how does Y work?", "where is Z configured?"
- User asks about plugin internals: agents, hooks, FSM, auto-fix loop, the `zensu` CLI write-gate
- User asks about Zensu concepts: features, KEY-N ids, tiers, journeys, classifications
- User asks "what changed in version X" or "how do I disable hook Y"
- User is unsure which other skill (`bootstrap` vs `ghost-scan` vs `implement`) applies to their situation
- User asks how to invoke a Zensu capability (the `/zensu-<name>` convention)

## Do NOT Use For

- Executing workflows → use `/zensu-bootstrap`, `/zensu-ghost-scan`, `/zensu-implement`, `/zensu-security-review`, `/zensu-pulse`, `/zensu-reset-review-limit`
- Modifying Zensu data — this skill is read-only Q&A

## Prerequisites

None. This skill answers from embedded knowledge and the plugin's canonical docs already present in the repository. No MCP connection, no API key, no network required.

## Invocation convention (embedded)

Every Zensu capability is invoked as a workflow named `/zensu-<name>` — the user-facing trigger is the workflow (filename stem under `workflows/`), which loads and runs the matching skill in `skills/<name>/SKILL.md`. The namespace is baked into the hyphenated workflow name. Examples: `/zensu-tdd`, `/zensu-implement`, `/zensu-help`. Run `/zensu-help` for orientation; `/zensu-tdd` runs the gate-enforced TDD build.

## Core Glossary (embedded — stable concepts)

- **Product** — top-level container; owns Components, Tiers, Features, Journeys.
- **Component** — architectural module within a Product (e.g. `auth-service`).
- **Feature** — unit of capability, identified by `KEY-N` — product feature key + number (e.g. `ZEN-42`). Lifecycle: `planned → in-progress → testing → released`.
- **Tier** — pricing/availability level (e.g. Free, Pro, Team). Features map to tiers via the tier matrix.
- **Journey** — user path through one or more Features; contributes to release readiness.
- **Security Classification** — `public | internal | confidential | restricted`. Drives the 0–10 security score.
- **Security Score** — computed from classification + OWASP tags + compliance tags + security tests + reviews.
- **Revision** — a Feature's build-out *stage* over time. Auto-versioned (v1, v2, …); each tracks scope changes, acceptance criteria, breaking changes, effort, and target release. v1 is the baseline stage; later revisions are deeper build-out. `/zensu-ghost-scan` seats each discovered feature at a v1 baseline; `/zensu-implement` adds one per implementation.
- **Subfeature** — *structural* fan-out of a Feature into child parts (same component + release): workflow steps, happy-vs-error paths, interface or data variations. A feature's two growth axes are revisions (stages over time) and subfeatures (parts); both differ from the product-level roadmap (features across a quarter timeline).

## Three Layers (embedded — architecture overview)

1. **Planning** (`zensu-plm` agent) — `/zensu-bootstrap` (greenfield: a plan/vision doc, no code yet) or `/zensu-ghost-scan` (brownfield: an existing codebase) produce tracked features, user journeys, and linked docs. **Hybrid** (existing code *and* a forward plan doc): ghost-scan first to import what is built, then create the plan's not-yet-built items as `planned` features. The agent triages by asking: (1) code already built or starting fresh? (2) plan/vision doc present? (3) if both, does the plan describe things not yet built?
2. **Implementation** (`/zensu-tdd` skill in the MAIN thread + `zensu-code-reviewer` subagent) — strict RED→IMPL→GREEN TDD enforced by a PreToolUse FSM gate, followed by 5 sequential code-review perspectives, then an auto-fix loop backed by the `Stop` hook (`stop-chain-enforcer.sh`). The TDD workflow runs in the main thread (not a subagent); `zensu-code-reviewer` is the only subagent the TDD chain spawns directly (`zensu-plm` and `zensu-review-aspect` are the other shipped subagents).
3. **Tracking** — web dashboard surfaces security scores, journey health, tier matrix, coverage trends.

## Agents (embedded — one-liners)

- `zensu-plm` — orchestrates planning workflows (bootstrap, ghost-scan, security review, release readiness).
- `zensu-review-aspect` — read-only single-perspective reviewer; five run in parallel during the TDD review fan-out.
- `zensu-code-reviewer` — single READ-ONLY subagent running 5 sequential perspectives: conventions, bugs, architecture, tests, security.

TDD discipline (RED→IMPL→GREEN, FSM-gated edits, 3-retry IMPL escalation, completeness audit) is NOT a subagent — it runs in the main thread via the `/zensu-tdd` skill.

## Topic Routing (live read for volatile facts)

Before answering questions in the right column, `read` the source file in the left column and quote `file:line` in the answer.

| Question type | Source to Read |
|---|---|
| Plugin version, declared skills/agents/workflows/rules | `plugin.json` (repo root) |
| CLI command surface / install; plugin wiring | `README.md` § CLI + `zensu --help` + `plugin.json` (the MCP server stays live for the Zensu web app but is no longer wired into the plugin) |
| Hook flags (`autoTdd`, `tddImplementation`, `chainEnforcer`, `autoFix`, `autoFixIncludeSuggestions`, `autoFixMaxRounds`, `combinedSummary`, `pulseSession`, `sessionBanner`, `intentRouter`, `mcpGate`, `bashWriteGate`, `selfReview`) | `README.md` § Configuration → Hook Opt-Out table + `config.example.json` |
| Hook event wiring (which scripts fire on which event, via the shim) | `hooks.json.template` + `hooks/antigravity/antigravity-shim.sh` |
| Context-nudge settings (`context.compactionNudge`, `context.nudgeThreshold`, `context.windowSize`) — top-level `context` node | `README.md` § Configuration + `config.example.json` (the context-nudge ships as a `rules/` steer, not a hook — see `rules/zensu-conventions.md`) |
| Config resolution order, `ZENSU_CONFIG` precedence | `README.md` § Config Resolution Order + `hooks/lib/zensu-config.sh` (header comment) |
| Environment variables (`ZENSU_API_KEY`, `ZENSU_TDD_GATE`, `ZENSU_TEST_WITNESS`, `ZENSU_CHAIN`, `ZENSU_MCP_GATE`, `ZENSU_BASH_WRITE_GATE`, `ZENSU_AG_HOOK_CONTRACT`, `ZENSU_AG_STOP_BLOCKS`) | `README.md` § Environment Variables |
| TDD FSM details, phase transitions, gate logic, the hook pipeline | `docs/architecture.md` |
| Architecture: shim pipeline, write-gates, review chain, session-id resolution | `docs/architecture.md` |
| Hook scripts (what each does, when it fires) | `README.md` § Hooks table + `hooks/<script>.sh` source |
| Data flow, what's transmitted, retention, self-hosting | `README.md` § Data & Privacy |
| Pulse session lifecycle, idempotency, privacy guarantees | `skills/pulse/SKILL.md` + `README.md` § Data & Privacy |
| Resetting the auto-fix rounds counter / "max rounds reached" recovery | `skills/reset-review-limit/SKILL.md` + `hooks/post-review-tdd-delegate.sh` (convergence branch) |
| Workflow step order (new product / existing codebase / quick feature) | `README.md` § Typical Workflows |
| Greenfield vs brownfield vs hybrid; feature build-out stages (revisions) & fan-out | Core Glossary (above) + `agents/zensu-plm.md` § Decision Rules + `README.md` § Typical Workflows |
| "What changed in version X" | `CHANGELOG.md` (search for `[X.Y.Z]`) |
| License / Permitted Purpose / Competing Use | `README.md` § License + `LICENSE` file |
| Platform support, Windows caveats | `README.md` § Platform Support |
| What each enforcement mechanism does (blocking vs advisory) | `README.md` § Enforcement & capabilities + `docs/architecture.md` |
| Troubleshooting (`zensu` CLI not found, OAuth login, gate blocking) | `README.md` § Troubleshooting |

## Response Style

- Cite sources as `README.md:200` or `docs/architecture.md`.
- If the embedded glossary fully answers it → answer directly, no Read needed.
- If a routed source applies → `read` first, quote facts verbatim, cite.
- Never invent tool names, hook names, config flags, or version numbers — verify via `read`.
- If a question falls outside this skill's scope (e.g. "implement feature ZEN-42"), point the user at the right action skill instead of half-answering.
- Match the conversational register — terse if the user is terse, fuller if they ask "explain in detail".
