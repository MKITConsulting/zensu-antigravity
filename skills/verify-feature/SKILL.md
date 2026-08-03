---
name: verify-feature
description: >
  [Zensu] Live-verify an already-built feature against either the current local git
  worktree or a deployed preview. Discovers the changed behavior, builds a risk-ranked
  P0/P1/P2 scenario matrix, boots an isolated local runtime from a checked-in recipe,
  drives the real UI through the host browser driver — Antigravity's built-in
  browser/preview tooling — and reports DOM/data, visual, console, and network evidence.
  When the host exposes no browser driver it switches to guided manual verification: a
  precise numbered script the user runs, whose observations come back as evidence. Remote
  mode clearly distinguishes deployed code from unpushed worktree changes and keeps
  authentication credential-blind through visible manual login only.
  Does not fix code or write committed tests. Use when the user asks to verify/test a
  worktree, test a feature live, run an end-to-end smoke check, validate a preview, or
  invokes /zensu-verify-feature.
---

# /zensu-verify-feature

Prove that an **already-built** feature works in a real running application, once, with
evidence. The target is either the current worktree (`local`) or an already-deployed URL
(`remote`). This workflow reports what it observes; it never patches the feature and never
turns the run into a committed regression suite.

> `/zensu-verify-feature` is a live proof. `/zensu-cover` writes durable tests.
> `/zensu-autopilot` owns the larger idea-to-PR build and repair loop.

## Arguments

Slash form: `/zensu-verify-feature [<feature>] [--flag=value ...]`.

| Arg | Required | Default | Notes |
|---|---|---|---|
| `<feature>` | no | current diff | Behavior to verify. Free text, a route, or acceptance criteria are valid. |
| `--mode=local\|remote` | no | `local` | `local` must execute code from this worktree; `remote` executes deployed code. |
| `--driver=auto\|host\|manual` | no | `auto` | `auto` probes the host browser driver and falls back to guided manual. `manual` forces the guided script even when a driver exists. |
| `--route=<path>` | no | derive | Initial route. Derive only when the changed router or supplied criteria make it unambiguous. |
| `--base-url=<url>` | remote only | config | Preview/staging URL. Never silently default to production. |
| `--base=<branch>` | no | repository default branch | Base used to ground the scenario matrix in the change. |
| `--config=<path>` | no | `.zensu/autopilot.yaml` | Reuse the project runtime recipe when present. |

Ask one batched question for missing information that cannot be derived safely. In
particular, ask for the remote base URL and for genuinely ambiguous acceptance criteria.

## Non-negotiable boundaries

- **Report only.** Do not edit application code, alter tracked tests, commit, push, or fix a
  defect. A failed verification is useful evidence. Offer `/zensu-tdd` or
  `/zensu-cover` afterward when appropriate.
- **One feature, complete matrix.** Stay within the requested behavior, but exercise every
  P0 and P1 scenario the changed code exposes. Do not reduce verification to one happy path.
- **Explicit scope stays bounded.** When the caller says the supplied acceptance criteria are
  complete, treat them as the feature boundary. Inspect the diff only for evidence and gaps
  needed by those criteria; do not invent unrelated responsive, idempotence, error-path, or
  other matrix rows unless the changed code makes them necessary to the stated behavior or a
  safety-critical adjacent path.
- **Real interfaces.** Exercise the user-visible UI and its real backend. Never run arbitrary
  script inside the page, even when the host driver offers a page-evaluation capability:
  read-only page code can still inspect authenticated data and bypass the evidence controls
  below. If a snapshot cannot expose a value, report that evidence plane PARTIAL.
- **Credential-blind.** Never receive, read, print, paste, or interpolate a real password,
  token, cookie, API key, or stored-session content. Do not use a cookie/storage getter or
  setter the host may expose, do not accept an auth artifact path, and do not run a
  storage-state login script. Use visible manual browser login, or report the authenticated
  coverage as PARTIAL.
