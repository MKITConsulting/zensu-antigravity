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

Native capture passed on Antigravity CLI 1.4.7 with Gemini 3.8 Flash medium and
Zensu CLI 0.11.0 on 2026-10-25. The real host declared the agreed goal, edited and
committed a disposable fixture, submitted its clean HEAD, and repeated the
checkpoint. Both repetition and native Stop returned `already_submitted`.
Independent CLI read-back verified authenticated attribution, exactly one start
and one submission, and no human decision. See the [native validation report](validation/2026-10-25-native-ai-work-capture.md)
for source binding, observed startup latency and the limits of this result.

Earlier quota-blocked probes below remain historical evidence, not successful
native validation.

Deterministic fixtures cover native binding, one-use helper authorization,
child refusal, durable retries and nonblocking capture errors. An isolated
staged-plugin probe on 2026-10-24 confirmed native startup and Stop-chain delivery
for its own conversation. Antigravity then returned RESOURCE_EXHAUSTED (429)
because the account quota was exhausted. No model result or work submission was
produced, so that probe did not verify full native capture. The installed
plugin and existing conversations were not modified.

A fresh isolated Antigravity CLI 1.4.7 probe on 2026-10-25 at 14:35 UTC
again observed startup and Stop delivery for its own native conversation. The
provider returned RESOURCE_EXHAUSTED (429), reporting 6h7m until reset at the
observation time. No model result or work submission was produced. The tested
runtime was `c9f5120d672a31d10e16057db1238e544f99a314`, before synchronizing the
subsequent feature-context documentation/read mapping from main. Full native
capture remained unverified by that probe; unchanged configuration hashes do not
substitute for that missing result.
