# Operations

Run `/zensu-doctor` first for session, configuration, evidence or chain failures. It reports before repairing. `/zensu-recover-chain` performs a guarded repair only for a receipt/document contradiction; `/zensu-reset-review-limit` grants a new bounded round budget without clearing unrelated state. `/zensu-adopt-session` handles runtime lineage changes and requires its report/confirm protocol.

`/zensu-tdd-mode`, `/zensu-zen-mode` and `/zensu-delivery-route` use session-bound helpers. Zen mode preserves verification and authority gates. `/zensu-full-suite` records local runs or the explicit CI handoff contract; `deferred-ci` is not a passed CI run. Never forge receipt files or use raw state edits as recovery.

Installation renders `hooks.json` from `hooks.json.template`. Native hook contracts are event-specific. Chained PreToolUse dispatch is necessary because the installed CLI runs one handler per matcher. Run `bash tests/run-all.sh` for deterministic checks and `ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh` for host behavior; `LIVE-SKIPPED`, `LIVE-INCONCLUSIVE` and `LIVE-UNAVAILABLE` are not successful live evidence.

All 32 commands are `/zensu-<verb>` (help is `/zensu-help`). The injected session helper is the only supported stateful entry path. Launching another worker is a separate two-stage native harness operation: prepare a real conversation, bind its exact UUID to the work order, then resume that same conversation. See `work-order-mode.md`.
