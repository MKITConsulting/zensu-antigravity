# Browser verification rules

The self-contained verification loop for `/zensu-verify-feature`. It has **two modes**, both
first-class:

- **Mode A — driven.** The host browser driver (Antigravity's built-in browser/preview
  tooling) supplies `NAVIGATE` + `SNAPSHOT` + `INTERACT`; the agent drives the UI.
- **Mode B — guided manual.** No such driver this session (or `--driver=manual`). The agent
  emits a precise numbered verification script, the user runs it, and the observations come
  back as evidence.

The mode is fixed in Phase 0 and named in the report. Both modes execute the SAME Phase 1
matrix, assert the SAME three evidence planes, and end with the same verdict rules. Mode B is
never an error path and never a reason to abort.

Capability names below (`NAVIGATE`, `SNAPSHOT`, `INTERACT`, `SCREENSHOT`, `VIEWPORT`,
`CONSOLE`, `NETWORK`, `ISOLATE`) refer to the capability contract in `SKILL.md`, never to a
specific tool name. Resolve them against what the host advertises; if a required capability is
absent, degrade as the contract prescribes.

## 1. Establish the observation baseline

0. Before opening protected content, validate the recipe's `validate.evidenceSafety` block per
   `local-runtime.md`: exact route coverage must prove synthetic or pre-classified
   non-sensitive data. Enforce this fail-closed **before** navigation, login, or screenshot,
   because a navigation result can itself carry a page snapshot. Without a valid covering
   declaration, do not open the protected route; report PARTIAL.
1. Confirm the target URL is on the run allowlist, navigate, then re-check the URL the driver
   reports after redirects. Off-allowlist landing ends the row: read no evidence from it.
2. Take a `SNAPSHOT` before interacting. Confirm the URL, title/heading, authentication state,
   and that the page is not a generic error or login wall.
3. Read `CONSOLE` and `NETWORK` for the baseline only when direct inspection is safe (see the
   runtime-signals boundary below). Mark pre-existing unrelated noise separately; never use it
   to hide a new feature error.

The semantic snapshot is the primary source for structure and actionable element references.
Screenshot pixels are for appearance. Console/network evidence is for runtime behavior. None
of the three substitutes for the others.

## 2. Interact in small observable steps (Mode A)

For each scenario:

1. Put the app in the matrix row's declared setup state through real UI or repository-owned
   fixture paths.
2. Take a fresh snapshot and select the next action from the current element references.
3. Perform one meaningful interaction: click, type, select, key press, or dialog response.
4. Wait for a specific UI or request condition, not an arbitrary delay.
5. Snapshot again and record the changed state.
6. Repeat until the scenario reaches its assertion checkpoint.

Do not reuse stale element references after navigation or a material re-render. Never run
arbitrary script inside the page, including for read-only inspection: page evaluation can read
authenticated DOM and stored session data and step around the allowlist boundary. If snapshots
cannot expose a required value, report that evidence plane PARTIAL. The same applies to
file-upload-by-path and to any cookie/storage capability: report the dependent scenario PARTIAL
instead of reaching past the boundary.

## 3. Run the guided manual script (Mode B)

Render the matrix as an executable script for a human, then wait for the reply. Never fabricate
an observation, never assume a step passed, and never continue to the report before the user
answers.

**Script format** — one block per matrix row, P0 first:

```
### S1 [P0] <scenario name>
Setup: <exact state to start from — route, seeded record, viewport, logged-in or anonymous>
1. <one concrete action>
   Expect: <the single observation that proves this step>
2. <next action>
   Expect: <observation>
Checkpoint: <the DOM/data fact, the visual fact, and the request effect that decide this row>
```

Rules for the script:

- Preamble first: how to start the app (the resolved runtime commands, or "use the instance you
  already have running"), the exact base URL, and how to reset between scenarios.
- One action per numbered step, each with its own `Expect:` line. A step with no expected
  observation is not a verification step.
- Name concrete UI anchors (visible label, heading, row text), never CSS selectors.
- Keep every step safe: no destructive or externally visible action without the explicit
  confirmation the boundaries require.
- Mark rows the user may skip (`P2`) so a short session still covers P0.

**Evidence template** — ask for exactly this back, and say that anything not answered counts as
not verified:

```
S1.1 observed: <what you saw>
S1.2 observed: <what you saw>
S1 visual:     <layout/styling/legibility as it actually looked>
S1 console:    clean | <error class + short message, credentials removed>
S1 network:    clean | <method + path + status, no query string>
S1 result:     pass | fail
```

Ask for a screenshot only when the visual assertion needs it, and only for a screen that holds
no credentials or personal data. Console/network lines are optional: the user copies them from
their own browser devtools with tokens, cookies, authorization values, query strings, and
personal data removed. Missing runtime lines make that plane PARTIAL for the row, not a
failure.

**Login in Mode B** stays credential-blind by construction: the user logs in in their own
browser. Never request a password, token, cookie, or session export, and never accept one if it
is volunteered — if a credential appears in the reply, do not repeat it in the report.

If the driver breaks partway through Mode A, emit the Mode B script for the remaining rows and
mark in the report which rows were driven and which were user-reported.

## 4. Assert three evidence planes

Every acceptance criterion needs the applicable evidence below, in either mode.

### DOM and data

- Assert visible names, values, rows, validation messages, enabled/disabled state, focus, and
  route changes against the post-action snapshot (Mode A) or the user's reported observation
  (Mode B).
- For mutations, prove the persisted result by reloading or revisiting through the real UI.
- For loading/error/empty paths, prove both the transient/failure state and the recovery when
  the scenario requires it.

### Visual

At every matrix checkpoint, capture a `SCREENSHOT` and **inspect the returned image** (Mode A)
or collect the user's visual line (Mode B). Write a concrete observation covering:

- no overlap, clipping, off-screen controls, or broken stacking;
- readable text and correct visual hierarchy;
- expected placement, spacing, and applied styling rather than an unstyled shell;
- the specific open/selected/error/loading state the scenario claims;
- narrow and wide layouts when responsive behavior is relevant (`VIEWPORT`, or a second
  manual pass at a narrow window width).

A screenshot filename without a description is not evidence. DOM-correct but visually
uninspected is PARTIAL.

### Runtime signals

After each scenario, inspect console and network activity scoped to its actions, subject to
this boundary: raw results reach the model before final-report redaction. Direct inspection is
permitted only for a proven unauthenticated, synthetic, secret-free target. There is no trusted
model-visible sanitizer for authenticated runtime signals; skip that plane and report PARTIAL
rather than reading it on an authenticated target.

- Feature-related uncaught errors, failed resource loads, or unexpected warnings fail the
  scenario unless explicitly expected by the criterion. Record only a bounded, sanitized error
  class/message and source path. Redact tokens, cookies, authorization values, signed URLs,
  query/fragment values, headers, bodies, personal data, and secret-shaped strings; never quote
  raw console output.
- Missing expected calls, request failures, and unexpected 4xx/5xx responses fail the scenario.
  Record method, path without query/fragment, and status only; never include headers, bodies,
  credentials, tokens, or personal data.
- A deliberately tested error response passes only when both the response and the rendered
  recovery/error UI match the expectation.

## 5. Scenario isolation and safety

- Use unique fixture names containing the run identifier.
- Reset filters, navigation, and record state between rows. Start a fresh `ISOLATE` context
  when cookies/local storage or cached app state would contaminate the next row; without that
  capability, order the rows to avoid leakage and state the residual risk.
- Never enable a storage/session capability and never accept an auth artifact. Re-authenticate
  visibly when a fresh context is required; otherwise report the row PARTIAL.
- Do not screenshot credentials, tokens, personal data, or unrelated sensitive content, and do
  not ask the user for such a screenshot.
- In remote mode, stop before irreversible or externally visible mutations unless the user
  explicitly approved that exact action.

## 6. Close with contemporaneous evidence

Maintain the report table while driving — or while the user's replies arrive. For each row,
capture:

- expected and observed behavior, and whether the observation is agent-driven or user-reported;
- the snapshot fact;
- the screenshot and the actual visual observation;
- relevant console/network signals;
- exact reproduction for a failure.

Close the browser surface this run opened, even after a failed assertion or a cancelled login.
In Mode B, tell the user which processes remain theirs to stop. The parent skill owns the
remaining process, container, and temp-dir cleanup.
