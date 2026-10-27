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

- Native conversation: `2ca814bd-c641-4880-b5a6-e584710b7cfd`.
- The real user input was recorded at 21:57:21 UTC. Its first native system
  context and first model step were recorded at 21:57:29 UTC: approximately eight
  seconds, at the transcript's one-second resolution.
- The first invocation contained the Session Control primer and exact bound
  helper. No second prompt or restart was needed. The host log contained no
  hook-parse rejection or custom-hook timeout/failure.
- The unchanged frozen package was loaded through the disposable project's
  `.agents/plugins/zensu` directory, using `--new-project --add-dir`. All 324
  staged file hashes remained unchanged during the run. Subsequent documentation
  and test-harness edits do not change the tested runtime.
- Native `begin` returned `recording`; a native edit appended one requested line,
  and the model committed only README.md and verified a clean worktree.
- Fixture commit: `88d6197ece4c17da54df6ba81677bd5aadec84a6`.
- First checkpoint: `submitted_for_review`; repeated checkpoint and native Stop
  backstop: `already_submitted`.
- Work unit: `f2f2c354-f163-427c-b438-1921558380a9`.
- Result: `c09f2fdd-521a-414c-bf8e-c6d6f316a9d6`.
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
for approvals are separate from the eight-second startup measurement.

This validates the modified startup plus the native capture/tool/Stop path in
one real conversation. It does not certify every orchestration skill, a separate
IDE host or future model reliability. The broader native suite and deterministic
CI are separate release checks.

## Native compatibility and broader probes

The real CLI 1.4.7 uses `read_file`, `write_file` and `edit_file`. The old
normalizer did not classify these names, so write-specific gates could be missed.
The candidate maps their actual `Path`, `Content`, `Target` and `Replacement`
fields, including empty replacements. Those fields take precedence over conflicting
legacy aliases. The final frozen candidate above includes this fix; all 279
runtime files match the current source by SHA-256.

Paired native controls verified that an allowed fixture write succeeds and that
the enabled secret and tracked-source gates deny the corresponding write. The
tracked-source proof requires an exact native command and actual adjacent tool
error. CLI 1.4.7 omits `Cwd`; in that case the probe additionally verifies the
protected main-session workspace binding and native transcript location. Missing
or mismatched evidence fails verification.

The broad live suite was run with an isolated candidate package. All 32 command
resolution probes and the negative command control completed. Final-runtime
probes verified hook parsing, startup/write/Bash hook inventories, secret-write
and shell-secret controls, native roundtrip, plugin rules and worker preparation.
Targeted reruns also verified tracked-source denial and Stop block/resume. The
armed Stop probe intentionally does not complete its workflow and can hit the
probe's 120-second print budget; its positive verdict requires actual enforcing
Stop events and a blocked-then-resumed trace. This is distinct from the startup
handler's 90-second deadline.

The native agent-delegation probe remains **inconclusive**: its own parent did
not issue exactly one completed agent batch, including after a focused retry.
It supplies no evidence of successful delegation and is not counted as passed.
The broad native suite therefore is not claimed fully green. This release's
startup, capture and gate evidence above is separate from that open model-driven
orchestration check and from the deterministic CI gate.

Follow-up: the [2026-10-27 native delegation validation](2026-10-27-native-delegation.md)
reproduced the host-contract mismatch and verified the 0.4.2 correction with two
actual child completions and a protected-file denial.
