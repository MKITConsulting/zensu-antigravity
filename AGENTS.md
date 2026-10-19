# zensu-antigravity Repo Conventions

`zensu-antigravity` is **Zensu — a Product Lifecycle Manager plugin for Google Antigravity.**
It packages feature tracking, phase-gated TDD, a multi-perspective review chain, security
reviews, and release-readiness gating as a native Antigravity plugin (`plugin.json`,
`skills/`, `commands/`, `agents/`, event hooks) and drives Zensu through the typed
`zensu` CLI.

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
and vanilla) — never edit one variant alone. Outside the hook directives these literals
appear only as verbatim citations in the places permitted above — never as prose.

## Conventional Commits

Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, …).

## Version bumps — the same-value invariant

The version lives in **three** places that must carry the same value in the same commit:

1. `plugin.json` → `"version"`
2. `README.md` → the `version-X.Y.Z-blue` badge
3. `CHANGELOG.md` → the newest `## [X.Y.Z]` heading

Commit subject: `chore(release): bump version to X.Y.Z`. Machine-enforced by
`tests/structure/test-version-sync.sh`. There is **no marketplace manifest** — Antigravity
has none, so there is no fourth file. The `Release` workflow bumps all three together; for a
manual hotfix follow the invariant by hand.

## Architecture invariants

- **Translation is confined to `hooks/antigravity/`.** Keep these responsibilities separate:
  `normalize-payload.js` maps the camelCase/nested host payload to the flat snake_case the
  engine-neutral scripts read; `emit-verdict.js` owns the per-event verdict dialect, including
  the deliberate policy call that a PreToolUse advisory is DROPPED rather than mapped (see the
  per-event contract below); and `antigravity-shim.sh` owns transport plus the per-turn
  advisory de-bounce. The sibling session, helper, transcript, instruction and worker
  adapters own native identity and execution. Nothing outside this directory may know the host exists — the
  `hooks/lib/*.sh` helpers stay engine-neutral.
- **The host's own spec is authoritative — read it before inferring anything.** agy ships its
  contract at `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/`
  (`hooks.md`, `plugins.md`, `rules.md`, `skills.md`). Three defects shipped because this
  repo reverse-engineered behaviour that was written down: a hook-entry shape the host
  rejects, a verdict dialect it ignores, and a session id it already provides. Read the spec,
  then verify it against a live install — the two disagree in places (see the
  always-on-channel bullet below).
- **Per-event hook contract.** `PreToolUse` / `PostToolUse` take a `{matcher, hooks[]}`
  wrapper; `PreInvocation` / `PostInvocation` / `Stop` take a FLAT list of handler objects.
  The verdict schema is per-EVENT too: PreToolUse requires a decision; neutral/advisory
  results use `{"decision":"ask"}` without advisory text, while deny/ask/force_ask are preserved.
  Native `allow` is restricted to the fully audited registered reviewer/worker launch grant,
  after all gates accept and provenance is recorded; it never applies to ordinary neutral calls.
  An empty PreToolUse object is a native denial, as proved by the gate-disabled live control.
  PostToolUse `{}`, Pre/PostInvocation `{"injectSteps":[{"ephemeralMessage":…}]}`, Stop
  `{"decision":"continue"}` — and on Stop, `continue` is the ONLY value that blocks stopping.
  A wrong shape produces NO install error and nothing in `agy plugin validate`; the host
  logs `Failed to parse hooks for plugin …` to its own CLI log and runs without that group.
  The vocabulary lives in `tests/fixtures/host-hook-events.txt`; the shim's second argument
  carries the event so `emit-verdict.js` can pick the dialect.
- **The plugin-owned rules channel works on the verified CLI.** agy 1.4.2 loads
  `rules/AGENTS.md` from a discovered plugin without a manifest `rules` key. Live checks
  verified directory discovery and `.agents/plugins.json` entry discovery with isolated
  positive/negative controls. The earlier agy 1.1.10 inert-rule result is historical.
  Keep `rules/AGENTS.md` as product policy, below 24 KB, and include `rules/` in staging and
  runtime digest coverage. Do not install this repository's development AGENTS.md as
  product guidance. Never edit the user's workspace AGENTS.md without authorization.
  Always-on prose cannot grant a helper receipt, independent review or workflow completion;
  the native runtime remains the enforcement boundary. Private conversation binding and
  pulse capture initialize lazily through `session-bootstrap.js` and the startup chain.
- **Native reviewers use actual host provenance.** On agy 1.4.2, correctly typed YAML
  `tools` arrays register named profiles and `invoke_subagent` creates distinct child UUIDs.
  The exact request is `Subagents: [{TypeName, Role, Workspace: "inherit", Model: "inherit",
  Prompt}]`. Bind each child from the actual parent spawn step, metadata and initial parent
  linkage before its first tool call; never trust a model-authored agent id. Only normal,
  fully idle child Stop supplies completed-result evidence. Native read-only reviewers cannot
  mutate files/tasks, run commands or spawn children. Plan/PR workers additionally obey a
  private exact-file/safe-root lease and return final raw JSON without messaging. Native
  independent contexts do not prove independent human judgment or artifact completeness.
