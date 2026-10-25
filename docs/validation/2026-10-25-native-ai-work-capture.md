# Native Antigravity AI-work capture validation

- Date: 2026-10-25, 16:07–16:33 UTC.
- Tested source: `4fcbe8c171c200a4c8bc9f64ceffb602c33225cf`.
- Host: Antigravity CLI 1.4.7, Gemini 3.8 Flash medium; Zensu CLI 0.11.0.
- Native conversation: `952711ad-8379-4f10-90ac-1aa5ed9fecfa`.
- Fixture result: `624ff5661c63101bbb29ee27f8bf5b3dbdb5060a`.

## Setup and source binding

A fresh Git fixture loaded a frozen portable plugin through its workspace-local
`.agents/plugins/zensu` directory. The installed global plugin was not replaced.
The documented `--new-project --add-dir` flags created a separate native host
project; the real native binding identified this fixture and frozen plugin.
All 321 staged files retained their original hashes throughout the run.

The model was selected with a process-local `--model gemini-3.8-flash-medium`
flag after earlier probes hit a different model's quota. This run used the host's
existing login and the CLI's existing personal OAuth login. No session identity,
credentials, model responses or API responses were fabricated. Commands and the
fixture edit received individual native permission confirmations. No permanent
tool allow rules were added. Temporary trust entries for the two test directories
were removed afterward; the original CLI settings bytes were restored exactly.

The subsequent merge of main's 0.2.1 release and the 0.3.0 release preparation
changed only version metadata and changelog content. All 278 staged files under `hooks/`, `agents/`, `rules/`,
`skills/` and `commands/` matched the refreshed source byte-for-byte. This report
and the capture guide update do not change that tested runtime.

## Observed behavior

1. The native bootstrap supplied the bound session-helper command. The model
   declared the agreed task, objective and criteria; `begin` returned `recording`.
2. The native edit tool appended one line to README.md. A subsequent read
   confirmed it occurred once. The model committed only that file and verified a
   clean worktree.
3. The first checkpoint returned `submitted_for_review` with the exact result
   review URL. A second checkpoint returned `already_submitted` with the same URL.
4. The actual native Stop chain ran. The host's own log recorded the capture
   checkpoint returning `already_submitted`, without modifying the shipped shim.
5. Independent `zensu ai-work get` after Stop verified version 2 and exactly two
   events (`started`, `submitted`), both with `cli_authenticated` provenance.
   Owner, reporting user and result actor matched. The artifact was the exact
   fixture HEAD above and the criteria were `native-capture-v1`.
6. `decision` remained null and `canManage` was false for the CLI. No acceptance
   or revocation operation was attempted. The native host exited successfully.

## Limitations and rejected probes

The initial PreInvocation startup hook exceeded its existing 90-second deadline.
A later invocation delivered the bootstrap primer, and subsequent tool gates and
Stop completed. No timeout, permission gate or runtime file was changed to obtain
this result. Startup latency remains an observed limitation; this is not a claim
that every startup completes promptly.

Two earlier setup attempts are excluded: one placed the staged payload one
directory too deep and loaded the global plugin, and another started without a
native workspace binding. Neither created a capture goal or result. Earlier 429
quota failures are also excluded. The successful run above is correlated to its
own native conversation, plugin root, fixture and host log.

This verifies the native CLI capture path against the live service. It does not
certify every orchestration skill, a separate IDE host, model reliability in
general, or human acceptance. The submitted fixture remains unaccepted.
