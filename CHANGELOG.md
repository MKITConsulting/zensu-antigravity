# Changelog

All notable changes to `zensu-antigravity` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **skills**: Eight new capabilities, each with its `/zensu-<name>` workflow shim —
  `/zensu-cover` (durable tests at the right level), `/zensu-verify-feature` (live
  verification of a built feature), `/zensu-pilot` (guided pipeline conductor),
  `/zensu-docs` (code-grounded per-feature documentation), `/zensu-converge` (flow-back
  audit of code against the plan), `/zensu-wargame` (executable-blind battle plan),
  `/zensu-doctor` (read-only setup diagnostics), and `/zensu-setup` (interactive
  first-run configuration).
- **agents**: `zensu-review-judge` — an independent second pass between the merged aspect
  findings and the consolidating reviewer, covering cross-cutting integration, requirement
  drift, and missed edge cases, and grading the panel itself (`Panel-FP:`). Plus
  `zensu-plan-review-worker` and `zensu-pr-review-worker` evidence workers.
- **hooks**: Secret-scan gate. `pre-write-secret-scan.sh` denies a write whose body carries
  a real-looking credential, and the raw-shell write gate scans the same content, so a
  credential cannot be smuggled through a heredoc or a redirect.
- **vcs**: Forge driver (`hooks/lib/zensu-vcs.sh`) with GitHub and GitLab detection and
  provider-agnostic PR/MR operations, wired into `pr-fix-findings`, `pr-team-review`, and
  `autopilot`. SSRF-hardened (host denylist, DNS resolution with private-IP rejection,
  TOCTOU-pinned requests).
- **pr-team-review**: Reviewer pool expanded 15 → 25 with an always-on core set and a
  challenge round against groupthink, always-on changed-code test-coverage evaluation
  rendered as a compact status table, and pre-publish inline-comment anchor validation
  (`hooks/lib/valid-diff-lines.js`) so no comment is posted against a line the diff does
  not contain.
- **tdd,autopilot**: Stable requirement IDs (`AC-###` / `FR-###`) allocated once in the plan
  and carried end to end through implementation, review, and validation.
- **autopilot**: Durable orchestration state (`hooks/lib/zensu-autopilot-state.sh`) so a run
  survives across sessions.
- **templates**: Artifact templates (`templates/`) with repo override, plus the shared
  additive-only repo-overlay mechanism (`hooks/lib/zensu-overlay.sh`) used by `tdd`,
  `cover`, and `pr-team-review`.
- **tdd**: Activation triggers and repo-local review personas
  (`hooks/lib/persona-activation.js`).
- **hooks**: Bypass ledger — every deliberate gate opt-out is recorded and surfaced instead
  of applied silently.
- **ghost-scan**: Multi-component scope gate and a cross-component deep journey pass.
- **evals**: `evals/promptfoo` — a 94-scenario offline capability proof suite driving the
  real hooks and libraries through an `exec:` provider in a disposable sandbox. Runs in CI
  as part of `tests/run-all.sh`; a results verifier fails the suite if a catalogued
  scenario silently never ran.

### Fixed

- **hooks**: The shim never normalized the writer tools' body argument, so any
  content-inspecting write gate was a silent no-op. `normalize-payload.js` now probes the
  writer body and folds replacement chunks.
- **hooks**: Non-hook state writers (`zensu-log.sh --chain-done`, `--tdd-*`, `--phase`)
  inherit no project dir from the host, so inside a worktree they anchored state to the
  terminal's cwd and could deadlock the Stop-hook review chain. A cwd-independent resolver
  (`hooks/lib/resolve-project-dir.js`) recovers it at one choke point.
- **tdd**: The review-chain Stop backstop is re-armed for every session chain.
- **tests**: The skill-frontmatter check read only the first line of a `description`, so
  folded YAML descriptions skipped the length and prefix assertions entirely and three
  over-long descriptions had passed. The extractor now understands folded and literal
  blocks, and the manifest/pairing cardinalities are derived from the filesystem instead of
  frozen literals.

### Changed

- **skills**: Every skill description now opens with the `[Zensu] ` marker.

## [0.1.0] - 2026-06-30

### Added

- Initial release of Zensu — a Product Lifecycle Manager plugin for Google Antigravity.
- Native `plugin.json` manifest with 13 skills, 13 `/zensu-<name>` workflow shims, and
  3 subagents (`zensu-plm`, `zensu-code-reviewer`, `zensu-review-aspect`).
- Event hooks wired through `hooks/antigravity/antigravity-shim.sh` — the single
  host-translation layer that normalizes payloads and emits verdicts.
- Always-on `rules/` steering (`zensu-conventions`, `zensu-tdd`, `zensu-write-gate`) for the
  behaviors that have no Antigravity hook event (the session banner/primer and the per-prompt
  advisories).
- Lazy first-call session-id capture (Antigravity has no SessionStart event), so per-session
  FSM state and the pulse journal still converge.
- `install.sh`: stage the plugin into the IDE and CLI plugin paths, generate `hooks.json`
  with absolute paths from `hooks.json.template`, seed `~/.zensu/config.json`, and write the
  `~/.zensu/plugin-root` pointer.
- CLI-driven: every Zensu operation runs through the typed `zensu` CLI (≥ 0.2.0); the plugin
  ships no MCP configuration.
- Deterministic offline test gate (`tests/run-all.sh`): the `tests/structure/test-*.sh` suite
  plus the `evals/config-gate` offline matrix.
