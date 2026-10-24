# Automatic work capture

A personal `zensu auth login` identifies the reporting account. Use Zensu CLI v0.11.0 or newer. The CLI must
provide `ai-work context/start/get/submit`, and the server must provide the
capture endpoints and CLI provenance migration. Missing prerequisites remain
visible incomplete capture; never borrow credentials or change login automatically.

Record one already agreed implementation goal using a stable task key, a concise
objective (at most 160 characters), and the agreed criteria version or digest.
Reuse all three on retries; changed scope uses a new task key. Do not record work
for startup, greetings or read-only questions. Capture applies in direct mode too
and is independent of private Pulse opt-in.

Only a new clean Git HEAD is submitted. A private receipt in the worktree Git
metadata persists stable IDs before requests, binds API host and reporting account,
and retries the same result after interrupted delivery. Dirty or unchanged work,
identity changes and version conflicts remain incomplete. Do not discard pending
receipts to hide an error. A process crash can leave a lock requiring inspection.

Include the returned exact `reviewUrl` at handoff. Human acceptance and revocation
are explicit authenticated web decisions about that result version. Never accept
from an agent, infer approval from a merge/release/test, or operate the decision
dialog on the human's behalf. Later results do not inherit acceptance. Attribution
identifies an authenticated reporting account, not human code authorship.

No code, transcripts, prompts, diffs, file lists, credentials or token usage are
uploaded. Both dashboard scopes use the same canonical units and credits.

## Antigravity

Use the exact native `{session-helper}` prefix from the session bootstrap, with
`--helper ai-work -- begin --task <key> --title <objective> --criteria <version>`
or `--helper ai-work -- checkpoint`. Quote every value. The one-use native
PreToolUse receipt binds the conversation; direct helper calls and model-supplied
workspace/session selectors are refused. Child conversations do not report.
The native Stop chain provides a bounded retry backstop and prints a diagnostic;
checkpoint before handoff to return the review link in the agent's response.

## Validation boundary

The deterministic fixtures exercise native binding, one-use helper authorization,
child refusal, durable retries and nonblocking capture errors. An isolated native
probe on 2026-10-24 discovered the staged plugin but timed out in its existing
PreInvocation chain before a model response. It does not prove successful native
AI work capture or Stop delivery; full native acceptance remains outstanding.