- **Safe writes.** Local throwaway fixture creation is allowed. Remote destructive or
  externally visible actions (delete, send, publish, pay, invite) require explicit user
  confirmation even when they are part of a scenario.
- **Owned teardown only.** Stop only processes, containers, and temporary files created by
  this run. Never use broad `pkill`, shared container names, or cleanup outside the run dir.

## The host browser driver

This skill never hardcodes a browser tool name. It targets a **capability set** and resolves
it against whatever browser/preview tooling Antigravity advertises in the current session.
Resolve the mapping once, in Phase 0, and record it in the report.

| Capability | Required for | What it must do |
|---|---|---|
| `NAVIGATE` | driven mode | Open an absolute URL and report the resulting URL after redirects |
| `SNAPSHOT` | driven mode | Return a structural/semantic view of the live page with addressable element references |
| `INTERACT` | driven mode | Click, type, select, press keys, and answer dialogs against those references |
| `SCREENSHOT` | visual plane | Return a rendered image the agent can actually inspect |
| `VIEWPORT` | responsive rows | Resize the viewport |
| `CONSOLE` | runtime plane | Read console messages produced by the page |
| `NETWORK` | runtime plane | List requests with method, path, and status |
| `ISOLATE` | row isolation | Start a fresh browsing context or otherwise clear session state |

**Capabilities that are refused even when advertised:** arbitrary page-script evaluation,
cookie/local/session-storage getters and setters, storage-state import/export, and
file-upload-by-path. A scenario that depends on one of them is reported PARTIAL rather than
driven around the boundary.

**Mode selection** (`--driver=auto`):

- `NAVIGATE` + `SNAPSHOT` + `INTERACT` all present → **Mode A (driven)**.
- Any of the three missing, no browser/preview tooling at all, or `--driver=manual` →
  **Mode B (guided manual verification)**. This is a supported first-class mode, not an
  error, and it is not a reason to abort the run.
- `SCREENSHOT` missing in Mode A → the visual plane cannot be proven by the agent: request
  it through the Mode B evidence template for the checkpoint rows, or cap the verdict at
  PARTIAL and say which rows lack visual proof.
- `CONSOLE`/`NETWORK` missing → that runtime plane is PARTIAL; never substitute a guess.
- `ISOLATE` missing → drive rows in an order that avoids state leakage, reset through the
  real UI, and state the residual risk.
- The driver breaking mid-run is not a failed verification: convert the remaining rows to the
  Mode B script and continue.

Never replace a missing driver with ad-hoc `curl` probes and call the UI proven. `curl` can
support a data assertion; it cannot show the rendered page.

## Phase 0 — Resolve scope and target

0. If the supplied arguments select `remote`, validate the supplied base URL entirely
   in-memory before invoking any other tool. A URL with userinfo, query, fragment, or unsafe
   plaintext transport stops immediately with a sanitized PARTIAL report. On rejection, name
   only the generic policy class, such as `query-bearing remote target rejected`; do not echo,
   transform, or report the scheme, hostname, port, path, query key, query value, fragment, or
   userinfo. Record the target only as `remote target rejected before resolution`. Do not inspect Git,
   read files, start a runtime, authenticate, or navigate after that rejection.
1. Resolve the git root and current branch. Record whether the worktree is dirty.
2. Resolve the repository default branch, then inspect both committed and uncommitted work:
   the merge-base diff through `HEAD`, plus `git diff` and `git diff --cached`.
3. Read the changed components, routes, handlers, and nearby tests. Extract user-visible
   conditions, variants, validation, empty/loading/error paths, roles, and side effects.
4. Normalize the requested feature, route(s), and acceptance criteria. If criteria were not
   supplied, derive concrete assertions from the diff and state them before execution.
5. Resolve the host browser driver capability set (see above) and fix the mode for this run.
6. Record the target identity in the eventual report:
   - local: worktree path, branch, and `HEAD` SHA;
   - remote: only after validation succeeds, the sanitized credential-free base URL and any
     deployment/commit identifier visible from the preview.

