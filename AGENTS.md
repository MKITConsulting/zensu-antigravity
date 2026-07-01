# zensu-antigravity Repo Conventions

`zensu-antigravity` is the **Google Antigravity port** of the `zensu-claude-code` plugin
(a Product Lifecycle Manager). It packages the same behavior as a native Antigravity plugin
(`plugin.json`, `skills/`, `rules/`, `workflows/`, `agents/`, event hooks) and drives Zensu
through the typed `zensu` CLI. Upstream content base: `zensu-claude-code`. Engine-adaptation
precedent: `zensu-codex` (OpenAI Codex CLI port) and `zensu-kiro` (Kiro port).

## Language

**English only.** All code, comments, docs, commit messages, plan files, prompts, fixture
content, and pattern alternations must be in English. Runtime `.zensu/plans/*.md` and
`.zensu/logs/*.log` are local-only artifacts (gitignored, never committed) — not part of the
repository and exempt from this rule. Every tracked file must be English-only.

**Carve-out — verbatim user-utterance match literals.** Hook directive strings — and
verbatim citations of those literals in structure-test pins, in README/CHANGELOG feature
descriptions, and in this carve-out — may contain non-English phrases ONLY as match literals
for real user input: the TDD preference fast-paths (e.g. `'kein tdd'`, `'mit tdd'`,
`'tdd bitte'`) and the generic-action literals that are explicitly NOT a preference (e.g.
`'mach mal'`, `'los gehts'`, `'jetzt umsetzen'`) in `user-prompt-tdd-reminder.sh` /
`plan-approved-delegate.sh`. They exist to recognize what multilingual users actually type,
never as prose. Keep these phrase lists in lockstep across every directive variant (strict
and vanilla) — never edit one variant alone. The `rules/zensu-tdd.md` steering describes the
*behavior* in plain English and does NOT duplicate the literal lists.

## Conventional Commits

Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, …).

## Parity with upstream

Keep skills, agents, the hook FSM, and the config schema mirroring `zensu-claude-code`. When
porting an upstream change, preserve the workflow logic verbatim and adapt only the engine
edges: tool names → `run_command` / the Antigravity file-edit writers, payload field names,
plugin-root resolution, and the shim's stdout/exit mapping.

## Version bumps (D8) — the same-value invariant

The version lives in **three** places that must carry the same value in the same commit:

1. `plugin.json` → `"version"`
2. `README.md` → the `version-X.Y.Z-blue` badge
3. `CHANGELOG.md` → the newest `## [X.Y.Z]` heading

Commit subject: `chore(release): bump version to X.Y.Z`. Machine-enforced by
`tests/structure/test-version-sync.sh`. **Antigravity has no marketplace manifest, so there
is no fourth file** (unlike upstream's `marketplace.json`). The `Release` workflow bumps all
three together; for a manual hotfix follow the invariant by hand.

## Architecture invariants

- **One translator.** `hooks/antigravity/antigravity-shim.sh` is the ONLY Antigravity
  stdout/exit translation layer (D2): it normalizes the camelCase/nested payload to the flat
  snake_case the engine-neutral scripts read, and maps their verdict back to Antigravity
  shape. It makes no policy decisions.
- **Rules, not hooks, for missing events.** Steering that has no Antigravity hook event
  (SessionStart banner/primer, UserPromptSubmit advisories) lives in `rules/` (D3), not
  hooks. Session-id / pulse capture became lazy first-call init.
- **`hooks.json` is generated.** `install.sh` renders `hooks.json` from the tracked
  `hooks.json.template` (replacing `__ZENSU_HOME__` with absolute paths); the generated
  `hooks.json` is gitignored — edit `hooks.json.template` instead.
- **Plugin-root resolution chain.** Top-level `hooks/*.sh` and `zensu-runtime.sh` resolve the
  root via `CLAUDE_PLUGIN_ROOT | CODEX_PLUGIN_ROOT | ANTIGRAVITY_PLUGIN_ROOT | ZENSU_PLUGIN_ROOT`,
  falling back to the `~/.zensu/plugin-root` pointer written at install. `hooks/lib/*.sh`
  headers stay **byte-identical to upstream CC** (the shim exports the root before sourcing,
  so the libs self-resolve) — never widen a lib header, or the upstream-sync diff base breaks.

## CLI tool classification

`hooks/lib/zensu-mcp-tools.sh` is the single read/mutation source of truth (synced from
upstream); it moves together with `hooks/lib/zensu-cli-map.sh` (the `zensu <noun> <verb>` →
canonical-tool-name adapter). When the Zensu backend gains a new operation, classify it in
`zensu-mcp-tools.sh` AND map its CLI form in `zensu-cli-map.sh` in the same change. The
write-gate default-denies anything not on the read allowlist; `ZENSU_MUTATION_TOOL_NAMES`
stays a strict superset of every CLI-map mutation and every skill's `--workflow-begin --tools`
declaration.

## Tests

`bash tests/run-all.sh` is the deterministic gate (no network, no API): the
`tests/structure/test-*.sh` suite plus `evals/config-gate/run-eval.sh --self-check`.
Live-agent e2e is best-effort pending a headless `agy` and is not part of the gate.