- **`hooks.json` is generated at install and gitignored.** `install.sh` renders `hooks.json`
  from the tracked `hooks.json.template` (replacing `__ZENSU_HOME__` with absolute paths);
  the generated `hooks.json` is gitignored — edit `hooks.json.template` instead.
- **Plugin-root and session binding.** The adapter resolves its installed root and exports
  `ZENSU_PLUGIN_ROOT` before invoking the neutral scripts. Installation records the separate
  `~/.zensu/antigravity/plugin-root` pointer. Stateful model calls use the exact session-helper
  wrapper and a one-use authorization receipt; caller environment overrides are not authority.
  The lib scripts are **engine-neutral**: they read the normalized payload and know nothing
  about Antigravity. Keep all host-specific resolution in the adapter, never in a lib.

## CLI tool classification

`hooks/lib/zensu-mcp-tools.sh` is the single read/mutation source of truth; it moves together
with `hooks/lib/zensu-cli-map.sh` (the `zensu <noun> <verb>` → canonical-tool-name adapter).
When the Zensu backend gains a new operation, classify it in `zensu-mcp-tools.sh` AND map its
CLI form in `zensu-cli-map.sh` in the same change. The write-gate default-denies anything not
on the read allowlist; `ZENSU_MUTATION_TOOL_NAMES` stays a strict superset of every CLI-map
mutation and every skill's `--workflow-begin --tools` declaration.

## Tests

`bash tests/run-all.sh` is the deterministic gate (no network, no API): the
`tests/structure/test-*.sh` suite plus `evals/config-gate/run-eval.sh --self-check` and the
offline promptfoo suite (`evals/promptfoo/run-eval.sh`).

**The gate cannot see the host.** It proves internal consistency and isolated script
behaviour — both were fully green while three host-contract defects were live. After touching
anything that faces agy (`hooks.json.template`, the shim, `emit-verdict.js`,
`normalize-payload.js`, the command shims, `install.sh`), run the live suite by hand:

    ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh

It drives a real logged-in `agy` (at least one model call per scenario), resolves all 32
commands, reads agy's own CLI log for hook-parse rejections, records which hooks actually fire,
and exercises a full Stop block-and-resume cycle. Without the env var every scenario reports
`LIVE-SKIPPED` and passes, so CI stays hermetic and a stray invocation is visible rather than
silently green.

**Hook firing is observed through the shipped shim, never a patched one.** With
`ZENSU_SHIM_TRACE` set to a file path, `antigravity-shim.sh` appends
`<event> <script> <outcome>` per invocation; unset, it writes no trace. agy forwards its
environment to hook subprocesses, so the live provider just sets the variable — it never edits
the installed plugin.

Three things about that write are load-bearing. The `2>/dev/null` has to come BEFORE the append
redirection, or a bad trace path prints a shell error onto the host's stderr on every hook call.
The `<outcome>` column must stay: `ran` and `bail-*` are different claims, and collapsing them
makes a dropped script read as a hook that fired. And the variable is a two-sided contract — the
shim reads it and writes the file, `evals/promptfoo/lib/agy-live-provider.js` exports it into
agy's environment (honouring an operator-supplied value as an override); rename one side only and
the live suite degrades to a silent `HOOKS-NOT-FIRED`.

**A live probe may only report on evidence it can prove is its own.** Two rules follow from
that, and both have already been violated once:

- Anything read from a SHARED location has to be correlated, not guessed. agy's log directory
  is shared and scenarios run concurrently, so `logWrittenDuring` requires the candidate log to
  name this probe's own throwaway workspace — "the file that grew the most" picks a sibling's
  log exactly when two probes overlap. No match means `LIVE-UNAVAILABLE`, never a verdict.
- "Could not observe" and "observed the wrong thing" are different reports. A probe that
  requires a `PreToolUse`/`PostToolUse` pair while the model never called a tool emits
  `LIVE-INCONCLUSIVE`, not `HOOKS-FIRED-MISSING`; the second sends the next reader to
  `hooks.json.template` for a defect that is not there. Both still fail the run.

**One PreToolUse handler per matcher — do not add a second and assume it runs.** agy
1.1.10 invokes exactly one, deterministically, whatever the layout (`hooks:[A,B]`, two
entries in one group, or two groups); the loser is never invoked and never bails, so nothing
in the install, in `agy plugin validate`, or in the deterministic gate says a word. This
previously left two gates inactive. The single registered handler now dispatches the complete
neutral inventory. A new tool-call gate must join that chain, never register alongside it.
Update `live-hooks-fire-write` / `live-hooks-fire-bash` with the inventory, and preserve the
paired write controls that prove actual denial rather than hook invocation alone.

**The promptfoo result-file shape is implemented once**, in `evals/promptfoo/lib/results-shape.js`,
and both readers (`verify-results.js`, `live/scan-unverified.js`) import it. promptfoo has shipped
a flat `results` array and a nested `results.results`; a private copy that guesses wrong reads zero
rows, and a suite that reads zero rows reports zero failures. `resultRows` therefore THROWS on an
unrecognised envelope — never `|| []`. `test-results-shape.sh` fails if a third copy appears.