For a remote target, validate the URL **before echoing, navigating, or authenticating**:

- require an absolute URL with no username/password userinfo;
- reject query strings and fragments (including signed-preview/token parameters); never copy
  a rejected URL into output;
- require non-loopback `https://` in remote mode. Loopback targets belong to local mode;
- resolve the hostname and reject a non-public answer — private (RFC1918), CGNAT,
  link-local/metadata, loopback, documentation, multicast/reserved, IPv4-mapped IPv6, ULA, or
  non-global IPv6 — and reject a name that mixes public and non-public answers;
- only after every validation rule succeeds, retain the credential-free origin plus normalized
  path for navigation and reporting. Retain no component of a rejected URL.

The validated origins form the **run allowlist**: the application origin plus, when it differs,
an auth origin that passed the same rules. Because the host driver is a general-purpose browser
surface and not a request-level broker, the allowlist is enforced by the skill at two points —
before every navigation, and again on the URL the driver reports **after** navigation and after
every redirect. A landing URL outside the allowlist ends that scenario immediately: do not read
snapshot, screenshot, console, or network evidence from it, and report the row PARTIAL. Because
that check is post-hoc, no protected or sensitive route may be opened at all unless it is
covered by the evidence-safety declaration in `rules/local-runtime.md`.

For remote authentication targets, derive the expected auth origin from the sanitized
navigation URL origin; never trust a recipe value independently. A configured `auth.appOrigin`
must exactly equal that derived origin or the run stops with PARTIAL before auth. Validate a
configured `auth.baseUrl` independently with the same mode-specific URL rules before use: it
must be an absolute origin with no userinfo, query, or fragment. In remote mode it must be
non-loopback HTTPS; the exact loopback exception applies only in local mode. When that auth
origin differs from the application origin, accept it only when the selected checked-in recipe
explicitly associates the auth origin with the same selected deployment/environment and the
available deployment identity verifies that association; otherwise stop with PARTIAL before
auth. Never print or report a rejected authentication or application URL.

If preview access itself requires a secret-bearing URL, require a credential-free entry URL
plus visible browser login. Do not accept the signed URL in chat.

For a `remote` URL that passed validation, print this warning before any subsequent tool call:

> Remote mode verifies the code deployed at `<base-url>`, not unpushed or undeployed files
> in this worktree. Use local mode unless this branch is deployed to that URL.

Do not imply that a remote PASS proves the worktree diff unless the deployment identity is
confirmed.

## Phase 1 — Build the evidence matrix (mandatory)

Create the matrix before opening the browser — and before writing a manual script, because
Mode B renders the same matrix as numbered steps. Every row names the route and setup, precise
steps, DOM/data assertion, visual assertion, expected network effect, and priority.

| Scenario | Route + setup | Steps | DOM/data | Visual | Network | Pri |
|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | P0/P1/P2 |

Enumerate these dimensions from the changed code:

- primary happy path;
- each changed state, toggle, tab, filter, sort, or variant;
- 0 / 1 / many and relevant min/max or date boundaries;
- empty, loading, validation, unauthorized, and failed-request states that can be produced
  safely through real interfaces;
- responsive, keyboard/accessibility, permissions, and theme behavior when touched.

The list above is a discovery checklist, not permission to expand an explicitly complete
feature scope. For a clean synthetic fixture with complete supplied criteria, create only rows
that prove those criteria. Extra exploratory checks must never introduce evidence failures that
change the verdict for out-of-scope behavior.

For a non-trivial feature, fan out **read-only scenario discovery** across happy paths,
states/variants, edges, error/loading, and cross-cutting behavior when parallel subagents are
available. Merge and deduplicate the results in the main thread. If fan-out is not available,
enumerate the same dimensions in-thread and say so. Run one completeness-critic pass: "Which
condition or branch in the diff still has no scenario?" Add every real gap.

