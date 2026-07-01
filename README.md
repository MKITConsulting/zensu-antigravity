# Zensu for Antigravity

![version](https://img.shields.io/badge/version-0.1.0-blue)
![host](https://img.shields.io/badge/host-Google%20Antigravity-blue)
![license](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)

`zensu-antigravity` is a faithful port of the
[`zensu-claude-code`](https://github.com/MKITConsulting/zensu-claude-code) plugin
(**v0.10.0** baseline; later upstream changes tracked per release in
[CHANGELOG.md](CHANGELOG.md)) to **Google Antigravity**'s native plugin system. It packages
the same behavior — feature tracking with `KEY-N` ids, strict RED→GREEN TDD behind a
phase-gated edit guard, a five-perspective code-review chain, security reviews with STRIDE
threat models, release-readiness gating, and greenfield/brownfield onboarding — as an
Antigravity plugin: a `plugin.json` manifest, `skills/`, `rules/`, `workflows/`, `agents/`,
and event hooks. Like upstream (post
[#117](https://github.com/MKITConsulting/zensu-claude-code/pull/117)), the plugin is
**CLI-driven** — it talks to Zensu through the typed [`zensu` CLI](https://zensu.dev)
(≥ 0.2.0); the hosted MCP server stays live for the Zensu web app's assistant but is **not
wired into the plugin** (`mcp_config.json` ships empty).

> **Status:** local plugin, not yet published. Install from this checkout with `install.sh`
> (see below).

## What is Zensu?

Zensu makes **features first-class citizens** across the whole lifecycle. Three layers:

- **Planning (WHAT):** bootstrap a greenfield product from a vision (`/zensu-bootstrap`), or
  scan an existing codebase to discover and import features (`/zensu-ghost-scan`) — or, for a
  brownfield repo that *also* ships a forward plan, run the hybrid (ghost-scan what is built,
  then add the plan's not-yet-built items as `planned` features). Each feature lands in Zensu
  with a security profile, journeys, tiers, and a v1 build-out baseline.
- **Implementation (HOW, securely):** strict RED→IMPL→GREEN TDD enforced by a phase-gated
  edit guard, followed by a five-perspective code-review chain and an auto-fix loop.
- **Tracking (HOW progress is measured):** the Zensu web dashboard — security scores, the
  tier matrix, journey health, coverage trends.

Feature IDs are `KEY-N` (e.g. `ZEN-42`, referenced in commits as `[ZEN-42]`); the lifecycle
is `planned → in-progress → testing → released`, gated by security score, docs completeness,
and journey health.

## Requirements

- **Google Antigravity** (IDE and/or the `agy` CLI)
- The `zensu` CLI ≥ 0.2.0 (`curl -fsSL https://zensu.dev/install.sh | sh`), authenticated
  with `zensu auth login`
- `node`, `bash`, `git`
- Windows: the hooks are bash and need Git Bash (not WSL, which the Windows host cannot see)

## Install

```bash
git clone https://github.com/MKITConsulting/zensu-antigravity
cd zensu-antigravity
bash install.sh          # stage the plugin into the IDE + CLI plugin paths
```

`install.sh` stages the whole plugin subtree into the Antigravity plugin directories,
renders `hooks.json` from `hooks.json.template` with absolute paths, seeds
`~/.zensu/config.json`, and writes the `~/.zensu/plugin-root` pointer. **Restart Antigravity**
so the rules, agents, skills, and hooks load. Uninstall with `bash install.sh --uninstall`.

## Authentication

The `zensu` CLI authenticates once and caches its token:

- **OAuth browser login (recommended):** `zensu auth login` opens your browser; tokens are
  cached and refreshed automatically.
- **API key (CI/CD):** `export ZENSU_API_KEY=zsk_...` then `zensu auth login` (see
  `zensu auth --help` for the non-interactive flags). Verify with `zensu auth status`.
- **Self-host:** point the CLI at your backend with `ZENSU_API_URL` or the `--api-url` flag.

## What you get

### The `zensu` CLI

The plugin drives Zensu through the typed `zensu` CLI — feature CRUD, security analysis, tier
management, user journeys, product bootstrap, ghost scans, pulse sessions, and more
(`zensu --help`). Every command takes `--json`; `zensu <noun> <verb> --help` documents its
flags. The hosted MCP server (`mcp.zensu.dev`) still serves the Zensu web app's own assistant
but is **not** wired into this plugin.

### Skills & Workflows

Each skill is invoked through its `/zensu-<name>` **workflow** shim (type the slash command;
the workflow loads the matching skill):

| Capability | User types |
|---|---|
| Strict TDD build (RED→GREEN + review chain) | `/zensu-tdd` |
| Implement a tracked feature end-to-end | `/zensu-implement` |
| Autopilot — idea → validated PR | `/zensu-autopilot` |
| Bootstrap a product (greenfield) | `/zensu-bootstrap` |
| Ghost scan (brownfield import) | `/zensu-ghost-scan` |
| Security review (classification, STRIDE, gate) | `/zensu-security-review` |
| Self-review (chain terminus) | `/zensu-self-review` |
| Plan review (multi-perspective, pre-code) | `/zensu-plan-review` |
| PR team review (multi-agent, on a GitHub PR) | `/zensu-pr-team-review` |
| PR fix findings (resolve review threads) | `/zensu-pr-fix-findings` |
| Pulse (developer journal) | `/zensu-pulse` |
| Reset the auto-fix round counter | `/zensu-reset-review-limit` |
| Zensu Q&A / glossary | `/zensu-help` |

### Subagents (3)

| Agent | Role |
|---|---|
| **zensu-plm** | Product Lifecycle Manager — orchestrates all `zensu` CLI workflows (feature tracking, security reviews, release readiness, bootstrap, ghost scans). |
| **zensu-code-reviewer** | Read-only quality review. Standalone: walks 5 specialist perspectives (conventions, bugs, architecture, tests, security). In the `/zensu-tdd` chain: runs in fan-out consume mode, surfacing the report merged from five parallel `zensu-review-aspect` agents. Write-free tool list. |
| **zensu-review-aspect** | Single-perspective read-only reviewer. The `/zensu-tdd` chain spawns five in one parallel batch (one per perspective), then merges in the main thread. Runs zero build/test commands. |

> **Subagent fidelity.** If Antigravity exposes a first-class plugin subagent format, these
> run as isolated subagents. If it does not, each agent body is followed as orchestrator
> prose — the main agent adopts the persona inline (sequential persona adoption) and the
> review fan-out runs as sequential self-review passes. Findings parity is preserved;
> wall-clock and context isolation are not.

### Rules (always-on steering)

Antigravity has no SessionStart / UserPromptSubmit hook events, so upstream's advisory hooks
migrate to always-on `rules/` (declared in `plugin.json`):

| Rule | What it steers |
|---|---|
| `rules/zensu-conventions.md` | The constitution — what Zensu is (KEY-N ids, lifecycle), the routing rule (product/feature/roadmap requests → the `zensu-plm` agent + project-context triage), and the context-compaction nudge (propose `/compact` when context gets large). |
| `rules/zensu-tdd.md` | Plan first, then ask whether to run `/zensu-tdd` before the first code edit; vanilla-vs-strict; finish the review chain. |
| `rules/zensu-write-gate.md` | Why state-mutating `zensu` commands are default-denied outside a workflow (a convention nudge, not a security boundary); reads run free. |

### Hooks (7)

Engine-neutral hook scripts wired through the shim (`hooks/antigravity/antigravity-shim.sh`),
which translates the Antigravity payload + verdict contract. Wrapped scripts:

| Hook script | Event | Role |
|---|---|---|
| `pre-edit-tdd-reminder.sh` | PreToolUse (file-edit writers) | TDD phase-gate — blocks edits that violate the RED→IMPL→GREEN FSM while a session is armed. |
| `pre-bash-zensu-gate.sh` | PreToolUse (`run_command`) | Zensu CLI write-gate — default-denies state-mutating `zensu` commands outside a workflow window or the `zensu-plm` agent; reads pass. |
| `pre-bash-source-write-gate.sh` | PreToolUse (`run_command`) | Source-write integrity gate — denies raw shell writes that clobber a tracked source file or escape the session root into a sibling checkout. |
| `user-prompt-intent-router.sh` | PreInvocation | Product-planning intent router — steers keyword-bearing prompts to the `zensu-plm` triage instead of raw CLI calls. |
| `user-prompt-tdd-reminder.sh` | PreInvocation | Per-turn TDD reminder — asks whether to run `/zensu-tdd` before the first edit on a direct code request (honors prior preference, including the multilingual fast-path literals). |
| `post-bash-witness.sh` | PostToolUse (`run_command`) | Test-run witness — records each command (exit code, stdout tail) as the evidence channel the Phase 6 audit cross-checks. |
| `stop-chain-enforcer.sh` | Stop | Review-chain backstop — holds the turn open until the review chain and `/zensu-self-review` complete. |

The PreInvocation array re-fires before every model step, so the shim de-bounces identical
advisory context per user turn. Upstream's `context-nudge` hook is intentionally unwired (its
essence lives in `rules/zensu-conventions.md`).

## Configuration (`~/.zensu/config.json`)

Seeded from [`config.example.json`](config.example.json). `hooks.*` toggles
(`tddImplementation`, `intentRouter`, `tddReminder`, `mcpGate`, `bashWriteGate`, `autoFix`,
`autoFixMaxRounds`, `selfReview`, `chainEnforcer`, …), `context.compactionNudge` /
`context.nudgeThreshold`, and `logging.timestampStyle` (`wall|relative|none`). Env escape
hatches: `ZENSU_TDD_GATE=off`, `ZENSU_MCP_GATE=off`, `ZENSU_BASH_WRITE_GATE=off`,
`ZENSU_CHAIN=off`, `ZENSU_TEST_WITNESS=off`.

`hooks.tddImplementation:false` (the **default — vanilla**) switches `/zensu-tdd` to vanilla
implementation mode: no RED→GREEN ceremony, the edit gate passes through, tests at the
agent's discretion — but the evidence audits and the review chain stay enforced. Set
`true` for the strict RED→GREEN gate. The mode is frozen per session at `--tdd-begin`.

## Claude Code → Antigravity fidelity matrix

| Upstream (CC) mechanism | Antigravity expression | Fidelity |
|---|---|---|
| Plugin packaging (`.claude-plugin/` + marketplace) | native `plugin.json` at repo root, staged by `install.sh` | **FULL** |
| Skills (colon-namespaced slash commands) | `/zensu-<name>` workflow shim → loads the skill | **FULL** |
| `Bash` tool gates | `run_command` matcher | **FULL** |
| Edit/Write phase-gate | `write_to_file\|replace_file_content\|multi_replace_file_content` matcher | **FULL** |
| TDD phase-gate (PreToolUse deny) | deny verdict via the shim's verdict contract | **FULL** |
| Zensu CLI write-gate | `run_command` gate + CLI-map classification | **FULL** |
| Source-write gate (tracked-file clobber) | `run_command` gate on `tool_input.command` + `cwd` | **FULL** |
| Source-write gate (cross-worktree escape) | shim exports `ZENSU_PROJECT_DIR` from the workspace root | **FULL** |
| Review auto-fix loop + Stop chain enforcement | Stop hook via the shim | **FULL** |
| 3 subagents | `agents/zensu-*.md` (native subagent format, or orchestrator prose) | **FULL → DEGRADED** if no first-class plugin subagent format (sequential persona adoption; findings parity kept) |
| `marketplace.json` version sync | **N/A** — no marketplace; version lives in `plugin.json` + README badge + CHANGELOG (D8) | **N/A** |
| `${ZENSU_PLUGIN_ROOT}` hook wiring | `install.sh` renders absolute paths into `hooks.json`; libs resolve via `~/.zensu/plugin-root` | **FULL** |
| SessionStart banner / primer | migrated to always-on `rules/` | **DEGRADED** (always-on prose, not a per-start event) |
| SessionStart pulse / session-id capture | lazy first-call init (no SessionStart event) | **DEGRADED** (lazy, not at start) |
| UserPromptSubmit intent-router / TDD-reminder | PreInvocation hooks via the shim (de-bounced per turn) | **FULL** (pending PreInvocation host verification) |
| ExitPlanMode plan-approval TDD ask | replaced by the PreInvocation TDD-reminder + `rules/zensu-tdd.md` | **DEGRADED by design** (no plan-approval event) |
| Context-compaction nudge | unwired hook; essence folded into `rules/zensu-conventions.md` | **DEGRADED** (advisory rule, no transcript read) |
| Hosted MCP server | intentionally unwired (`mcp_config.json` empty) — CLI-driven | **N/A by design** |

## Versioning & releases

The version lives in three places that must carry the same value in the same commit:
`plugin.json`, the README `version-X.Y.Z-blue` badge, and the newest `## [X.Y.Z]` CHANGELOG
heading (commit subject `chore(release): bump version to X.Y.Z`). There is **no
`marketplace.json`** — Antigravity has no marketplace manifest, the one simplification over
upstream. See [AGENTS.md](AGENTS.md) for the full convention.

## Repository layout

```
zensu-antigravity/
├── plugin.json              # native manifest (root)
├── hooks.json.template      # tracked; install.sh renders → hooks.json (gitignored, abs paths)
├── mcp_config.json          # empty {"mcpServers":{}} — MCP intentionally unwired
├── agents/                  # zensu-plm, zensu-code-reviewer, zensu-review-aspect
├── rules/                   # always-on steering (conventions, tdd, write-gate)
├── skills/                  # skills/<verb>/SKILL.md ×13
├── workflows/               # /zensu-<name>.md shims ×13
├── hooks/                   # hook scripts + libs + hooks/antigravity/antigravity-shim.sh
├── tests/                   # structure/ + run-all.sh
├── evals/                   # config-gate offline matrix
├── install.sh               # stage plugin, render hooks.json, seed config + pointer
├── config.example.json      # ~/.zensu/config.json template
├── CHANGELOG.md · AGENTS.md · CONTRIBUTING.md · SECURITY.md · CODE_OF_CONDUCT.md · LICENSE
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `zensu` CLI not found | Install it (`curl -fsSL https://zensu.dev/install.sh \| sh`) and ensure it is on `PATH`. |
| Backend unreachable | Verify network to `https://api.zensu.dev` (or your `ZENSU_API_URL`) and that `zensu auth status` shows a logged-in session. |
| Hooks not firing after install | Restart Antigravity — the plugin loads at startup, and `hooks.json` is regenerated by `install.sh` with absolute paths. |
| A steering behavior is missing | Some SessionStart/UserPromptSubmit behaviors are now always-on `rules/` (see the fidelity matrix), not per-event hooks. |
| TDD phase gate blocking a legitimate edit | Set `ZENSU_TDD_GATE=off` for that edit, or declare the correct phase via `zensu-log.sh --phase <PHASE> --step <id>` first. |

## License

**Functional Source License, Version 1.1, Apache 2.0 Future License**
([FSL-1.1-Apache-2.0](LICENSE)). Source-available; each release converts to Apache 2.0 on its
second anniversary. The full text and FAQ live at [fsl.software](https://fsl.software/). For
commercial-use questions outside the Permitted Purpose, contact
[contact@zensu.dev](mailto:contact@zensu.dev).
