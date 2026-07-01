# zensu-antigravity — Master Implementation Plan

Authoritative build spec for the **4th port** of the Zensu Product Lifecycle
Manager plugin. Synthesizes six facet plans + the grounding brief. Build the
plugin from this file top-to-bottom (§7). English-only. Conventional Commits.

---

## 1. Overview

**What.** A native **Google Antigravity** plugin (`plugin.json` + `skills/` +
`rules/` + `workflows/` + `agents/` + event hooks) that delivers the same
behavior as `zensu-claude-code` (CC): feature tracking, strict RED→GREEN TDD with
a phase-gated edit guard, a 5-perspective review chain, security reviews,
release-readiness gating, greenfield/brownfield onboarding. New repo at
`~/IdeaProjects/dev.zensu/zensu-antigravity/`.

**Why / family context.** Fourth in the line CC → codex → kiro → **antigravity**.
Like CC post-#117, the plugin drives Zensu through the typed `zensu` CLI (≥ 0.2.0);
the hosted MCP server stays live for the Zensu web app but is **not wired** here (D6).

**Target.** Antigravity = Gemini-3 agentic IDE (VS Code/Windsurf fork) + `agy` CLI.
Install path `~/.gemini/config/plugins/zensu/` (IDE) + `~/.gemini/antigravity-cli/plugins/zensu/` (CLI).

**Headline fidelity stance.** The FULL-fidelity core — TDD phase-gate, CLI +
source write-gates, post-bash witness, the TDD FSM, session-id resolution —
transplants intact because it rides PreToolUse/PostToolUse + engine-neutral libs
behind a single shim. DEGRADEs cluster exactly where CC leaned on host
capabilities Antigravity lacks or hasn't confirmed: **UserPromptSubmit**,
**SessionStart**, **ExitPlanMode**, and a hard-blocking **Stop**. This is the same
degrade profile as codex, with kiro-style shim + pointer-first session handling on
top. Antigravity is strictly *better than codex* on one axis (PreToolUse deny is
real → phase-gate FULL) and is best-positioned of the three non-CC ports.

---

## 2. Architecture

**Skeleton = Codex-like, plugin at REPO ROOT (D1); hooks = one thin shim (D2).**
Every wrapped hook script stays **byte-comparable to CC** — it reads CC-flat
snake_case payload keys and emits the CC `hookSpecificOutput` schema. The shim
(`hooks/antigravity/antigravity-shim.sh`) is the ONE file that knows Antigravity's
stdin shape AND its stdout/exit contract. This quarantines the [AMBIGUOUS] contract
to a single file; verifying/pinning later = editing the `emit_*` helpers + flipping
one env default.

### Hook flow (Antigravity → verdict)

```
                          (one absolute-path command per hook in hooks.json)
Antigravity host                          ┌──────────────────────────────────────────┐
(IDE / agy CLI)                           │  hooks/antigravity/antigravity-shim.sh     │
  fires PreToolUse /                       │  $1 = wrapped script name (kiro pattern)   │
  PostToolUse /                            │                                            │
  PreInvocation /     ── stdin JSON ──▶    │ 0. export CLAUDE_PLUGIN_ROOT/ZENSU_…ROOT   │
  Stop                (camelCase,          │    + CLAUDE_PROJECT_DIR=workspacePaths[0]  │
                       nested toolCall.*)  │ 1. lazy-init.sh  (first pre-* call only:   │
                                           │      pin ~/.zensu/plugin-root, capture sid)│
                                           │ 2. normalize-payload.js                    │
                                           │      toolCall.name        → tool_name      │
                                           │      args.CommandLine     → tool_input.command
                                           │      args.TargetFile      → tool_input.file_path
                                           │      args.Cwd             → cwd (command cwd)
                                           │      session_id,transcriptPath passthrough │
                                           │      (fail-open: parse error → raw payload)│
                                           │ 3. run wrapped CC-schema script  ──────────┼──▶ hooks/<script>.sh
                                           │      (emits CC hookSpecificOutput /        │     (byte-identical to CC;
                                           │       decision:block / additionalContext)  │      reads normalized keys)
                                           │ 4. classify stdout →                       │◀── CC-schema stdout
                                           │      deny | context | block | raw          │
                                           │      (CONTEXT de-bounced per turn, BK5)     │
                                           │ 5. emit-verdict.js (ZENSU_AG_HOOK_CONTRACT)│
   verdict JSON  ◀── top-level JSON ─────  │      default superset (PROBE; pin via V1): │
   (allow_tool / decision)   + exit 0      │      {"allow_tool":false,"deny_reason":…} │
                                           │      AND {"decision":"deny","reason":…}    │
                                           │      always exit 0 (2 only if contract=exit)│
                                           └──────────────────────────────────────────┘
```

### Resolved seams — decisions table (BAKED IN, do not re-open)

