# Changelog

All notable changes to `zensu-antigravity` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/), and the project tracks
parity with upstream
[`zensu-claude-code`](https://github.com/MKITConsulting/zensu-claude-code).

## [Unreleased]

## [0.1.0] - 2026-06-30

### Added

- Initial Google Antigravity port of the Zensu PLM plugin (v0.10.0 upstream baseline).
- Native `plugin.json` manifest with 13 skills, 13 `/zensu-<name>` workflow shims, and
  3 subagents (`zensu-plm`, `zensu-code-reviewer`, `zensu-review-aspect`).
- Event hooks wired through `hooks/antigravity/antigravity-shim.sh` — the single
  Antigravity stdout/exit translation layer that normalizes payloads and emits verdicts.
- Always-on `rules/` steering (`zensu-conventions`, `zensu-tdd`, `zensu-write-gate`)
  replacing upstream's SessionStart / UserPromptSubmit advisory hooks, which have no direct
  Antigravity event analog.
- Lazy first-call session-id capture (no SessionStart event), so per-session FSM state and
  the pulse journal still converge.
- `install.sh`: stage the plugin into the IDE and CLI plugin paths, generate `hooks.json`
  with absolute paths from `hooks.json.template`, seed `~/.zensu/config.json`, and write the
  `~/.zensu/plugin-root` pointer.
- CLI-driven: Zensu is driven through the typed `zensu` CLI (≥ 0.2.0); the hosted MCP server
  is intentionally unwired (mirroring upstream #117), shipped as an empty `mcp_config.json`.
