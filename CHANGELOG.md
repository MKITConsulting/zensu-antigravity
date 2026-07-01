# Changelog

All notable changes to `zensu-antigravity` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
