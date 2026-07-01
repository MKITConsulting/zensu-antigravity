# zensu-antigravity — BUILD CONTRACTS (non-negotiable canonical facts)

Every builder (human or agent) copies these EXACTLY. They encode the reconciled decisions
+ the review amendments. Drift here is what the review round caught — do not paraphrase.
Target repo: `/Users/marcelkarras/IdeaProjects/dev.zensu/zensu-antigravity`.
Port source (READ-ONLY): `/Users/marcelkarras/IdeaProjects/dev.zensu/zensu-claude-code` (CC),
with `zensu-codex` / `zensu-kiro` as adaptation references.

## C1 — Invocation & file naming
- User command: `/zensu-<name>`. Workflow file: `workflows/zensu-<name>.md` (stem = command).
- Skill dir: `skills/<bare-verb>/SKILL.md`; frontmatter `name: <bare-verb>`, `description: …`.
- The 13 verbs: autopilot, bootstrap, ghost-scan, implement, plan-review, pr-fix-findings,
  pr-team-review, pulse, reset-review-limit, self-review, security-review, tdd, zensu-help.

## C2 — Shim command grammar (BK1)
- hooks.json command string (in `hooks.json.template`, `__ZENSU_HOME__` rendered by install):
  `bash __ZENSU_HOME__/hooks/antigravity/antigravity-shim.sh <bare-script>.sh`
- The shim resolves `SCRIPT="$ROOT/hooks/$1"`. **`$1` is a BARE name — never contains `/`.**
  `test-hooks-json-shape.sh` asserts this.

## C3 — Tool names (facet-3 verified) + matchers
- Shell tool: `run_command`; command at `toolCall.args.CommandLine`, cwd at `toolCall.args.Cwd`.
- File writers: `write_to_file`, `replace_file_content`, `multi_replace_file_content`; path at
  `toolCall.args.TargetFile`. (No `edit_file`/`create_file`/`apply_patch` exist.)
- **Edit matcher (exact, BK4):** `write_to_file|replace_file_content|multi_replace_file_content`
  — never drop `multi_replace_file_content`; never add CC `Edit|Write|MultiEdit`.
- MCP matcher `call_mcp_tool` — UNWIRED (D6).

## C4 — Payload normalization (the shim, normalize-payload.js)
Antigravity (camelCase, nested) → CC flat snake_case that wrapped scripts read:
- `toolCall.name` → `tool_name`
- `toolCall.args.CommandLine` → `tool_input.command`
- `toolCall.args.TargetFile` (probe also `AbsolutePath|FilePath`) → `tool_input.file_path`
- `toolCall.args.Cwd` → `cwd`   (command cwd — DISTINCT from project dir)
- PostToolUse result stdout (probe `Output|stdout|result`) → `tool_response.stdout`;
  exit → `tool_response.exit_code`; interrupted → `tool_response.interrupted` (BK7)
- `session_id` passthrough (synth if absent, C6); `transcriptPath|transcript_path` →
  `transcript_path`; `hook_event_name` passthrough.
- **`CLAUDE_PROJECT_DIR` ← `workspacePaths[0]` (workspace root), exported by the shim BEFORE
  running the wrapped script (BK6).** Do NOT derive it from the command cwd.
- Fail-open: any parse error → pass raw payload, shim still exits 0.