| Seam | Decision |
|---|---|
| **Skeleton (D1)** | Plugin at repo root: `plugin.json`, `skills/`, `rules/`, `agents/`, `workflows/`, `hooks/`, `hooks.json`(generated) at root. No `.codex-plugin/` wrapper, no `marketplace.json`. |
| **Shim (D2)** | `hooks/antigravity/antigravity-shim.sh` = single contract-quarantine layer: RESHAPE stdin → CC flat snake_case; CLASSIFY wrapped CC stdout (deny/context/block/raw); EMIT top-level Antigravity JSON via `emit-verdict.js`. Default `ZENSU_AG_HOOK_CONTRACT=superset` — a **PROBE** (emit both shapes), **pinned to the single accepted flavor before any reliance** (MJ2/V1); **always exit 0** (verdict at top level, NOT `hookSpecificOutput`). Switch ∈ {superset, allow_tool, decision, exit}. Separate knob `ZENSU_AG_STOP_BLOCKS` (default `0`) governs the BLOCK branch: `1` → emit the Antigravity Stop-block shape, `0` → emit the directive as advisory context. The CONTEXT branch de-bounces per user turn (BK5). Fail-open everywhere. |
| **Events (D3)** | PreToolUse + PostToolUse + Stop = direct. PreInvocation = confirmed, injects context → **2** advisory hooks (intent-router, tdd-reminder) live here; **context-nudge ships unwired** (reads a CC-specific transcript schema AG won't match — MN4) with its essence folded into `rules/zensu-conventions.md`. SessionStart = **confirmed unavailable** to plugin hooks.json → banner/primer migrate to `rules/`; pulse + session-id become **lazy first-call init** fired by the shim on the first pre-* hook. |
| **Tool names (verified)** | shell `run_command` (`CommandLine`,`Cwd`); file writers `write_to_file` / `replace_file_content` / `multi_replace_file_content` (`TargetFile`). Edit-matcher canonical and exact: `write_to_file\|replace_file_content\|multi_replace_file_content` — no `Edit\|Write\|MultiEdit`, no non-existent `create_file\|edit_file`. `multi_replace_file_content` must NOT be dropped (multi-block edits would bypass the phase-gate). MCP unwired (D6). |
| **Session-id** | Payload-first (`session_id`) then kiro pointer-first synthesis with a **deterministic** synth id `ag-$(zensu_session_key)` (PPID-based, stable across the turn's hook subprocesses) + `.zensu/state/session-id-current.txt`. Port kiro `zensu-session.sh` verbatim; synth prefix lives in `session-start-capture-sid.sh`. |
| **Auto-fix loop (D5)** | Default **Scenario B** (skill-prose self-loop, Codex parity). Keep `post-review-tdd-delegate.sh` as a kept-but-unwired file; `hooks.json.template` ships **NO** PostToolUse subagent-completion entry (MJ5). Document Scenario A (subagent-completion PostToolUse) as the one-line upgrade if that event is verified. |
| **Plan-mode (D3/D4)** | `plan-approved-delegate.sh` DROPPED (no ExitPlanMode) → kept-but-unwired; essence → `rules/zensu-tdd.md` steering + the workflow asks up-front. |
| **Invocation (D4)** | `/zensu-<name>` via thin `workflows/zensu-<name>.md` loaders; heavy prose in `skills/<verb>/SKILL.md`. Default ship BOTH; collapse only if skills prove directly `/`-invocable. |
| **Versioning (D8)** | `plugin.json` + README badge + CHANGELOG move together. **NO `marketplace.json`.** Port `release.yml` from codex (drop the marketplace lines). |
| **Install (D7)** | `install.sh`+`install.ps1` stage the plugin subtree into both plugin dirs, render `hooks.json` from tracked `hooks.json.template` (`__ZENSU_HOME__`→literal absolute paths), seed `~/.zensu/config.json`, write `~/.zensu/plugin-root`. |
| **MCP (D6)** | Unwired. Ship present-but-empty `mcp_config.json` (`{"mcpServers":{}}`); no `mcp` key in `plugin.json`. |
| **Language** | English-only; German allowed ONLY as the sanctioned TDD-preference match-literals inside hook scripts (lockstep across strict + vanilla variants). |

---

## 3. Final repo tree (build manifest)

```
zensu-antigravity/
├── plugin.json                          # REQUIRED manifest (root); §4a
├── hooks.json.template                  # TRACKED; __ZENSU_HOME__ placeholders; install renders → hooks.json; §4b
├── hooks.json                           # GENERATED by install (abs paths) — GITIGNORED
├── mcp_config.json                      # D6: {"mcpServers":{}} (documents "intentionally unwired")
├── config.example.json                  # ~/.zensu/config.json template (vanilla default); §4a
├── cliff.toml                           # git-cliff config — verbatim from CC
├── CHANGELOG.md                         # Keep-a-Changelog; seed ## [0.1.0]; §4a
├── README.md                            # full docs + fidelity matrix; §4a outline
├── AGENTS.md                            # repo conventions (English-only, D8 versioning, PR workflow, CLI-class invariant); §4a
├── SECURITY.md                          # MJ7: verbatim from CC (disclosure contact unchanged)
├── CODE_OF_CONDUCT.md                   # MJ7: verbatim from CC
├── CONTRIBUTING.md                      # MJ7: adapt for /zensu-<name> invocation + AG test command
├── LICENSE                              # FSL-1.1-Apache-2.0 — verbatim from CC
├── install.sh                           # POSIX-bash installer; §4f
├── install.ps1                          # Windows → Git Bash → install.sh; §4f
├── .gitignore                           # ignores hooks.json + .zensu/state + witness logs + tests/results; §4a
├── .gitattributes                       # *.sh + hooks.json.template eol=lf
│
├── skills/                              # §4e — 13 skills (bare-verb dirs)
│   ├── autopilot/SKILL.md
│   │   └── rules/{auth,config,drivers,probe}.md   # skill-LOCAL reference docs (NOT plugin rules)
│   ├── bootstrap/SKILL.md
│   ├── ghost-scan/SKILL.md
│   ├── implement/SKILL.md
│   ├── plan-review/SKILL.md
│   ├── pr-fix-findings/SKILL.md
│   ├── pr-team-review/SKILL.md
│   │   └── rules/{workflow,reviewer-personas,github-publish}.md   # skill-LOCAL
│   ├── pulse/SKILL.md
│   ├── reset-review-limit/SKILL.md
│   ├── self-review/SKILL.md
│   ├── security-review/SKILL.md
│   ├── tdd/SKILL.md                     # densest edit target
│   └── zensu-help/SKILL.md
│
├── workflows/                           # §4e — 13 thin /-triggered loaders → skill
│   ├── zensu-autopilot.md  zensu-bootstrap.md  zensu-ghost-scan.md  zensu-implement.md
│   ├── zensu-plan-review.md  zensu-pr-fix-findings.md  zensu-pr-team-review.md  zensu-pulse.md
│   ├── zensu-reset-review-limit.md  zensu-self-review.md  zensu-security-review.md
│   └── zensu-tdd.md  zensu-help.md
│
├── agents/                              # §4e — 3 subagents (markdown+frontmatter; D5)
│   ├── zensu-plm.md
│   ├── zensu-code-reviewer.md
│   └── zensu-review-aspect.md
│
├── rules/                               # §4e — 3 plugin-level always-on steering files (D3)
│   ├── zensu-conventions.md             # constitution: primer + intent-router + banner essence
│   ├── zensu-tdd.md                     # tdd-reminder + plan-decision essence (the #1 D3 migration)
│   └── zensu-write-gate.md              # why mutations are gated (rationale only)
│
├── hooks/                               # §4b/c/d
│   ├── antigravity/                     # Antigravity-ONLY new files
│   │   ├── antigravity-shim.sh          # D2 single translation layer
│   │   ├── normalize-payload.js         # Antigravity payload → CC flat snake_case
│   │   ├── emit-verdict.js              # superset top-level verdict emitter (the contract core)
│   │   └── lazy-init.sh                 # SessionStart replacement (pin root + capture sid)
│   ├── lib/                             # engine-neutral; copied BYTE-IDENTICAL to CC (root-header NOT widened — BK9)
│   │   ├── zensu-tdd-phase.sh           # phase FSM
│   │   ├── zensu-log.sh                 # TDD evidence FSM → .zensu/state/rounds-<sid>.json
│   │   ├── zensu-config.sh              # ~/.zensu/config.json reader
│   │   ├── zensu-session.sh             # FROM KIRO (pointer-first precedence)
│   │   ├── zensu-cli-map.sh             # zensu <noun> <verb> → tool name (byte-identical)
│   │   ├── zensu-mcp-tools.sh           # read/mutation SoT (byte-identical)
│   │   ├── zensu-agent-context.sh       # spawned-agent detection (verbatim)
│   │   ├── zensu-runtime.sh             # FROM CODEX/KIRO (NOT CC); cwd→CLAUDE_PROJECT_DIR (+1 workspacePaths[0] line; root chain widened here)
│   │   ├── resolve-session-id.js        # transcript helper (inert on AG-only; kept)
│   │   └── bash-source-write-parse.js   # source-write parser (byte-identical)
│   ├── pre-edit-tdd-reminder.sh         # phase-gate (port CODEX multi-file variant)
│   ├── pre-bash-zensu-gate.sh           # CLI write-gate (port CC; first port to carry it)
│   ├── pre-bash-source-write-gate.sh    # source integrity gate (port CC; first port to carry it)
│   ├── post-bash-witness.sh             # witness log (port CODEX variant)
│   ├── post-review-tdd-delegate.sh      # auto-fix loop — KEPT-BUT-UNWIRED (Scenario B)
│   ├── stop-chain-enforcer.sh           # Stop backstop (port KIRO if Stop blocks, else CODEX)
│   ├── session-start-capture-sid.sh     # FROM KIRO, 1-line synth-prefix edit (only session-* kept)
│   ├── user-prompt-intent-router.sh     # → PreInvocation (verbatim)
│   ├── user-prompt-context-nudge.sh     # KEPT-BUT-UNWIRED (MN4); essence → rules/zensu-conventions.md
│   ├── user-prompt-tdd-reminder.sh      # → PreInvocation (verbatim; carries plan-approval TDD essence)
│   └── plan-approved-delegate.sh        # KEPT-BUT-UNWIRED (no ExitPlanMode); reused by /zensu-implement
│
├── reference/                           # READ-ONLY upstream CC source-of-truth (port provenance; tracked, English)
│
├── evals/                               # §4g — BK8: ported deterministic offline gate
│   └── config-gate/                     # ~55 pure-bash, no-API tests (phase-gate matrix, log-FSM, autofix counter, config-merge, helpers)
│       └── run-eval.sh                  # invoked as `run-eval.sh --self-check` by tests/run-all.sh; root-header byte-identical (BK9)
│
├── tests/                               # §4g
│   ├── run-all.sh                       # deterministic gate (family template; calls evals/config-gate --self-check)
│   ├── run-promptfoo.sh                 # STUB: hard-exit "headless agy unverified — see #H1"
│   ├── results/                         # GITIGNORED
│   └── structure/                       # ~55 pure-bash tests (§4g list)
│
└── .github/workflows/
    ├── ci.yml                           # on push/PR → bash tests/run-all.sh (ubuntu, node 20)
    └── release.yml                      # ported from codex; drop marketplace.json lines
```

`hooks/session-start-banner.sh` / `-primer.sh` / `-pulse.sh` are **NOT ported** —
banner+primer → `rules/`; pulse side-effect → `lazy-init.sh`.

---

## 4. Component specs

### 4a. Manifest + meta-files (Facet 1)

**`plugin.json`** — root manifest. Keys: `name:"zensu"`, `version:"0.1.0"`,
`description`, `author`, `repository`, `license:"FSL-1.1-Apache-2.0"`,
`keywords:[…,"antigravity"]`,
`agents:["./agents/zensu-plm.md","./agents/zensu-code-reviewer.md","./agents/zensu-review-aspect.md"]` (BK2),
`skills:[./skills/<verb> ×13]`,
`rules:["./rules/zensu-conventions.md","./rules/zensu-tdd.md","./rules/zensu-write-gate.md"]` (BK3),
`workflows:[./workflows/zensu-*.md ×13]`, `hooks:"./hooks.json"` (string ref).
Arrays for skills/rules/agents/workflows (confirmed AG shape); string for hooks.
**Risk (V6):** if the loader rejects an unverified key, drop *that key only* — the
conventionally-named files stay and discovery still works; never drop `skills`/`rules`.

| Meta-file | Port mode | Key content |
|---|---|---|
| `README.md` | adapt from codex/kiro skeleton | version+host+license badges (`-blue`); one-para fidelity framing (faithful port of zensu-claude-code v0.10.0 baseline, CLI-driven, MCP unwired); sections incl. NEW **Rules** + **Workflows**; the **CC→Antigravity mapping & fidelity matrix** (§6). |
| `CHANGELOG.md` | seed by hand | Keep-a-Changelog header + `## [Unreleased]` + hand-written `## [0.1.0] - 2026-06-30` (initial port; native manifest, 13 skills, 3 agents, shim, rules-replace-SessionStart, workflow shims, install.sh, CLI-driven). |
| `LICENSE` | **verbatim** from CC | FSL-1.1-Apache-2.0, `Copyright 2026 Zensu` (3720-byte). |
| `cliff.toml` | **verbatim** from CC | engine-neutral; `tag_pattern=v[0-9].*`. |
| `config.example.json` | from CC (vanilla variant) | `hooks.{autoTdd:true, tddImplementation:false, chainEnforcer, autoFix, autoFixIncludeSuggestions:false, autoFixMaxRounds:5, combinedSummary, selfReview, pulseSession, sessionBanner, intentRouter, tddReminder, mcpGate, bashWriteGate:true}` (MN6 — `bashWriteGate` added for discoverability; honored by `pre-bash-source-write-gate.sh`; absent → default-enabled, behavior unchanged) + `context.{compactionNudge,nudgeThreshold:50}` + `logging.timestampStyle:"wall"`. Keys kept verbatim so `zensu-config.sh` ports unchanged even where the behavior migrated to rules. |
| `.gitignore` | from CC, simplified | ignore `/hooks.json`, `.zensu/*` (keep `!.zensu/config.json`), `.zensu/state/`, `.zensu/logs/witness-*.log`, `**/.zensu/state/`, `tests/results/`, node_modules, `*.zensu-backup.*`, `*.log`. |
| `.gitattributes` | from CC | `*.sh text eol=lf` + `hooks.json.template text eol=lf`. |
| `AGENTS.md` | adapt from codex/kiro | header (AG port of CC); **English-only** + the multilingual carve-out; Conventional Commits; parity-with-upstream; **architecture invariants** (shim is the only translator; rules-not-hooks for missing events; hooks.json generated+gitignored, edit template; root chain widened ONLY on top-level `hooks/*.sh` + `zensu-runtime.sh` — libs byte-identical, BK9; chain `CLAUDE_PLUGIN_ROOT\|CODEX_PLUGIN_ROOT\|ANTIGRAVITY_PLUGIN_ROOT\|ZENSU_PLUGIN_ROOT` → `~/.zensu/plugin-root`); **D8 version-bump invariant** (3 files, no marketplace); tests = `bash tests/run-all.sh`; **CLI-class invariant** (`zensu-mcp-tools.sh` is read/mutation SoT, moves with `zensu-cli-map.sh`). |
| `SECURITY.md` | **verbatim** from CC (MJ7) | vulnerability disclosure policy; disclosure contact unchanged. |
| `CODE_OF_CONDUCT.md` | **verbatim** from CC (MJ7) | Contributor Covenant. |
| `CONTRIBUTING.md` | adapt from CC (MJ7) | swap invocation to `/zensu-<name>`; test command `bash tests/run-all.sh`. |

`OSS_READINESS_REPORT.md` is **consciously dropped for v1** (CC-specific point-in-time
snapshot; regenerate later if needed).

### 4b. Shim + hooks.json + lib reuse + event map (Facet 2)

**`antigravity-shim.sh`** — pseudocode in Facet 2 §1.4. `set -u`; resolves ROOT,
exports `CLAUDE_PLUGIN_ROOT`+`ZENSU_PLUGIN_ROOT`; **exports `CLAUDE_PROJECT_DIR` from
`workspacePaths[0]`** (the stable workspace root) BEFORE `zensu_runtime_apply_project_dir`
— the command cwd is carried separately as the normalized `cwd` (BK6, see §4c).
`SCRIPT="$ROOT/hooks/$1"` where `$1`=**bare script name** (kiro pattern; the template
emits no path component); empty/missing script or missing `node` → exit 0; reads raw
stdin; runs `normalize-payload.js` (fail-open to raw); fires `lazy-init.sh` on the first
pre-* hook; runs wrapped script in a `mktemp -d` capture dir; classifies stdout via
inline `node -e` → `deny|context|block|raw`; calls `emit-verdict.js`; **always exit 0**
(exit 2 only when `CONTRACT=exit` on deny); raw branch passes stdout/stderr through but
**never** surfaces the wrapped script's exit code (a crashed hook must not become an
accidental deny).

**CONTEXT-branch per-turn de-bounce (BK5).** PreInvocation fires before **every** model
step, not once per user turn; without a guard the advisory hooks re-inject their
directives on every tool round. The CONTEXT branch hashes `(wrapped-script-name +
emitted-context)` into `.zensu/state/preinv-<sid>.txt` and **suppresses re-emit** of an
identical `(script,context)` pair until the turn marker changes. Pinned by
`test-preinvocation-debounce.sh`.

**Stop knob (MJ8b).** `ZENSU_AG_STOP_BLOCKS` (default `0`) is honored in the BLOCK
branch: `1` → emit the Antigravity Stop-block shape; `0` → emit the directive as
advisory context. Pinned by `test-antigravity-shim-stop.sh`.

**Classification map** (wrapped CC stdout → verdict):

| Wrapped CC stdout | Verdict | Emission (default superset) | Exit |
|---|---|---|---|
| `hookSpecificOutput.permissionDecision:"deny"` (+Reason) | DENY | `{allow_tool:false, deny_reason} + {decision:"deny", reason}` | 0 (2 if `exit`) |
| `hookSpecificOutput.additionalContext:C` | CONTEXT | `{allow_tool:true, decision:"allow", additionalContext:C}` — **de-bounced per turn (BK5)** | 0 |
| `decision:"block"` (+reason) | BLOCK | `ZENSU_AG_STOP_BLOCKS=1` → `{decision:"block", reason, allow_tool:false, deny_reason}`; `=0` (default) → emit `reason` as advisory context (MJ8b) | 0 |
| else / empty / non-JSON / crash | RAW | passthrough, fail-open | 0 |

**`emit-verdict.js`** — sole home of the output schema (Facet 2 §1.5). `ROLE` ∈
deny/context/block, `TEXT`, `CONTRACT`. superset = `Object.assign` of both shapes.
30-line unit under test; pin is a one-symbol change.

**`normalize-payload.js`** — the real wiring work (Facet 2 §5.3). Maps:
`toolCall.name`→`tool_name`; `toolCall.args.CommandLine`→`tool_input.command`;
`toolCall.args.{TargetFile|AbsolutePath|FilePath}`→`tool_input.file_path`;
`toolCall.args.ToolName` kept; `session_id`,`transcriptPath|transcript_path`,
`hook_event_name` passthrough; `toolCall.args.Cwd`→`cwd` (the **command cwd only** —
the workspace root is exported as `CLAUDE_PROJECT_DIR` by the shim, BK6; do NOT fold
`workspacePaths[0]` into `cwd`); prompt field (multi-key probe
`prompt|userMessage|ephemeralMessage`)→`prompt` (**field name pinned by the
PreInv-prompt live probe**); PostToolUse result (multi-key probe `Output|stdout|result`)
→`tool_response.stdout`, exit→`tool_response.exit_code`, plus `interrupted` (BK7b —
best-effort; the Phase-6 audit fails loud if `tail=` stays empty while a TDD session is
active); `<agent id/type>`→`agent_id`/`agent_type`. Fail-open.

**`lazy-init.sh`** — SessionStart replacement (Facet 2 §3.1). Idempotent; pins
`~/.zensu/plugin-root` if changed; delegates to `session-start-capture-sid.sh`
(writes keyed cache + `session-id-current.txt` pointer). Cheap no-op after first call.

**Lib reuse** (10 files): all engine-neutral. **Root headers are NOT widened** (BK9) —
the libs copy **byte-identical to CC** (`: "${CLAUDE_PLUGIN_ROOT:=$(cd "$(dirname
"$0")/../.." && pwd)}"`), preserving a clean `git diff` against CC; the shim exports the
root before sourcing, so libs self-resolve. The `ANTIGRAVITY_PLUGIN_ROOT` widening lives
ONLY on the top-level `hooks/*.sh` (one-level `dirname/..`) + `zensu-runtime.sh`.
`zensu-session.sh` comes **from kiro** (pointer-first precedence: explicit id →
`session-id-current.txt` → transcript helper(inert) → `$PPID` cache). `zensu-runtime.sh`
comes **from codex/kiro** (not CC), +1 line for `workspacePaths[0]` fallback.
`session-start-capture-sid.sh` from kiro with a **deterministic** synth prefix
`kiro-…`→`ag-$(zensu_session_key)` (MJ3 — PPID-based, stable across the turn's hook
subprocesses; replaces the `$$`-unstable `ag-$(date +%s)-$$`).

**`hooks.json.template`** (Facet 2 §2 — verbatim with `__ZENSU_HOME__`; install
renders to abs paths). Top-level = named labels; each `command` is
`bash __ZENSU_HOME__/hooks/antigravity/antigravity-shim.sh <bare-script>.sh` (BK1 — the
`$1` token is a **bare script name**, no `/`; the shim resolves `$ROOT/hooks/$1`).

| Label | Event | Matcher | Wrapped scripts (in order) | timeout |
|---|---|---|---|---|
| zensu-pre-tool | PreToolUse | `write_to_file\|replace_file_content\|multi_replace_file_content` (BK4 — exact; no defensive aliases) | pre-edit-tdd-reminder.sh | 30 |
| zensu-pre-tool | PreToolUse | `run_command` | pre-bash-zensu-gate.sh, pre-bash-source-write-gate.sh | 30 |
| zensu-pre-invocation | PreInvocation | (none) | user-prompt-intent-router.sh, user-prompt-tdd-reminder.sh | 10 |
| zensu-post-tool | PostToolUse | `run_command` | post-bash-witness.sh | 10 |
| zensu-stop | Stop | (none) | stop-chain-enforcer.sh | 15 |

PreInvocation/Stop carry **no matcher** (ignored for those events). The PreInvocation
array is **2** scripts — `user-prompt-context-nudge.sh` ships **unwired** (MN4; CC-specific
transcript schema). **No** Scenario-A PostToolUse subagent-completion entry is shipped by
default (MJ5); it is documented prose for the one-line upgrade only.

**Event map — every CC hook:**

| CC hook (event) | → Antigravity |
|---|---|
| session-start-banner (SessionStart) | rules/ |
| session-start-primer (SessionStart) | rules/ + lazy-init |
| session-start-pulse (SessionStart) | lazy-init.sh side-effect |
| user-prompt-intent-router (UPS) | PreInvocation (shim → additionalContext, de-bounced) |
| user-prompt-context-nudge (UPS) | **unwired** (MN4); essence → rules/zensu-conventions.md |
| user-prompt-tdd-reminder (UPS) | PreInvocation (also carries plan-approval essence) |
| pre-edit-tdd-reminder (PreToolUse) | PreToolUse matcher=edit-tools |
| pre-bash-zensu-gate (PreToolUse) | PreToolUse matcher=run_command |
| pre-bash-source-write-gate (PreToolUse) | PreToolUse matcher=run_command |
| plan-approved-delegate (ExitPlanMode) | **DROPPED** → rules/ + tdd-reminder |
| post-review-tdd-delegate (Agent done) | **unwired** (Scenario B; no default PostToolUse entry, MJ5); Stop is backstop |
| post-bash-witness (PostToolUse) | PostToolUse matcher=run_command (RAW passthrough) |
| stop-chain-enforcer (Stop) | Stop |

### 4c. Write-gates + cli-map + tool table (Facet 3)

**Tool table (verified, HIGH confidence):**

| Purpose | Tool name | Arg field | Note |
|---|---|---|---|
| shell | `run_command` | `args.CommandLine` (+`args.Cwd`) | matcher for BOTH gates |
| create/overwrite file | `write_to_file` | `args.TargetFile` | |
| edit one block | `replace_file_content` | `args.TargetFile` | |
| multi-block edit | `multi_replace_file_content` | `args.TargetFile` | |
| MCP | `call_mcp_tool` (matcher) | — | unwired (D6); recorded so nobody resurrects `mcp__…__` |
| reads (NOT gated) | `view_file`,`view_file_outline`,`search_in_file` | `AbsolutePath` | |

**`pre-bash-zensu-gate.sh`** — port from CC (177 lines; first port to carry it).
With the shim input re-shape (§2.0), the body is **byte-identical** to CC. Only
edits: (1) root-env fallback chain adds `ANTIGRAVITY_PLUGIN_ROOT`; (2) deny-REASON
invocation strings `/zensu:x`→`/zensu-x`. Everything else verbatim: noun/alias set,
WRAP wrappers, `$(`/backtick boundary splitting, env-prefix capture,
`ZENSU_MCP_GATE=off` inline+env bypass, `--help` skip, localhost `--api-url`/
`ZENSU_API_URL` skip, read→allow/unknown→allow/mutation→deny-unless-workflow ladder,
dual session-id workflow check, `agent_type` zensu-plm exemption (harmless no-op —
no `agent_type` in AG payload).

**`pre-bash-source-write-gate.sh`** — port from CC (59 lines) + `bash-source-write-parse.js`
(282 lines). Parser ports **byte-identical** (reads `tool_input.command`+`cwd` from
the shim). Gate edits: root-env fallback only. `projectRoot` = `CLAUDE_PROJECT_DIR`
(**shim exports from `workspacePaths[0]`** = the stable workspace root) || `cwd` ||
`process.cwd()`; `curdir` = the normalized `cwd` (the **command cwd**). **BK6
reconciliation:** these two MUST come from different sources — workspace root vs command
cwd — or rule-B (cross-worktree escape) can never fire, silently no-opping the guard.
Escapes: `ZENSU_BASH_WRITE_GATE=off`, `ZENSU_MCP_GATE=off`, `hooks.bashWriteGate:false`,
temp-root carve-out (`ZENSU_BSWGATE_TEMP_DIRS`). The `agy` native sandbox composes
additively (this gate is the convention nudge *inside* root). **Cross-worktree DENY
test (BK6):** `test-source-write-gate.sh` asserts `cd ../other-worktree && printf >>
src/x` is DENIED (with `CLAUDE_PROJECT_DIR` = the original workspace root, `cwd` = the
sibling worktree).

**`zensu-cli-map.sh` + `zensu-mcp-tools.sh`** — **byte-for-byte** verbatim
(pure string classification, no engine surface). `zensu-mcp-tools.sh` stays the
single read/mutation SoT. Invariant restated in AGENTS.md: `ZENSU_MUTATION_TOOL_NAMES`
⊇ every CLI-map mutation ⊇ every skill's `--workflow-begin --tools`.

**Input re-shape (§2.0)** — the field map the shim must honor: `toolCall.name`→
`tool_name`, `args.CommandLine`→`tool_input.command`, `args.TargetFile`→
`tool_input.file_path`, `args.Cwd`→`cwd` (**command cwd**), `workspacePaths[0]`→
exported `CLAUDE_PROJECT_DIR` (**workspace root, kept distinct from `cwd`** — BK6),
`session_id` passthrough (deterministic synth if absent, MJ3). Without it the gates read
empty fields → silent open gate; without the cwd/workspace split the cross-worktree
escape check silently no-ops.

### 4d. TDD / phase-gate / review-chain / Stop / witness / plan-mode-analog (Facet 4)

Near-exact transplant of CC's main-thread TDD model. All scripts emit CC schema; the
shim is the only translator. State files keyed on the resolved sid:
`.zensu/state/tdd-phase-<sid>.json`, `.zensu/state/rounds-<sid>.json`.

- **FSM libs** `zensu-tdd-phase.sh` + `zensu-log.sh` — **byte-identical** + root-header
  widen only. `zensu-log.sh` CLI surface (the marker contract, unchanged): `--tdd-begin`
  (freezes `vanilla` from `hooks.tddImplementation`, resets rounds), `--phase <…> --step
  <id> [--reason]`, `--tdd-complete`, `--chain-done`, `--code-review-done`,
  `--self-review-fixed`, `--workflow-begin --tools "<csv>"`/`--workflow-end`,
  `--pending-review …`, `--mode`, `--tdd-reset`. **Fidelity: FULL.**
- **`pre-edit-tdd-reminder.sh`** — port the **CODEX multi-file variant** (strict
  superset: single `file_path` AND multi-file patch; deny whole patch if any file
  violates). Edits: root header; replace the TOOL_NAME allow-set with the verified
  edit-tool names (`{EDIT_MATCHER}` = `write_to_file|replace_file_content|
  multi_replace_file_content`); reads normalized `tool_input.file_path`+`tool_name`.
  **MN5:** the Antigravity writers carry a single `TargetFile` and there is **no
  `apply_patch`** — when `tool_input.file_path` is present the **single-file path wins**;
  the `files.length===0` patch-envelope fallback must NOT misfire on a normalized
  single-file payload. Fix the facet-4 §2 example to the verified writer names (drop
  `write_file|edit_file|apply_patch`). Semantics unchanged: activate only when
  `tdd_session_active`; state-file hardening in BOTH modes (before vanilla bypass);
  vanilla bypass exits 0; phase matrix (RED_WRITE/REFACTOR allow; RED_FAIL/GREEN_PASS
  test-paths-only; IMPL needs prior RED_FAIL for that step; else deny); `ZENSU_TDD_GATE=off`.
  **A normalizer/gate crash classifies RAW → tool allowed** (MN3 — fail-open on internal
  error, consistent with CC/kiro; "FULL" ≠ "fails closed"). `test-pre-edit-phase-gate.sh`
  pins the single-`TargetFile` path. **Fidelity: FULL (crown jewel — real PreToolUse deny
  → shim exit-equivalent).**
- **`/zensu-tdd` workflow + skill** — CC main-thread model ports whole (Phases 0–6
  in-thread, no tdd-manager subagent). Phase 0 plugin-root resolution **ADAPT**: still
  `cat ~/.zensu/plugin-root` but the FATAL message references `install.sh` (re-run
  installer), NOT "fresh session to trigger SessionStart". Vanilla default; strict
  opt-in. Phase 5/6 evidence audits (CHECKPOINT/AUDIT lines, witness cross-check,
  build, coverage, mtime + precondition + cross-layer audits) port FULL (depend only
  on witness log + FSM state). Phase 6.10 review chain contract: `--tdd-complete` →
  `git diff --name-only HEAD` → fan out 5 review-aspect → merge in-thread → 1
  code-reviewer consume-mode → route findings → `--code-review-done` + `/zensu-self-review`
  (owns `--chain-done`; never same turn as `--tdd-complete`).
- **Review chain — auto-fix loop** (D5): default **Scenario B** —
  `post-review-tdd-delegate.sh` ships **unwired** (0 refs in hooks.json). The SKILL.md
  prose self-drives the loop in-thread (port Codex's "no hook fires on reviewer
  completion — YOU route findings by severity" block): Critical/Important → fix under
  TDD + re-fan-out + re-spawn consume-mode reviewer; Suggestion/Minor/Nit/Low → defer
  (unless `autoFixIncludeSuggestions=true`); end at first PASS/suggestions-only OR
  `autoFixMaxRounds`. **MN1 — hard stop independent of the Stop hook:** after
  `autoFixMaxRounds` reviewer spawns, run `--code-review-done` **UNCONDITIONALLY**
  (convergence must not rely on a possibly-advisory Stop backstop), then invoke
  `/zensu-self-review`. Round counter incremented by prose discipline; the **Stop
  backstop budget** `CAP = autoFixMaxRounds + 3` is a secondary floor only. **Scenario A**
  (preferred upgrade if a subagent-completion PostToolUse is verified): add the one
  hooks.json entry, port the kiro variant of the delegate (filter on the AG reviewer
  agent id `zensu-code-reviewer`). **Fidelity: DEGRADE → skill-driven (B); FULL (A).**
- **`stop-chain-enforcer.sh`** — **MN2: ship the codex (no agent-context guard) variant
  for v1** and rely on the `.stopblocks` budget cap; gate the kiro spawned-agent guard
  behind the Stop-agent verify (no "pending" limbo). Whether the directive actually
  blocks is governed by the shim's `ZENSU_AG_STOP_BLOCKS` knob (MJ8b — default `0` =
  advisory context until V3; `1` = real Stop-block). Once the Stop-agent verify lands and
  the payload carries `agent_id`/`agent_type`, swap in the **kiro variant**
  (`decision:block`, mode-aware) + restore the CC spawned-agent guard. Ships regardless:
  activation `active && implComplete && !chainDone`; anti-deadlock budget `.stopblocks`
  byte-counter `CAP = autoFixMaxRounds + 3` (the critical floor when no agent_id);
  two-stage terminus; escapes `ZENSU_CHAIN=off`/`hooks.chainEnforcer:false`. **Fidelity:
  FULL if Stop blocks (`ZENSU_AG_STOP_BLOCKS=1`) + (agent_id present OR Stop
  top-level-only); else DEGRADE → advisory.**
- **Plan-mode analog** — no event; degrade like codex/kiro. Keep
  `plan-approved-delegate.sh` **unwired** (reused by `/zensu-implement` Step 3 + as
  canonical directive text). Essence → `rules/zensu-tdd.md` (plan first; ask
  TDD-vs-direct before first edit; skip only for doc-only / explicit preference /
  non-interactive). Workflow asks up-front too. Preserve multilingual literals in the
  kept file. **Fidelity: DEGRADE → advisory.**
- **`post-bash-witness.sh`** — port **CODEX variant**. Edits: root header; reads
  normalized `tool_input.command`+`tool_response.{exit_code,stdout,interrupted}` (the
  normalizer multi-key-probes the AG result stdout → `tool_response.stdout`, BK7b). Missing
  `exit_code` is fine (`exit=?`; Phase-6 corroborates by `cmd=`+`tail=`). **BK7c — the
  Phase-6 corroboration audit FAILS LOUD (not fail-open) if `tail=` is empty while a TDD
  session is active** — it surfaces "witness stdout unmapped" rather than silently passing,
  because the AG PostToolUse result-stdout field is unverified. `test-post-bash-witness.sh`
  asserts a realistic AG PostToolUse payload populates `tail=`. Escape `ZENSU_TEST_WITNESS=off`.
  **Fidelity: FULL pending PostToolUse result-field verification (BK7).**

### 4e. Skills + workflows + agents + rules (Facet 5)

**Invocation:** `/zensu-<name>` (slash, hyphen-namespaced; filename stem = command).
Global find-replace `/zensu:<name>`→`/zensu-<name>` across all ported files.

**Universal tool-name sweep (every skill/agent/rule body):**

| CC token | → Antigravity |
|---|---|
| `# /zensu:<name>` H1 + body cross-refs | `/zensu-<name>` |
| `Bash` tool | `run_command` |
| `Edit`/`Write`/`MultiEdit` | the file-edit tool (`write_to_file`/`replace_file_content`/`multi_replace_file_content`) |
| `Task`/`Agent`/`subagent_type=` / "spawn FIVE zensu:review-aspect" | AG subagent spawn (§ agents) or sequential fallback |
| `AskUserQuestion` | plain numbered question to the user |
| `~/.claude/` | `~/.gemini/` |
| `CLAUDE.md` | `GEMINI.md` *and* `AGENTS.md` |
| `CLAUDE_PROJECT_DIR`/`CLAUDE_PLUGIN_ROOT` in prose | `~/.zensu/plugin-root` pointer + `ZENSU_*` |
| "SessionStart hook" as plugin-root provider | "the install step / `~/.zensu/plugin-root` pointer" |

(`{PLUGIN_ROOT}`, `zensu-log.sh --phase …` stay verbatim — engine-neutral.)

**13-skill mapping** (dir = bare verb; YAML `name:`+`description:` on ALL; `name`=bare
stem; the workflow carries the namespace):

| # | Skill | Workflow | Fidelity | Skill-specific edits beyond the sweep |
|---|---|---|---|---|
| 1 | tdd | zensu-tdd.md | Heavily adapted | densest; review fan-out lines → subagent mechanism or sequential; `AskUserQuestion`→plain Q (keep "override no-questions"); `Skill tool zensu:self-review`→`/zensu-self-review`; keep foreground-`run_command` rule |
| 2 | implement | zensu-implement.md | Mostly verbatim | cross-ref `/zensu-tdd`; frontmatter |
| 3 | autopilot | zensu-autopilot.md | Adapted | has frontmatter; `AskUserQuestion`→plain Q; port `rules/{auth,config,drivers,probe}.md` as **skill-LOCAL** refs (+sweep) |
| 4 | bootstrap | zensu-bootstrap.md | Verbatim | frontmatter + hyphen |
| 5 | ghost-scan | zensu-ghost-scan.md | Adapted | `Explore` fan-out → parallel read-only subagents or sequential passes |
| 6 | plan-review | zensu-plan-review.md | Heavily adapted | `TeamCreate` 6-of-12 → subagents or sequential persona adoption |
| 7 | pr-team-review | zensu-pr-team-review.md | Heavily adapted | `TeamCreate`+`AskUserQuestion`+14-persona; port `rules/{workflow,reviewer-personas,github-publish}.md` skill-LOCAL; `gh api` stays |
| 8 | pr-fix-findings | zensu-pr-fix-findings.md | Mostly verbatim | has frontmatter; cross-ref hyphen; parallel-fixes→subagents/sequential |
| 9 | pulse | zensu-pulse.md | Verbatim | frontmatter + hyphen |
| 10 | reset-review-limit | zensu-reset-review-limit.md | Mostly verbatim | `Bash`→`run_command`; keep Strict-Scope/never-traverse-worktrees block |
| 11 | security-review | zensu-security-review.md | Verbatim | frontmatter + hyphen |
| 12 | self-review | zensu-self-review.md | Mostly verbatim | owns `--chain-done`; `Bash`→`run_command`; hyphenate |
| 13 | zensu-help | zensu-help.md | Adapted (content) | rewrite topic table (`plugin.json` at root; drop marketplace.json rows; env-var→`ZENSU_*`; hook refs→hooks.json/shim); "Claude Code"→"Antigravity"; glossary verbatim; document `/zensu-<name>` convention |

**Workflows** — thin 4–6 line loaders (template in Facet 5 §2). Default build for
**(A)** workflows register + skills not directly `/`-invocable. Frontmatter +
`$ARGUMENTS` conditional on verification (V9). One per skill = 13.

**Agents (D5)** — ship `agents/zensu-{plm,code-reviewer,review-aspect}.md`
(markdown+frontmatter `name`+`description`+`tools`; highest-probability format — AG
is a VS Code/Windsurf fork, skills already use md-frontmatter). Bodies = CC bodies +
sweep. **MJ6 — pin `tools:` on all 3:** `zensu-review-aspect.md` = `tools: read, grep,
glob` (no `run_command`); `zensu-code-reviewer.md` = **write-free** `tools: read,
run_command, grep, glob` (run_command for build/test only); `zensu-plm.md` = its CC
allowlist swept to AG tool names. **Drop the CC-specific `TaskCreate`/`TaskUpdate`**
(default: drop; optionally note the AG `/tasks` equivalent in prose). Both reviewer
agents must declare a non-empty, **write-free** tool list (`test-agents-present.sh`
asserts this). **Fallback** (no first-class format): keep the 3 files but treat as
main-agent reference prose; review fan-out collapses to sequential persona adoption +
synthesis; re-home the `post-review-tdd-delegate` trigger to Stop/PostToolUse; document
the fidelity loss.

**Rules (D3)** — 3 plugin-level files, ≤~120 lines combined (always-on = context cost):
- `rules/zensu-conventions.md` — constitution (what Zensu is; 3-line core model
  KEY-N/[ZEN-42]/lifecycle; routing rule = intent-router essence; discipline pointers;
  banner one-liner folded in; **context-compaction nudge essence folded in** — MN4, since
  `user-prompt-context-nudge.sh` ships unwired).
- `rules/zensu-tdd.md` — **the #1 D3 migration** (tdd-reminder + plan-decision: plan
  first, ask TDD-vs-direct before first edit, vanilla note, review-chain finish;
  multilingual signals mentioned in plain English — literal phrase lists stay owned
  by `user-prompt-tdd-reminder.sh`, NOT duplicated).
