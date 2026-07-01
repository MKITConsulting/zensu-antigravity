# Zensu Write-Gate — Why Mutations Are Gated

State-mutating `zensu <noun> <verb>` commands (create / update / status / apply / classify /
revision / …) are **default-denied on the main thread** unless they run inside a Zensu
workflow skill. This is a **convention nudge, not a security boundary** — once the CLI's
token is cached on disk an agent could reach the backend directly. The gate exists so
mutations go through the workflow conventions (dedup, user journeys, baseline revisions,
security classification, release-readiness gates) instead of freelance main-thread calls.

Read / telemetry `zensu` commands (list / get / search / posture / health / `--help` / …)
run **ungated**.

**The right way to mutate:** invoke the matching `/zensu-*` workflow — it opens a sanctioned
window scoped to exactly the commands that workflow declared — or delegate to the
`zensu-plm` subagent, which is exempt by design. Cooperate with the gate rather than fight
it: if a write is denied, reach for the workflow, not a bypass.

Escape hatches exist for a deliberate one-off (e.g. an inline `ZENSU_MCP_GATE=off` prefix,
or `hooks.mcpGate:false` in `~/.zensu/config.json`) but they are the exception — prefer the
workflow.
