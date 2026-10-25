# Native startup timeout validation

Date: 2026-10-25. Candidate: 0.3.1. Host: Antigravity CLI 1.4.7,
Gemini 3.8 Flash medium; Zensu CLI 0.11.0.

## Defect and bounded change

The earlier 0.3.0 capture run recorded a native PreInvocation handler killed at
its 90-second deadline. Its untimed hook trace does not identify a single slow
engine. A fresh unmodified native control completed normally; the original
incident was intermittent, not a deterministic 90-second sleep.

The old packaged startup launched 112 Node processes. The candidate executes the
same ordered shell engines but composes their JSON, native context and private
per-turn cache inside one process, reducing that count to 75. The host deadline
remains 90 seconds. Tool authorization, native principal verification and Stop
enforcement retain their existing paths.

An offline comparison added 800 ms to every Node launch. The old startup took
97.746 seconds; the candidate took 68.756 seconds. The entire emitted context was
identical after normalizing fixture paths. This is a controlled offline overhead
reproduction, not native latency evidence or a universal startup guarantee. A
separate packaged regression asserts at most 80 Node starts and the continued
presence of the primer, capture helper and human acceptance boundary.

## Native candidate evidence

- Native conversation: `b31c5eb3-380b-4c52-afc8-f79eeb7873c2`.
- The real user input was recorded at 21:28:53 UTC. Its first native system
  context and first model step were recorded at 21:29:00 UTC: approximately seven
  seconds, at the transcript's one-second resolution.
- The first invocation contained the Session Control primer and exact bound
  helper. No second prompt or restart was needed. The host log contained no
  hook-parse rejection or custom-hook timeout/failure.
- The unchanged frozen package was loaded through the disposable project's
  `.agents/plugins/zensu` directory, using `--new-project --add-dir`. All 323
  staged file hashes remained unchanged during the run. Subsequent documentation
  and test-harness edits do not change the tested runtime.
- Native `begin` returned `recording`; a native edit appended one requested line,
  and the model committed only README.md and verified a clean worktree.
- Fixture commit: `0e540fb79129a6fa2f1ddb63a40b63bedfb5b1df`.
- First checkpoint: `submitted_for_review`; repeated checkpoint and native Stop
  backstop: `already_submitted`.
- Work unit: `3b7f205f-96ca-46d8-bdd9-7d8ea4812481`.
- Result: `155a9ba1-8249-4d39-8072-6c7b8828300c`.
- Independent authenticated CLI read after Stop: version 2, exactly `started`
  and `submitted`, matching owner/reporting/result actor, `cli_authenticated`
  provenance, exact fixture commit and `native-startup-v1` criteria.
- Acceptance remained null and `canManage` false. No accept/revoke was attempted.
- Native process exited 0. Global CLI settings were byte-identical before and
  after this run; no persistent tool grants or global plugin replacements occurred.

The model used the existing real login and process-local model selection.
Commands and the fixture edit received individual native approvals. The frozen
runtime was not patched, session identifiers were not invented, and provider/API
responses were not mocked. The model's generation time and time spent waiting
for approvals are separate from the seven-second startup measurement.

This validates the modified startup plus the native capture/tool/Stop path in
one real conversation. It does not certify every orchestration skill, a separate
IDE host or future model reliability. The broader native suite and deterministic
CI are separate release checks.