## C5 — Hook output contract (the shim, emit-verdict.js)
- Verdict at TOP LEVEL of stdout JSON; **always exit 0** (exit 2 only when CONTRACT=exit).
- `ZENSU_AG_HOOK_CONTRACT` ∈ {`superset`(default), `allow_tool`, `decision`, `exit`}.
  - superset DENY = `{"allow_tool":false,"deny_reason":R,"decision":"deny","reason":R}` (PROBE
    default — V1 must confirm a strict parser doesn't reject the conflicting keys; MJ2).
  - allow_tool DENY = `{"allow_tool":false,"deny_reason":R}`; decision DENY = `{"decision":"deny","reason":R}`.
- CONTEXT (from CC `additionalContext`) = allow + carry the context text; **per-turn de-bounce**
  (hash script+context → `.zensu/state/preinv-<sid>.txt`; suppress identical re-emit same turn; BK5).
- BLOCK (from CC `decision:block`, Stop): `ZENSU_AG_STOP_BLOCKS` ∈ {`0`(default)=advisory context,
  `1`=emit Stop-block shape} (MJ8b).
- Classification map (wrapped CC stdout → verdict): `hookSpecificOutput.permissionDecision:deny`
  → DENY; `hookSpecificOutput.additionalContext` → CONTEXT; `decision:block` → BLOCK; else → RAW
  (passthrough, NEVER surface wrapped exit code → a crashed gate fails OPEN, MN3).

## C6 — Session id (kiro pointer-first)
- Order: explicit param → `.zensu/state/session-id-current.txt` → inert transcript helper → PPID cache.
- Synth when payload lacks `session_id`: **`ag-$(zensu_session_key)`** (stable across the turn's
  hook subprocesses — NOT `$$`; MJ3). `zensu-session.sh` ported from kiro.

## C7 — Lib vs top-level header rule (BK9 — protects upstream diff base)
- `hooks/lib/*.sh` headers: **BYTE-IDENTICAL to CC** (`: "${CLAUDE_PLUGIN_ROOT:=$(cd
  "$(dirname "$0")/../.." && pwd)}"`). DO NOT widen.
- Widen the root chain ONLY in top-level `hooks/*.sh` (one level `dirname/..`) + `zensu-runtime.sh`:
  `CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|ANTIGRAVITY_PLUGIN_ROOT|ZENSU_PLUGIN_ROOT` → `~/.zensu/plugin-root`.

## C8 — Env vars
- Ported unchanged: `ZENSU_MCP_GATE`, `ZENSU_BASH_WRITE_GATE`, `ZENSU_TDD_GATE`, `ZENSU_CHAIN`,
  `ZENSU_TEST_WITNESS`, `ZENSU_BSWGATE_TEMP_DIRS`.
- New (Antigravity): `ZENSU_AG_HOOK_CONTRACT`, `ZENSU_AG_STOP_BLOCKS`.

## C9 — Marker contract (zensu-log.sh — unchanged from CC)
`--tdd-begin`, `--phase <p> --step <id> [--reason r]`, `--tdd-complete`, `--code-review-done`,
`--self-review-fixed`, `--chain-done`, `--workflow-begin --tools "<csv>"`, `--workflow-end`,
`--pending-review …`, `--mode`, `--tdd-reset`. State → `.zensu/state/{tdd-phase,rounds}-<sid>.json`.

## C10 — hooks.json.template events (final wiring)
| Event | Matcher | Wrapped scripts (bare names, in order) | timeout |
|---|---|---|---|
| PreToolUse | `write_to_file\|replace_file_content\|multi_replace_file_content` | pre-edit-tdd-reminder.sh | 30 |
| PreToolUse | `run_command` | pre-bash-zensu-gate.sh, pre-bash-source-write-gate.sh | 30 |
| PreInvocation | (none) | user-prompt-intent-router.sh, user-prompt-tdd-reminder.sh | 10 |
| PostToolUse | `run_command` | post-bash-witness.sh | 10 |
| Stop | (none) | stop-chain-enforcer.sh | 15 |
- context-nudge UNWIRED (MN4). NO Scenario-A subagent PostToolUse entry (MJ5).

## C11 — plugin.json (root manifest)
- `name:"zensu"`, `version:"0.1.0"`, `description`, `author`, `repository`,
  `license:"FSL-1.1-Apache-2.0"`, `keywords:[…,"antigravity"]`.
- `agents:["./agents/zensu-plm.md","./agents/zensu-code-reviewer.md","./agents/zensu-review-aspect.md"]`
- `skills:["./skills/<verb>" ×13]`, `rules:["./rules/zensu-conventions.md","./rules/zensu-tdd.md","./rules/zensu-write-gate.md"]`
- `workflows:["./workflows/zensu-<name>.md" ×13]`, `hooks:"./hooks.json"` (string). NO `mcp` key.

## C12 — Agents (md + frontmatter)
- Files: `agents/zensu-{plm,code-reviewer,review-aspect}.md`.
- `zensu-code-reviewer`: `tools: read, run_command, grep, glob` (write-free).
- `zensu-review-aspect`: `tools: read, grep, glob` (no run_command).
- Drop `TaskCreate`/`TaskUpdate`. Bodies = CC bodies + the C13 sweep.

## C13 — Prose tool-name sweep (skills/agents/rules bodies)
`# /zensu:<n>`→`/zensu-<n>` (+ body cross-refs); `Bash`→`run_command`; `Edit/Write/MultiEdit`→the
edit tool; `Task`/`Agent`/`subagent_type=`/"spawn …review-aspect"→AG subagent spawn (or sequential
fallback); `AskUserQuestion`→plain numbered question; `~/.claude/`→`~/.gemini/`; `CLAUDE.md`→
`AGENTS.md`(+`GEMINI.md`); "SessionStart hook (provides plugin-root)"→"the install step / `~/.zensu/
plugin-root`". KEEP verbatim: `{PLUGIN_ROOT}`, `zensu-log.sh --phase …`, `gh api`, `git …`.

## C14 — Rules (plugin-level, always-on, ≤~120 lines total)
- `rules/zensu-conventions.md`: constitution (what Zensu is; KEY-N/[ZEN-42]/lifecycle; routing =
  intent-router essence; banner one-liner; **context-compaction nudge essence**, MN4).
- `rules/zensu-tdd.md`: tdd-reminder + plan-decision essence (plan→ask TDD-vs-direct before first
  edit; vanilla note; review-chain finish). German literal lists stay in the hook, not here.
- `rules/zensu-write-gate.md`: rationale only (mutations gated outside a workflow = nudge; reads free).

## C15 — Language & commits
- English-only. ONLY exception: the sanctioned German TDD-preference match-literals inside
  `user-prompt-tdd-reminder.sh` (kept in lockstep across strict+vanilla variants). Conventional Commits.

## C16 — Tests gate
- `tests/run-all.sh` runs `tests/structure/test-*.sh` AND `evals/config-gate/run-eval.sh --self-check`.
  Deterministic only (no `--live` in v1). `node`+`jq` available; shim fail-opens if `node` absent.
