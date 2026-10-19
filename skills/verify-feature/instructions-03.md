### Authentication (both modes)

The browser consent gate denies every cookie, local/session-storage and storage-state command
on a `zensu-verify` session, and `open` carries only the run config, which holds no storage
state. This is deliberate: those commands combine state restoration with credential getters
and exporters, so admitting them would violate the credential-blind boundary. Do not invoke
`auth.loginScript`, accept `STORAGE_STATE`, or try to restore browser state by another tool or
another session. A future gate may re-enable opaque state only when it admits a path-contained
setter and hard-denies every getter/exporter.

The evidence boundary is the ORIGIN, never the route. Before authenticating or navigating to
any protected page—including an initial `open` or `goto`, which prints the page title and
writes a snapshot of the page—its origin must be approved: by a parent-environment policy
target that names that origin with `evidenceMode: declared-safe`, or by the user's answer to the
permission prompt the gate raises for that origin. An
approved origin covers every page on it, at any path, including routes whose identifiers change
on every run; no route list is declared, matched or checked. A page on an origin that is not
approved is never opened, and a refused prompt makes that origin's scenarios PARTIAL.
Final-report redaction is too late. The same boundary applies to screenshots. A recipe's
`validate.evidenceSafety` block (`../autopilot/rules/config.md`) is an optional declaration of
the application's data classification; it no longer gates navigation, and a `routes` list left
in it is ignored.

Use this order:

1. **Visible manual login:** navigate a headed browser to the login page, ask the user to
   enter credentials in that browser, and wait for confirmation. Never ask them to paste a
   credential into chat and never type it on their behalf.
2. **No safe path:** skip authenticated scenarios and report PARTIAL. Token extraction or
   `localStorage.setItem(...)` injection is forbidden, including for throwaway remote users.

## Phase 3 — Drive and observe

Load `rules/browser-verification.md` and drive the `browser` rows against the resolved base URL;
every other row follows `rules/drivers.md` section 8.

- Drive P0, then P1, then any affordable P2 rows.
- Reset to a known state between scenarios. Use a fresh isolated context when scenario state
  can leak; re-authenticate visibly when a fresh context is required.
- After every meaningful interaction, take a semantic snapshot before selecting the next
  action. Prefer role/name/ref-based interactions over guessed CSS selectors.
- Capture and actually inspect screenshots at the checkpoints named in the matrix.
- `console` and `requests` output is model-visible before report redaction. Contract v1 has
  no trusted authenticated sanitizer, so do not run those commands on authenticated targets;
  mark that evidence plane PARTIAL. Direct inspection is allowed only for a proven
  unauthenticated, synthetic, secret-free target such as an isolated local fixture.
- Record expected versus observed evidence while running; do not reconstruct it from memory.

Parallel execution is allowed only when each lane has its own run directory, run config and
`zensu-verify` session, its own fixtures, and no shared mutable state. Otherwise execute
sequentially. Parallelism never
reduces the evidence requirements.

## Phase 4 — Cleanup (always)

Run cleanup on PASS, FAIL, cancellation, and setup failure:

- run `playwright-cli -s=<session> close` for every session this run opened; never `close-all`
  or `kill-all`, which end sessions this run does not own;
- run the run-resource helper's `teardown` for `$RUN_DIR` before the run directory is deleted,
  because its ledger lives there (`rules/drivers.md` section 5);
- invoke every accepted recipe's configured `down` command byte-for-byte as a standalone Bash
  call, under `--chain` behind the `cd` prefix of Chain mode point 9 and nothing else; let its
  lease-bound controller stop only the process groups and resources it owns;
- remove only uniquely named containers/resources created by this run;
- delete the run directory last, after every `down` above, which may read what its `up` left
  there, only after `teardown=complete`, and without touching a sibling or out-of-scope path;
  after `teardown=incomplete` keep it, as `rules/drivers.md` section 5 says;
- leave the git worktree and all user-owned services intact.

## Phase 5 — Report

Use this format:

