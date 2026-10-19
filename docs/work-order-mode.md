# Work-order mode

`/zensu-work` consumes a claimed Zensu work order and its lease. `/zensu-autopilot --order` follows the canonical order state machine instead of the interactive plan-approval event. Exact order, lease owner, session and pipeline bindings are mandatory. The worker cannot claim a foreign conversation or infer ownership from a title.

The native launcher uses a two-stage lifecycle. First run `node harness/launcher.js --prepare --project '<absolute-project>'`; the native sidecar creates a real conversation and returns its UUID. Only then may the authorized external claimant bind `order.client_session_id` to that UUID. Launch with `node harness/launcher.js --order '<order-id>' --conversation '<prepared-uuid>' --project '<absolute-project>'` to resume the same conversation. Do not invent a `--session-id` option or claim an alias before the real host identity exists.

The session helper routes `--helper work-order -- <arguments>` into the canonical runtime and uses the native binding. Polling, stage admission, terminal reporting, artifact publication and recovery follow `skills/work/SKILL.md`, its protocol references and `skills/autopilot/rules/work-order.md`. Invalid or expired claim/lease data fails closed. Delivery routes control authorized publication; they do not grant merge/deploy permission.

## Launcher events

`conversation_prepared` names the real conversation created before claiming an order.
`session_started` is emitted only after this launch's private shim witness records a
`PreInvocation` for that exact prepared conversation. Model stdout is never the proof.
`exited` reports success only when the native process exits successfully and the canonical
work-order state records a delivered successful outcome.

The source launcher's `rate_limited` notification has no verified native equivalent yet.
Native model stream shapes are not interpreted as rate-limit status; no reset time or
account limit is inferred from model prose. Lease supervision and terminal outcome checks
remain active while the host handles its own retries.