P0 is the release-blocking core and must never be capped. If time or environment limits P1
or P2, name every omitted row and the reason; omission changes the final verdict to PARTIAL
when it prevents an acceptance criterion from being proven.

## Phase 2 — Prepare the runtime

For either mode, create a collision-safe per-run directory beneath the physical git workspace
root, `$GIT_ROOT/.zensu/verify-feature-runs/<random>`, and register cleanup immediately. Reject
a symlinked `.zensu` or `verify-feature-runs` boundary. Remove only the unique leaf on cleanup.
This common `$RUN_DIR` must exist before runtime or authentication preparation.

### Local mode

Local means the application process actually uses files from the current worktree. The full
recipe-acceptance contract, the ownership/teardown rules, and the evidence-safety schema live
in `rules/local-runtime.md`; load it before starting anything. In short:

1. Inspect the explicit `--config` path or `.zensu/autopilot.yaml` as a **candidate** (the file
   itself is defined by `../autopilot/rules/config.md`). An autopilot recipe is not
   automatically safe for live verification — accept it only against the checklist in
   `rules/local-runtime.md` (explicit startup + readiness per service, explicit scoped `down`
   or owned foreground child, per-run ports and resource names, one consistent runtime for app
   URL / auth / fixtures / cleanup, and a base URL that is a run-specific literal or a
   checked-in command executed only after readiness).
2. Resolve the runtime from the first **compatible** option: the accepted candidate recipe, or
   a repository-owned lifecycle controller that satisfies the same ownership contract.
   Otherwise stop with PARTIAL and list the missing startup, readiness, base URL, auth,
   fixture, isolation, and teardown facts. Never invent commands.
3. Before starting a service, register its scoped cleanup. A daemonized or shared service
   without scoped teardown is a blocker. Record each configured `down` command verbatim and
   execute it later as its own standalone shell invocation, byte-for-byte — never combined
   with semicolons, `&&`, pipes, subshells, logging, or other cleanup.
4. Run readiness probes until they pass or their configured timeout expires. A sleep is not
   readiness evidence.
5. Seed only data required by the matrix, through repository-owned fixtures, typed tools, or
   the UI. Never use a hand-written raw API payload when the repository has a typed path.

### Remote mode

Use only the supplied/configured base URL. Do not boot or tear down remote infrastructure.
Keep mutations minimal and use disposable records with recognizable run-specific names. The
run allowlist and the post-navigation recheck from Phase 0 apply to every remote route and
redirect.

### Authentication (both modes)

Do not restore a session from stored state, an auth artifact, a login script, or any
cookie/storage capability the host may expose. Those paths hand credential material to the
agent, which this skill forbids outright.

Before authenticating or navigating to any protected route — including a navigation whose
result already carries a page snapshot — validate the selected recipe's `validate.evidenceSafety`
block using the fail-closed schema and exact-route coverage in `rules/local-runtime.md`. Every
route in scope must be covered exactly and proved synthetic/pre-classified non-sensitive. If the
block is absent, invalid, or does not cover a route exactly, do not navigate to that protected
content: skip the scenario and report PARTIAL. Final-report redaction is too late. The same
boundary applies to screenshots.

Use this order:

1. **Visible manual login:** open the login page in the host browser surface (Mode A) or point
   the user at it in their own browser (Mode B), ask the user to enter credentials there, and
   wait for their confirmation. Never ask them to paste a credential into chat and never type
   one on their behalf.
2. **No safe path:** skip authenticated scenarios and report PARTIAL. Token extraction or
   storage injection is forbidden, including for throwaway remote users.

## Phase 3 — Drive and observe

Load `rules/browser-verification.md` and execute the matrix against the resolved base URL. It
carries both loops: the driven loop (Mode A) and the guided manual loop (Mode B), including the
manual script format and the evidence template the user pastes back.

- Drive P0, then P1, then any affordable P2 rows.
- Reset to a known state between scenarios. Use a fresh isolated context when scenario state
  can leak; re-authenticate visibly when a fresh context is required.
