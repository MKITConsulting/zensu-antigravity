# Native Zen reaction evaluation

This opt-in suite uses the configured Antigravity account and is NOT a CI gate. It measures
model reaction to the full and compact Zen contracts in eight synthetic prompts, each in a
fresh disposable workspace. Deterministic assertions cover concise full sentences, scope,
safety exceptions and honest chain-progress anchors. The scenario text is checked against
the real hook by `test-promptfoo-zen-mode.sh` and `test-zen-mode.sh` without model calls.

Run `ZENSU_LIVE_AGY=1 bash run-eval.sh` here. The underlying command is
`promptfoo eval -c promptfooconfig.yaml`; the provider delegates to the existing bounded
`agy-live-provider.js` generic prompt route with `vars.prompt = spec_block`.
Without explicit live opt-in, or without a successful nonempty native response, the provider
returns a named unverified outcome and the transport assertion fails. An empty transcript
cannot satisfy the safety absence checks. A live reaction result proves model prose only;
this suite does not attest tool-execution absence, the real hook injection path, independent
review execution or the chain gate. Those require their dedicated native probes.

The adapter encloses observed native prose in `[assistant_text]` for the existing graders.
It does not manufacture tool-call sections or execution attestations. The eight scenarios
retain their canonical assertion bodies and are repeated three times to expose variation.
Review a failed style proxy in context instead of treating it as a product correctness gate.