**Verdict: PASS | FAIL | PARTIAL**

| Scenario | Driver | Pri | Expected | Observed | Evidence | Result |
|---|---|---|---|---|---|---|
| ... | ... | P0 | ... | ... | screenshot / snapshot / request | ✅ / ❌ / ⏭ |

- **Target:** mode, base URL, worktree/branch/SHA or deployed identity.
- **Coverage:** `N/N P0`, `N/N P1`, `N/N P2`; name every undriven row.
- **Console:** sanitized error class and bounded message, or `clean`. Redact credentials,
  tokens, cookies, authorization data, signed/query URLs, personal data, headers, and bodies;
  never copy raw console output into the report.
- **Network:** failed, missing, 4xx, or 5xx requests with method/path/status, or `clean`.
  Strip query strings/fragments and never report headers, bodies, credentials, or personal
  data.
- **Visual:** what each screenshot actually showed about layout, clipping, overlap,
  responsiveness, styling, and legibility. “Screenshot taken” is not an observation.
- **Reproduction:** exact steps and captured signal for each failure.
- **Consent:** one line per `(origin, route, decidedBy)` record the session's consent memory
  holds after the run, where `decidedBy` is `asked` (the host raised a consent prompt for this
  origin — the recorder cannot observe how the human answered, only that the navigation then
  executed), `remembered` (any route on an origin already present in the memory — the route is
  never tested), or `policy-mode` (a parent-environment policy the gate accepts authorized
  it). In consent mode also name every prompt the user refused.
- **Limitations:** environment, fixture, auth, or deployment-identity gaps.
- **Other drivers:** the lines `rules/drivers.md` section 8 adds.

Verdict rules:

- **PASS** only when every P0 was driven and passed, every acceptance criterion has the
  evidence planes its driver requires (DOM/data **and** visual proof for `browser`,
  `rules/drivers.md` section 3 otherwise), and relevant console, network and runtime-signal
  evidence is clean.
- **FAIL** when a driven acceptance criterion or P0 behavior is demonstrably broken.
- **PARTIAL** when setup/auth/evidence is incomplete, a required scenario was not driven, the
  remote deployment identity is uncertain, visual inspection is missing, a required tool was
  missing, or a criterion the user sees was proven only through a non-UI driver.

End with exactly one greppable verdict. The final non-empty line must be a bare, unfenced
plain-text line with no backticks, list marker, block quote, or text after it. For a passing run,
that final line is:

VERIFY-FEATURE-VERDICT: PASS

Use the same bare form with `FAIL` or `PARTIAL` as appropriate.

## playwright-cli preflight

Verification drives the browser through `playwright-cli`, the `@playwright/cli` package, which
must be on `PATH`: check with `command -v playwright-cli`. When it is missing, stop with PARTIAL
and name the pinned install route for the user to run — `npm install -g @playwright/cli@0.1.21`,
the version the browser consent gate was measured against; `brew install playwright-cli` is
unpinned and may install a version the run-config helper refuses. Never install it on their
behalf.
`/zensu-doctor` reports whether it is installed and which version. The browser consent gate
parses its arguments as measured against version 0.1.21 and denies an argument shape it does
not recognize rather than admitting it — including a `zensu-verify` session name it does not
resolve as the call's session.

The run config uses the system Chrome channel. When `open` reports that the browser is not
installed, obtain explicit approval for the networked download, then run
`playwright-cli install-browser` WITHOUT a session flag — the gate does not admit it on a
`zensu-verify` session — and retry `open`. Never switch to Firefox or WebKit: the run config's
resolver pins and proxy switch are Chromium switches, and the gate refuses another `--browser`
value. Never drive `playwright-cli` on a session name you chose yourself, and never `attach` to
a running browser: only a `zensu-verify` session opened with the run config sits behind the
consent gate, and a browser outside it has neither the origin restriction nor the
credential-blind command set. Do not silently replace the browser driver with ad-hoc `curl`
checks; that cannot prove the UI.