- `rules/zensu-write-gate.md` — rationale only (mutations default-denied outside a
  workflow = convention nudge not security; reads ungated; use the workflow; escape
  hatches exist but prefer the workflow). No classification tables (those live in the lib).

Skill-LOCAL `rules/` (autopilot, pr-team-review) stay progressive-disclosure refs —
NOT promoted to plugin rules.

### 4f. Install scripts (Facet 1 / D7)

Pattern = **kiro `install.sh`** (sha256-manifest idempotency, atomic temp writes,
never-stomp user files, `--uninstall` confined to recorded in-root paths). Divergence:
AG discovers a whole plugin **directory**, so stage the **entire subtree** into two
dirs:
- IDE: `~/.gemini/config/plugins/zensu/`
- CLI: `~/.gemini/antigravity-cli/plugins/zensu/`

`ZENSU_HOME` = IDE_DEST (single authoritative hook runtime → one FSM state root).
Stage list per dest: `plugin.json`, `skills/`, `rules/`, `workflows/`, `agents/`,
`hooks/`, `config.example.json`, `mcp_config.json`. Exclude: tests/, reference/,
README/CHANGELOG/LICENSE/cliff.toml/.git*/install.*.

**hooks.json render (load-bearing D7):**
`sed "s|__ZENSU_HOME__|$ZENSU_HOME|g" hooks.json.template > $dest/hooks.json`
(render into both dests; CLI dest's commands point back at the IDE `ZENSU_HOME`).

`~/.zensu` seed: `printf '%s\n' "$ZENSU_HOME" > ~/.zensu/plugin-root`; seed
`~/.zensu/config.json` from `config.example.json` (once, never overwrite). Flags:
`install.sh [--target ide|cli|both] [--uninstall] [--dry-run] [--force]` (drop kiro's
`--mcp-url`/`--set-default`). **Manifest = plain TSV** (`path\tsha`) — drop kiro's
node-JSON-merge (no MCP merge needed; only JSON touched is hooks.json via `sed`). `chmod
+x` the shim + lazy-init + capture-sid + run-all. `install.ps1` verbatim from kiro
(locate Git Bash not WSL; only edit product-name strings).

### 4g. Tests + CI (Facet 6)

**`tests/run-all.sh`** — family template: `set -u`; `run_suite` (suite=script, pass
iff exit 0); loop `tests/structure/test-*.sh`; **then run `evals/config-gate/run-eval.sh
--self-check`** (BK8); timestamped `tests/results/` report; final `[ "$FAIL" -eq 0 ]`.
Header prints `plugin v$(node -e '…repo-root plugin.json…')`. **No `--live`/`--self-check`
runner flag for v1** (all live suites deferred; deterministic-only — MN8).
`run-promptfoo.sh` is a stub that hard-exits documenting #H1.

**Deterministic gate ≈ 110 tests (BK8): ≈55 structure + ≈55 `evals/config-gate`.** The
`evals/config-gate/` suite (ported wholesale from CC; pure-bash, offline, no-API) covers
the phase-gate allow/deny matrix, log-FSM timestamps, autofix-round counter, config-merge,
and helpers — exactly the FULL-fidelity core — and is wired via `run-eval.sh --self-check`.
The structure suite is ≈55 (CC drops = promptfoo×5, drift×2, native-path×1,
SessionStart-trio→rules/lazy-init×3) plus the NEW shim/install/debounce tests. Key ports:

- *Manifest/version:* `test-version-sync.sh` (codex form, NO marketplace),
  `test-plugin-manifest.sh` (NEW: parse, required keys, skills/rules paths exist, no
  mcpServers), `test-gitignore.sh`, `test-changelog.sh`,
  `test-readme-hook-count-sync.sh` (**BK10/MN10 — REWRITTEN:** parse the **wrapped-script
  token** after `antigravity-shim.sh ` in `hooks.json.template`, NOT the shim path — the
  CC regex `/hooks\/([…]\.sh)/` would match `antigravity-shim.sh` on every line and
  collapse the count to 1; assert distinct-wrapped-scripts == README `### Hooks (N)` header),
  `test-english-only.sh` (kiro verbatim + carve-outs), `test-shell-syntax.sh`.
- *Skill guards:* `test-skill-workflow-markers.sh` (**verbatim SoT gate**),
  `test-skill-frontmatter.sh` (YAML present, no `/zensu:` colon-form), the skill-prose
  pins (tdd-prominence, vanilla-mode, ghost-scan-detection, self-review, …) with host-noun swaps.
- *Write-gate:* `test-bash-zensu-gate.sh`, `test-bash-source-write-gate.sh` (AG `run_command`
  + `toolCall.args.CommandLine` stdin; assert shim-translated verdict),
  `test-source-write-gate.sh` (**NEW, BK6 cross-worktree DENY case** — `CLAUDE_PROJECT_DIR`
  = original workspace root, `cwd` = sibling worktree; `cd ../other-worktree && printf >>
  src/x` is DENIED), `test-cli-map-mcp-tools.sh` (NEW standalone SoT guard),
  `test-gate-antigravity-payloads.sh` (kiro analog: real AG-shaped payloads end-to-end).
- *Phase-gate/per-turn:* `test-pre-edit-phase-gate.sh` (superset matcher + `toolCall.args`
  path; through shim; native deny; **pins the single-`TargetFile` path** — MN5),
  `test-tdd-reminder.sh`/`test-intent-router.sh` (PreInvocation-or-rules delivery split),
  `test-preinvocation-debounce.sh` (**NEW, BK5** — identical `(script,context)` pair
  suppressed on a re-fire until the turn marker changes), `test-context-nudge.sh`
  (now asserts it ships **unwired** — MN4: not in the PreInvocation array; essence in rules).
- *Session:* `test-resolve-session-id.sh`, `test-session-id-fallback.sh`,
  `test-session-resolution.sh` (kiro pointer-first), `test-runtime-root-cwd.sh`
  (root-chain precedence + cwd extraction).
- *Rules/lazy-init (replaces SessionStart trio):* `test-rules-presence.sh`,
  `test-plugin-root-init.sh` (install writes pointer + lazy writes when missing),
  `test-lazy-init.sh` (idempotent, fail-open).
- *Stop/chain/witness:* `test-stop-enforcer.sh` (block-or-advisory mode-parameterized;
  budget releases at cap), `test-stop-subagent-noop.sh` (D5-gated),
  `test-post-bash-witness.sh` (**BK7d — asserts a realistic AG PostToolUse payload
  populates `tail=` via the `tool_response.stdout` mapping**), `test-witness-scenario-assertions.sh`,
  `test-plan-approved-delegate.sh` (becomes a workflow/rule pin — no ExitPlanMode),
  `test-post-review-delegate.sh` (Scenario A routing OR Scenario B prose-contract pin).
- *FSM full-cycle:* `test-tdd-full-cycle.sh` (RED→GREEN→review→self-review through the shim).
- *NEW shim suite (crown jewel):* `test-antigravity-shim-deny.sh` (**MJ8a — parameterize
  on the literal `ZENSU_AG_HOOK_CONTRACT` values `{superset, allow_tool, decision, exit}`,
  NOT `A|B`**: assert `allow_tool`-only under `=allow_tool`, `decision`-only under
  `=decision`, both keys under `=superset`, exit 2 under `=exit`), `-context.sh` (unwrapped
  text on stdout; AG workflow names; no Claude tools), `-stop.sh` (**MJ8b —
  `ZENSU_AG_STOP_BLOCKS=1` emits the AG Stop-block shape, `=0` emits advisory context**),
  `-failopen.sh` (unknown/crashing/no-node → exit 0, NEVER accidental deny; sandbox-copy stub).
- *NEW install/manifest:* `test-install-script.sh` (sandbox HOME; --dry-run writes
  nothing; stages both dirs; **hooks.json all-absolute, zero placeholders, files exist**;
  idempotent; user-edit guard; uninstall in-root-only refusing `../` traversal; `install.ps1`
  grep-pins), `test-hooks-json-shape.sh` (event keys, every command shim-wrapped+absolute,
  per-event registration, no TTL field; **BK1 — every wrapped `$1` token contains no `/`**),
  `test-workflow-skill-pairing.sh` (D4 no-orphans), `test-agents-present.sh` (D5-gated:
  first-class format or skills+prose; **MJ6 — both reviewer agents declare a non-empty,
  write-free tool list**).

**CI** `ci.yml`: `on:[pull_request,push]→main`; ubuntu-latest; setup-node@v4 (20);
gate `bash tests/run-all.sh`. jq preinstalled; node is the JSON tool in tests. Add
windows-latest only when a Windows `agy`/`install.ps1` path is real.

**`release.yml`** (port codex, marketplace already dropped there): `workflow_dispatch`
(version_type + dry_run) + `push:[main]` publish; `permissions: contents: write`;
prepare runs the gate THEN `sed` bumps `plugin.json` + README badge (`version-X.Y.Z-blue`),
validates `jq -r .version == VER` + `grep version-VER-`, git-cliff CHANGELOG, push
`release/vX.Y.Z` + Compare-&-PR link; publish extracts CHANGELOG section, `git archive`
`zensu-antigravity-v$VER.zip`, creates the Release. `git add plugin.json README.md
CHANGELOG.md` (no marketplace.json).

**Source dispositions (MN8 — stated explicitly):** `evals/config-gate/` → **ported** and
wired via `--self-check` (BK8); `evals/*` promptfoo configs → **deferred** (H1);
`scripts/claude-promptfoo-wrapper.sh` → **dropped**; `docs/documentation-guide.md` → port
**only if** `/zensu-help` references it; `docs/tdd-manager-workflow.md` → **dropped**
(main-thread model, no tdd-manager subagent); `run-all.sh --self-check`/`--live` runner
flags → **omitted v1** (deterministic-only). Confirm `install.sh` stages `hooks/`
**recursively** (incl. `hooks/antigravity/` + `hooks/lib/`) and the syntax check runs
`node --check` over **all** `.js`.

---

## 5. Verification register (ordered by blocking risk)

| ID | Unknown | Blocking risk | Concrete verify step | Safe default already in the plan |
|---|---|---|---|---|
| **V1** | Hook stdout/exit contract: A (`allow_tool`/exit0) vs B (`decision`/non-zero) | **TOP** — the write-gate/phase-gate deny rides on it | WebFetch docs/hooks + danicat + Medium guide; **live probe** a deny hook on `echo ZENSUPROBE` under `agy`; the probe MUST **assert the deny actually BLOCKS under `CONTRACT=superset`** (a strict parser may reject the dual verdict keys → deny fails OPEN, MJ2), then pin to the single accepted flavor; inspect `~/.gemini/antigravity-cli/` parser | Shim emits **superset** (both shapes, a **PROBE not proven-safe**) + exit 0; `ZENSU_AG_HOOK_CONTRACT` pinned to one flavor before any reliance; one-symbol change |
| **V2** | hooks.json var-expansion vs literal-absolute | **TOP** — wiring | docs; live-probe `${HOME}/x.sh` vs literal; inspect a community plugin | **Generate literal absolute paths at install** (D7); literal works regardless; `test-install-script.sh` pins zero-placeholder |
| **V3** | Stop hook can BLOCK? | **TOP** — Stop-backstop + auto-fix fidelity | docs Stop semantics; live-probe a Stop block + reason; observe forced-continue | Assume **advisory (codex degrade)**; shim emits directive as context; `test-…-shim-stop.sh` mode-parameterized; budget cap is the floor |
| **V4** | PreInvocation exists for plugin hooks.json AND injects context? | High — decides advisory hooks = hooks vs rules | docs events list; live-probe PreInvocation stdout reaching model | Migrate steering to **rules/** (D3 fallback, confirmed available); keep scripts, `test-rules-presence.sh` proves it |
| **V7** | Edit-tool name(s) + target arg (shell `run_command`/`args.CommandLine` confirmed) | High — phase-gate + source-write-gate matcher | docs cli-features; live-probe `matcher:".*"` logging `toolCall.name`+`args` during an edit | **Superset matcher** + generic `toolCall.args` path extraction; verified set is `write_to_file\|replace_file_content\|multi_replace_file_content`; widen on confirm |
| **V5** | SessionStart exists for plugin hooks.json? | Med — banner/primer/pulse delivery | docs events; live-probe SessionStart on session begin | **rules/ + lazy first-call init** (D3); `test-lazy-init.sh`+`test-rules-presence.sh`; no SessionStart dependency |
| **V6** | plugin.json honored keys (`hooks`/`mcp`/`agents`/`workflows`) vs filename auto-discovery | Med — manifest finality | docs plugins schema; real-install inspection of `/plugins` registration | **Belt-and-suspenders**: explicit keys AND conventionally-named files; drop only a rejected key |
| **V8** | Subagent definition format for the 3 agents | Med — agent fidelity | docs/`/agents` + explainx; real-install `agents/*.md` vs `.toml`, check `/agents` | **Express as skills + orchestrator prose (codex degrade)** if no format; reviewers read-only either way |
| **V9** | Workflow frontmatter/args + plugin-bundled `workflows/` discovery | Med — invocation shape | docs rules-workflows + atamel; real-install `workflows/foo.md` w/ frontmatter+`$ARG`, invoke `/foo` | **Plain md body, filename-derived `/<name>`, ship both shim + skill** (D4); collapse only if redundant |
| **V11** | Does `node`/`jq` run in the shim at hook time on a user box? | Med — shim parses JSON | libs already require node; live-probe a hook running `node -e` | **node** (matches all prior ports + CI setup-node); shim fail-opens if absent; `jq` fallback (preinstalled on runners) |
| **PreInv-debounce** | Does PreInvocation re-fire before every model step (not once per turn)? | High — BK5: un-debounced advisory re-injection = context bloat + steering loop | live-probe PreInvocation firing count across a multi-tool turn | Shim CONTEXT branch **de-bounces** `(script,context)` per turn via `.zensu/state/preinv-<sid>.txt`; context-nudge unwired (MN4) shrinks the array to 2; `test-preinvocation-debounce.sh` pins it |
| **PreInv-prompt** | PreInvocation prompt-field name (`prompt`/`userMessage`/`ephemeralMessage`?) | Med — intent-router prompt-regex trigger (context-nudge now unwired) | live-probe PreInvocation payload keys; multi-key probe | If no prompt text → intent-router moves to **rules wholesale**; tdd-reminder survives (no prompt regex) |
| **Stop-agent** | Does Stop fire inside auto-spawned subagents, and carry `agent_id`? | Med — spawned-reviewer deadlock | live-probe Stop in a spawned reviewer + inspect payload | v1 ships codex no-guard (MN2); if agent_id present → swap in CC guard; if Stop top-level-only → no guard; worst case budget cap prevents infinite loop |
| **PostTool-fields** | Post-tool result-stdout + exit + agent-id field names | **High** (BK7 — witness `tail=` corroboration depends on it; Phase-6 fails loud if unmapped) | live PostToolUse/Stop payload inspection | Normalizer multi-key-probes `Output\|stdout\|result`→`tool_response.stdout` in one place; `test-post-bash-witness.sh` asserts `tail=` populated |
| **V10** | `.agent` vs `.agents` workspace dir | Low — self-contained plugin bundles its own | docs + atamel cross-check | Note in README, don't block |
| **V12** | `agy` sandbox: hook READ of `~/.zensu/*` + WRITE of `$workspace/.zensu/state` (MJ4) | Low | docs cli-features sandbox; live-probe (a) read `~/.zensu/plugin-root`+`config.json` outside the plugin dir under `sandbox-exec`/`nsjail`; (b) write `$workspace/.zensu/state` | Gate is a **convention nudge** (composes additively); state root = project dir regardless of dest (no coherence consequence); note in README |
| **H1** | Headless/non-interactive `agy` for live harness | Low (gate is deterministic-only) | `agy --help`/`agy plugin --help` for `--prompt`/`--print`; explainx; settings `toolPermission:always-proceed` | **Defer all live e2e; ship deterministic gate** (§4g); stub `run-promptfoo.sh` documents H1; no gate impact |

**Top-3 blocking: V1 (hook contract), V2 (hooks.json paths), V3 (Stop-block).**

---

## 6. Fidelity matrix (FULL vs DEGRADED per CC guarantee)

| CC guarantee | Antigravity fidelity | Reason / mechanism |
|---|---|---|
| TDD phase-gate deny (prod edit blocked in RED_FAIL) | **FULL** (pending V1+V7); **fails OPEN on internal error** (MN3) | PreToolUse direct; FSM byte-identical; shim emits real deny; a normalizer/gate crash → RAW → tool allowed (convention nudge, not a security boundary) |
| CLI write-gate (mutation deny outside workflow) | **FULL** (pending V1) | PreToolUse(`run_command`) + same cli-map/mcp-tools SoT; convention nudge |
| Source-write-gate (A) tracked-file clobber | **FULL** (pending V1) | depends only on `tool_input.command`+`cwd` (well-mapped); byte-identical parser |
| Source-write-gate (B) cross-worktree escape | **FULL once BK6 lands, else DEGRADED** (MJ1) | rule-B needs `projectRoot=CLAUDE_PROJECT_DIR`(=`workspacePaths[0]`) distinct from `curdir=cwd`; the shim's cwd/workspace split is the dependency |
| Post-bash witness (TDD evidence log) | **FULL pending PostToolUse result-field verification** (BK7) | PostToolUse direct; result-stdout→`tool_response.stdout` is a multi-key-probe TBD; Phase-6 fails loud if `tail=` empty while a TDD session is active |
| TDD FSM / phase log / rounds counter | **FULL** | pure engine-neutral libs; `test-tdd-full-cycle.sh` |
| Session-id resolution | **FULL** (pointer-first, deterministic synth — MJ3) | `resolve-session-id.js` verbatim + kiro pointer-first; `ag-$(zensu_session_key)` stable across the turn's hook subprocesses |
| 5-perspective review chain (content) | **FULL** | skill/agent prose ports; chain logic in skills + delegate |
| Stop chain-enforcer backstop | **DEGRADE → advisory** (v1 codex no-guard — MN2; `ZENSU_AG_STOP_BLOCKS=0`) | AG Stop-block unverified; default advisory-as-context; budget cap is the floor; → FULL if V3 + `=1` |
| Auto-review / auto-fix loop | **DEGRADE → skill-driven** (Scenario B; → FULL if A) | no confirmed subagent-completion event; prose self-drives; after `autoFixMaxRounds` runs `--code-review-done` **unconditionally** (MN1), Stop budget is a secondary floor |
| Plan→TDD decision gate (ExitPlanMode → plan-approved-delegate) | **DEGRADE → workflow/rule** | no ExitPlanMode; re-expressed as `rules/zensu-tdd.md` + workflow ask; the TDD flow once entered is fully gate-enforced |
| Advisory steering: intent-router / tdd-reminder | **DEGRADE → 2 PreInvocation hooks + rules/ fallback** (pending V4; de-bounced — BK5) | no UserPromptSubmit; PreInvocation injects context → 2 hooks survive (context-nudge unwired — MN4); rules/ safety-net always-on |
| SessionStart banner / primer / pulse-init | **DEGRADE → rules/ + lazy first-call init** | SessionStart confirmed unavailable; steering→rules, pulse/sid→lazy init |
| Context-compaction nudge | **DEGRADE → unwired; essence in rules/** (MN4) | CC-specific transcript schema AG won't match; ship `context-nudge` unwired, fold the essence into `rules/zensu-conventions.md` |
| 3 subagents (plm/reviewer/aspect) as first-class agents | **VERIFY → FULL or DEGRADE** (V8) | FULL if AG has a subagent format; else skills+prose; reviewers read-only either way |
| MCP wiring | **N/A (intentionally unwired)** | CLI-driven (D6); `mcp_config.json` empty |
| Distribution / marketplace | **SIMPLER (dir-staging)** | no marketplace.json (D8); version = plugin.json + README + CHANGELOG |

**Headline:** the FULL core (phase-gate, write-gates, witness, FSM, session-id)
transplants intact behind the shim; DEGRADEs cluster exactly where CC used
UserPromptSubmit / SessionStart / ExitPlanMode / Stop-block — same profile as codex,
with kiro-style shim + pointer-first session handling.

---

## 7. Phased implementation task list (top-to-bottom)

**P0 — engine-neutral libs + the shim (foundation)**
1. Scaffold repo at `~/IdeaProjects/dev.zensu/zensu-antigravity/`; `git init`; copy `LICENSE`, `cliff.toml` verbatim from CC.
2. Port `hooks/lib/{zensu-tdd-phase,zensu-log,zensu-config,zensu-cli-map,zensu-mcp-tools,zensu-agent-context}.sh` + `resolve-session-id.js` + `bash-source-write-parse.js` — **byte-identical to CC; do NOT widen the lib root-header** (BK9 — preserves the upstream-sync diff base; the shim exports the root before sourcing).
3. Port `hooks/lib/zensu-session.sh` from **kiro** (pointer-first); port `hooks/lib/zensu-runtime.sh` from **codex/kiro** (NOT CC — MN9) + the `workspacePaths[0]` fallback line; the `ANTIGRAVITY_PLUGIN_ROOT` root-chain widening lands ONLY here + on the top-level `hooks/*.sh` (BK9).
4. Write `hooks/antigravity/normalize-payload.js` (Antigravity → CC flat snake_case; `args.Cwd`→`cwd`(command cwd) kept distinct from the `workspacePaths[0]` workspace root — BK6; multi-key probes for prompt + PostToolUse result-stdout — BK7b; fail-open).
5. Write `hooks/antigravity/emit-verdict.js` (superset PROBE; ROLE/TEXT/CONTRACT; `ZENSU_AG_STOP_BLOCKS` BLOCK-branch behavior — MJ8b).
6. Write `hooks/antigravity/lazy-init.sh` + port `hooks/session-start-capture-sid.sh` from kiro (**deterministic** synth prefix `ag-$(zensu_session_key)` — MJ3).
7. Write `hooks/antigravity/antigravity-shim.sh` (export `CLAUDE_PROJECT_DIR`=`workspacePaths[0]` — BK6; bare-script `$1`→`$ROOT/hooks/$1` — BK1; reshape → run → classify → emit; **CONTEXT branch de-bounces per turn** — BK5; always exit 0; fail-open).

**P1 — hooks + gates (the enforcement layer)**
8. Port `hooks/pre-bash-zensu-gate.sh` from CC (root-header + `/zensu-x` deny strings only).
9. Port `hooks/pre-bash-source-write-gate.sh` from CC (root-header only).
10. Port `hooks/pre-edit-tdd-reminder.sh` from **codex** (multi-file variant; set `{EDIT_MATCHER}`; root-header).
11. Port `hooks/post-bash-witness.sh` from **codex** (root-header + normalized `tool_response.*`; Phase-6 fails loud on empty `tail=` while a TDD session is active — BK7c).
12. Port `hooks/stop-chain-enforcer.sh` from **codex** (no agent-context guard for v1 — MN2; keep budget cap + two-stage terminus; the kiro guard is gated behind the Stop-agent verify).
13. Keep `hooks/post-review-tdd-delegate.sh` (kiro variant) + `hooks/plan-approved-delegate.sh` (CC) as **unwired** reusable files.
14. Port the 3 `hooks/user-prompt-*.sh` verbatim (read normalized `prompt`); **wire only intent-router + tdd-reminder** — `user-prompt-context-nudge.sh` ships unwired (MN4).
15. Author `hooks.json.template` (5 labels, `__ZENSU_HOME__` bare-script shim-wrapped commands — BK1; edit-matcher exact `write_to_file\|replace_file_content\|multi_replace_file_content` — BK4; PreInvocation array = 2; **NO Scenario-A PostToolUse entry** — MJ5).

**P2 — skills + workflows + agents + rules (the behavior layer)**
16. Port 13 `skills/<verb>/SKILL.md` — add frontmatter to all; apply the universal sweep + per-skill edits (§4e).
17. Port skill-LOCAL `skills/autopilot/rules/*` + `skills/pr-team-review/rules/*` (verbatim + sweep).
18. Write 13 `workflows/zensu-<name>.md` thin loaders (template; conditional frontmatter).
19. Port 3 `agents/zensu-{plm,code-reviewer,review-aspect}.md` (md-frontmatter; bodies + sweep; **pin `tools:`** — MJ6: `zensu-review-aspect` = `read,grep,glob`; `zensu-code-reviewer` = write-free `read,run_command,grep,glob`; `zensu-plm` = CC allowlist swept; **drop `TaskCreate`/`TaskUpdate`**).
20. Write 3 `rules/{zensu-conventions,zensu-tdd,zensu-write-gate}.md` (short, always-on; the plan-decision essence in zensu-tdd.md).

**P3 — manifest + install + meta (the packaging layer)**
21. Write `plugin.json` (root; arrays for skills/rules/agents/workflows; `hooks` string ref).
22. Write `mcp_config.json` (`{"mcpServers":{}}`), `config.example.json` (vanilla), `.gitignore`, `.gitattributes`.
23. Write `install.sh` (kiro skeleton; stage both dirs; render hooks.json via sed; TSV manifest; seed `~/.zensu/*`; `--uninstall`/`--dry-run`/`--force`) + `install.ps1` (kiro verbatim, product-name edits).
24. Write `README.md` (badges, fidelity framing + matrix §6, Rules/Workflows sections) + `AGENTS.md` (English-only + carve-out, D8 invariant, architecture invariants, CLI-class invariant) + `CHANGELOG.md` (seed `[0.1.0]`) + **OSS meta** (MJ7): `SECURITY.md`+`CODE_OF_CONDUCT.md` verbatim from CC, `CONTRIBUTING.md` adapted (`/zensu-<name>` + `bash tests/run-all.sh`); `OSS_READINESS_REPORT.md` consciously dropped for v1.

**P4 — tests + CI (the proof layer)**
25. Port `tests/run-all.sh` (family template; no `--live`) + **port `evals/config-gate/` wholesale and wire `run-eval.sh --self-check`** (BK8; ≈55 offline tests) + stub `tests/run-promptfoo.sh`.
26. Port/author the ≈55 `tests/structure/test-*.sh` (§4g; deterministic gate ≈110 total with config-gate — BK8), incl. the NEW shim suite (MJ8 contract values), `test-preinvocation-debounce.sh` (BK5), `test-source-write-gate.sh` cross-worktree DENY (BK6), `test-post-bash-witness.sh` tail-mapping (BK7), `test-agents-present.sh` write-free assertion (MJ6), `test-hooks-json-shape.sh` no-slash-in-`$1` (BK1), the rewritten `test-readme-hook-count-sync.sh` (BK10/MN10), the install/manifest tests + `test-version-sync.sh` (no marketplace).
27. Write `.github/workflows/ci.yml` + `release.yml` (port codex; drop marketplace lines).
28. Run `bash tests/run-all.sh` locally until green; run a **type/syntax check** (`bash -n` all `*.sh` incl. `evals/`, `node --check` all `*.js`).

**P5 — verification, self-review, commit**
29. Execute the V1/V2/V3 (then V4/V7) live probes (§5); pin `ZENSU_AG_HOOK_CONTRACT`, hooks.json path mode, Stop variant, edit-tool matcher, advisory-hook delivery; flip the relevant defaults + tests.
30. Self-review pass (`/zensu-self-review` analog or manual); ensure English-only + version-sync green; Conventional-Commit the initial port; open a PR following the repo PR workflow.

---

## 8. Open risks / explicitly-deferred

- **E2E without headless `agy` (H1).** No documented non-interactive `agy` → all
  live-agent suites deferred; the deterministic gate (≈110 — ≈55 structure + ≈55
  `evals/config-gate` — plus shim/install/FSM full-cycle) is the whole CI gate, exactly
  as CC (CC's gate is deterministic-only; live is opt-in). `run-promptfoo.sh` is a
  documented stub. Add an `agy.mjs` provider only after H1 lands.
- **PreInvocation re-fires before every model step (BK5).** Un-debounced, the 2 wired
  advisory hooks would re-inject their directives on every tool round (context bloat +
  steering loop). Mitigation shipped: the shim's CONTEXT branch de-bounces `(script,
  context)` per turn via `.zensu/state/preinv-<sid>.txt`; `test-preinvocation-debounce.sh`
  pins it. Verify the actual re-fire cadence with the PreInv-debounce probe.
- **Stop-block (V3).** v1 ships the codex no-guard `stop-chain-enforcer.sh` with
  `ZENSU_AG_STOP_BLOCKS=0` (advisory). If AG Stop is advisory-only the chain-enforcer +
  auto-fix loop stay advisory/skill-driven; the `.stopblocks` budget cap
  (`autoFixMaxRounds+3`) **plus** the unconditional `--code-review-done` after
  `autoFixMaxRounds` (MN1) are the anti-deadlock floor. `test-…-shim-stop.sh` pins both
  knob values.
- **PreInvocation prompt-field name.** If PreInvocation carries no user-prompt text,
  intent-router loses its regex trigger → move it to rules wholesale; tdd-reminder
  survives (no prompt regex). Context-nudge is already unwired (MN4), so it is not at risk
  here.
- **Spawned-agent Stop semantics.** Whether Stop fires inside auto-spawned subagents and
  carries `agent_id` decides whether the kiro spawned-reviewer guard can be swapped in
  (v1 ships without it — MN2); worst case the budget cap prevents an infinite loop with a
  few wasted nudges.
- **Subagent format (V8).** If no first-class plugin-shippable subagent format, the 3
  agents degrade to main-agent reference prose and review fan-outs run sequentially
  (findings parity preserved; wall-clock + context-isolation lost) — re-homes the
  auto-fix trigger to the Stop/PostToolUse path.
- **Sandbox read/write scope (B-3, re-scoped — MJ4).** FSM state is **project-local**
  (`${CLAUDE_PROJECT_DIR:-.}/.zensu/state`), NOT `~/.zensu/state`; there is no shared
  state dir, so the single-vs-per-dest `ZENSU_HOME` choice has **no** state-coherence
  consequence (state root = project dir regardless of which dest's hooks.json fired). The
  real sandbox unknowns to verify (V12): (a) can a sandboxed hook **read**
  `~/.zensu/plugin-root` + `~/.zensu/config.json` outside the plugin dir under
  `sandbox-exec`/`nsjail`; (b) can hooks **write** `$workspace/.zensu/state`. Only (a)/(b)
  could force a change, not state topology.
- **plugin.json key acceptance (V6).** `agents`/`workflows`/`rules`-array + `hooks`
  string-ref unverified; mitigated by shipping conventionally-named files so discovery
  works even if a key is rejected.
- **Context-nudge unwired (MN4).** Reads a CC-specific transcript-occupancy schema
  (`message.usage.*`) AG won't match → ships **unwired** with its essence folded into
  `rules/zensu-conventions.md`; re-wire to PreInvocation only once the AG transcript format
  is verified.