- Mode A: after every meaningful interaction, take a semantic snapshot before selecting the
  next action. Prefer role/name/reference-based interactions over guessed CSS selectors.
- Capture and actually inspect screenshots at the checkpoints named in the matrix.
- Console and network results are model-visible before report redaction. There is no trusted
  sanitizer for authenticated traffic, so do not read those planes on authenticated targets;
  mark that evidence plane PARTIAL. Direct inspection is allowed only for a proven
  unauthenticated, synthetic, secret-free target such as an isolated local fixture.
- Record expected versus observed evidence while running; do not reconstruct it from memory.
- Mode B: everything the user reports is **user-reported evidence**. Attribute it that way in
  the report and never describe it as something the agent observed.

Parallel execution is allowed only when each lane has an isolated browser context, its own
fixtures, and no shared mutable state. Otherwise execute sequentially. Parallelism never
reduces the evidence requirements.

## Phase 4 — Cleanup (always)

Run cleanup on PASS, FAIL, cancellation, and setup failure:

- close the browser surface this run opened (Mode B: tell the user which processes are still
  theirs to stop);
- delete the run directory without touching a sibling or out-of-scope path;
- invoke every accepted recipe's configured `down` command byte-for-byte as a standalone shell
  call; let its owner stop only the process groups and resources it owns;
- remove only uniquely named containers/resources created by this run;
- leave the git worktree and all user-owned services intact.

## Phase 5 — Report

Use this format:

**Verdict: PASS | FAIL | PARTIAL**

| Scenario | Pri | Expected | Observed | Evidence | Result |
|---|---|---|---|---|---|
| ... | P0 | ... | ... | screenshot / snapshot / request / user-reported | ✅ / ❌ / ⏭ |

- **Target:** mode, base URL, worktree/branch/SHA or deployed identity.
- **Driver:** `host browser driver` with the resolved capability list, or `guided manual
  (user-reported evidence)`; name any capability that was missing and what it cost.
- **Coverage:** `N/N P0`, `N/N P1`, `N/N P2`; name every undriven row.
- **Console:** sanitized error class and bounded message, or `clean`. Redact credentials,
  tokens, cookies, authorization data, signed/query URLs, personal data, headers, and bodies;
  never copy raw console output into the report.
- **Network:** failed, missing, 4xx, or 5xx requests with method/path/status, or `clean`.
  Strip query strings/fragments and never report headers, bodies, credentials, or personal
  data.
- **Visual:** what each screenshot actually showed about layout, clipping, overlap,
  responsiveness, styling, and legibility. "Screenshot taken" is not an observation.
- **Reproduction:** exact steps and captured signal for each failure.
- **Limitations:** environment, fixture, auth, driver, or deployment-identity gaps.

Verdict rules:

- **PASS** only when every P0 was driven and passed, every acceptance criterion has DOM/data
  **and** visual proof, and relevant console/network evidence is clean. In Mode B this means
  the user returned an explicit observation for every P0 row, including its visual assertion.
- **FAIL** when a driven acceptance criterion or P0 behavior is demonstrably broken — a
  contradicting user-reported observation counts.
- **PARTIAL** when setup/auth/evidence is incomplete, a required scenario was not driven or
  not answered, the remote deployment identity is uncertain, or visual inspection is missing.

End with exactly one greppable verdict. The final non-empty line must be a bare, unfenced
plain-text line with no backticks, list marker, block quote, or text after it. For a passing run,
that final line is:

VERIFY-FEATURE-VERDICT: PASS

Use the same bare form with `FAIL` or `PARTIAL` as appropriate.

## Reference Files

- `rules/browser-verification.md` — the driven loop, the guided manual loop, the manual script
  format, the evidence template, the three evidence planes, and scenario isolation/safety.
- `rules/local-runtime.md` — the recipe-acceptance checklist, ownership and teardown contract,
  readiness rules, and the fail-closed `validate.evidenceSafety` schema.
