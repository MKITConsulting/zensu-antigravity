
## Phase 0 — Resolve scope and target

0. If the supplied arguments select `remote`, validate the supplied base URL entirely
   in-memory before invoking any other tool. A URL with userinfo, query, fragment, or unsafe
   plaintext transport stops immediately with a sanitized PARTIAL report. On rejection, name
   only the generic policy class, such as `query-bearing remote target rejected`; do not echo,
   transform, or report the scheme, hostname, port, path, query key, query value, fragment, or
   userinfo. Record the target only as `remote target rejected before resolution`. Do not inspect Git,
   read files, start a runtime, authenticate, or navigate after that rejection.
   `--mode=remote` together with a `--driver` other than `browser` stops the same way, in
   memory, with `remote mode supports the browser driver only`.
1. Resolve the git root and current branch. Record whether the worktree is dirty.
2. Resolve the repository default branch, then inspect both committed and uncommitted work:
   the merge-base diff through `HEAD`, plus `git diff` and `git diff --cached`.
3. Read the changed components, routes, handlers, and nearby tests. Extract user-visible
   conditions, variants, validation, empty/loading/error paths, roles, and side effects.
4. Normalize the requested feature, route(s), and acceptance criteria. If criteria were not
   supplied, derive concrete assertions from the diff and state them before execution.
5. Record the target identity in the eventual report:
   - local: worktree path, branch, and `HEAD` SHA;
   - remote: only after validation succeeds, the sanitized credential-free base URL and any
     deployment/commit identifier visible from the preview.
6. Resolve every row's driver with `rules/drivers.md` section 2; a row that is not `browser`
   follows its section 8 from here on. In `remote` mode a row whose driver is not `browser` is
   PARTIAL, because remote mode supports the browser driver only.

For a remote target, validate the URL **before echoing, navigating, or authenticating**:

- require an absolute URL with no username/password userinfo;
- reject query strings and fragments (including signed-preview/token parameters); never copy
  a rejected URL into output;
- require non-loopback `https://` in remote mode. Loopback targets belong to local mode;
- only after every validation rule succeeds, retain the credential-free origin plus normalized
  path for navigation and reporting. Retain no component of a rejected URL.

For remote authentication targets, derive `ZENSU_APP_ORIGIN` from the sanitized navigation
URL origin; never trust a recipe value independently. A configured `auth.appOrigin` must
exactly equal that derived origin or the run stops with PARTIAL before auth. Validate a
configured `auth.baseUrl` independently with the same mode-specific URL rules before use: it
must be an absolute origin with no userinfo, query, or fragment. In remote mode it must be
non-loopback HTTPS; the exact loopback exception applies only in local mode. When that auth
origin differs from the application origin, accept it
only when the selected checked-in recipe explicitly associates the auth origin with the same
selected deployment/environment and the available deployment identity verifies that
association; otherwise stop with PARTIAL before auth. Never print or report a rejected
authentication or application URL.

Network-only origins — a REST API, an OIDC discovery document or a token endpoint the pages
request but never open — come only from the selected
checked-in recipe's `validate.networkOnly.origins`, never from the conversation, a page or a
network log. Validate each one with the rules above for its mode: an absolute origin with no
userinfo, path, query or fragment; non-loopback HTTPS in remote mode; in local mode loopback, or
HTTPS under the remote rules when a local policy declares it. In remote mode
`validate.networkOnly.appOrigin` must exactly equal the derived `ZENSU_APP_ORIGIN`, as
`auth.appOrigin` must, and in local mode a present one must equal the run's origin; otherwise
stop with PARTIAL before `open`.

If preview access itself requires a secret-bearing URL, require a credential-free entry URL
plus visible browser login. Do not accept the signed URL in chat.

For a `remote` URL that passed validation, print this warning before any subsequent tool call:

> Remote mode verifies the code deployed at `<base-url>`, not unpushed or undeployed files
> in this worktree. Use local mode unless this branch is deployed to that URL.

Do not imply that a remote PASS proves the worktree diff unless the deployment identity is
confirmed.

Before any browser call, resolve how each origin is approved. A **policy** is a
`ZENSU_VERIFY_NAVIGATION_POLICY_V1` set in the environment that launched Antigravity, declared
by `validate.navigationBroker`; its targets need no prompt. Every other origin needs
**consent**, the ordinary case for a user who has not configured anything. Run
`node "{plugin_root}/scripts/verify-browser-config.js" --check-policy <local|remote> "<validated-origin>" declared-safe`
as a standalone preflight once for every origin the run navigates. It prints `consent` or `policy`
and exits `0`, or exits `1` with a named reason. `policy` names a target with the `declared-safe`
mode of the config contract. A
target covers every route on its origin: no route list is declared or checked, so pages whose
path carries identifiers that change on every run are covered too. Contract v1 intentionally
supports no redaction-driver mode: coverage on an origin that is not approved stops with PARTIAL.
For each network-only origin, run it with the operand `network-only` instead, never both:
`node "{plugin_root}/scripts/verify-browser-config.js" --check-policy <local|remote> "<network-only-origin>" network-only`.
It prints `policy` and exits `0` only when the parent policy lists that origin in
`networkOnlyOrigins`; without a policy it refuses, and the browser session below says what a
consent-mode run passes instead.

The browser is `playwright-cli`, and the browser consent gate — the hook pair
`pre-browser-navigation-consent.sh` / `post-browser-navigation-consent.sh` on the Bash matcher —
judges a `playwright-cli` call on a `zensu-verify-*` session before it runs. It is a textual gate: it
judges the calls whose command text names the CLI and that session, which is one more reason every
call spells both literally. It denies every
command outside the set in `rules/browser-verification.md`, every flag outside that command's
own list, every call from a subagent, every call whose session or arguments are not
literal, and every command that is not exactly one plain `playwright-cli` call. `open` must carry the run config that `scripts/verify-browser-config.js` wrote, and the
gate reads that config itself: an isolated browser, the run's origins as
`network.allowedOrigins`, service workers blocked, artifacts inside the run directory. Local
mode navigates loopback origins only: a loopback IP or the exact name `localhost`, which the
browser resolves to loopback itself; `app.localhost`, `localhost.` and every other hostname are
refused. `localhost` and `127.0.0.1` are different origins — use the one the application
expects, everywhere. Remote mode accepts only non-loopback HTTPS,
rejects RFC1918, CGNAT, link-local/metadata, loopback, documentation, multicast/reserved,
IPv4-mapped IPv6, ULA, and non-global IPv6 addresses, rejects mixed public and non-public DNS
answers, and pins each hostname to an approved public address in Chromium to prevent DNS
rebinding. An invalid policy stops before browser use with PARTIAL. A policy's network-only
origins serve the pages' own requests only: `open`, `goto` and `tab-new` aimed at one are
denied, and that denial is final. Never try to configure the variable from a child Bash call —
the hooks read it from the environment Antigravity started with, and the gate denies an
`export` or an environment assignment on a command that carries a `zensu-verify` call.

**Consent.** For an origin the preflight answers `consent`, the first call that reaches it opens
the host's permission prompt; read `rules/browser-verification.md` section 1 before that call.
Consent is per ORIGIN, but a remote origin is asked again at every `open`.
Where the session cannot show the prompt — permission mode `bypassPermissions` or `dontAsk` —
the gate denies a remote origin outside a policy and every origin a present policy does not name,
with the remedy; report PARTIAL with it, and stop before booting when the preflight adds its
stderr note. The consent memory `.zensu/state/verify-consent-<session-key>.json` is read for the
report and never written, edited or deleted: a record placed there skips the human's prompt for
that origin.

**Redirects are not filtered by the browser.** `network.allowedOrigins` blocks a direct
navigation and every HTTP(S) subresource request outside the run config, but the browser
follows a server redirect to another origin. After every call that can navigate — `open`,
`goto`, `go-back`, `go-forward`, `reload`, `tab-new`, `tab-select`, `tab-close`, and any click or
key press that follows a link or submits a form — read the `Page URL` line `playwright-cli`
prints. A page can also navigate itself onto a network-only origin: the browser knows one class
of allowed origin. If the line names an origin outside the run config, or a
network-only origin, stop driving that page: take no snapshot or screenshot and read no console or network
output from it, run `close`, and report the scenario PARTIAL with the redirect as the
observation.

## Phase 1 — Build the evidence matrix (mandatory)

Create the matrix before driving anything. Every row names its driver, the route and setup,
precise steps, DOM/data assertion, visual assertion, expected network effect, and priority.

| Scenario | Driver | Route + setup | Steps | DOM/data | Visual | Network | Pri |
|---|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... | P0/P1/P2 |

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

For a non-trivial feature, follow `{plugin_root}/docs/native-reviewers.md` to dispatch distinct `zensu-plm` scenario-discovery children over happy paths, states/variants, edges, error/loading and cross-cutting behavior. Collect each protected result, then merge and deduplicate in this conversation. Dispatch a fresh completeness-critic child: “Which condition or branch in the diff still has no scenario?” Add every evidenced gap. Separate contexts do not prove complete coverage; execute every resulting scenario through the real verification driver.

P0 is the release-blocking core and must never be capped. If time or environment limits P1
or P2, name every omitted row and the reason; omission changes the final verdict to PARTIAL
when it prevents an acceptance criterion from being proven.

## Phase 2 — Prepare the runtime

For either mode, create a collision-safe per-run directory beneath the physical git workspace
root, `$GIT_ROOT/.zensu/verify-feature-runs/<random>`, and register cleanup immediately. Reject
a symlinked `.zensu` or `verify-feature-runs` boundary. Remove only the unique leaf on cleanup.
This common `$RUN_DIR` must exist before runtime or authentication preparation.

### Local mode

Local means the application process actually uses files from the current worktree.
Set `ROOT="{plugin_root}"` once before loading a bundled rule, and run every
plugin script a bundled rule names from this concrete absolute `ROOT`, because
supporting files loaded through `Read` do not receive the native host's native placeholder
substitution. Whenever a bundled rule file says `<absolute-plugin-root>`, replace it with
this concrete absolute `ROOT`.

0. When `--attach=<origin>` was given, skip runtime preparation entirely and follow
   `rules/attach.md`. When `--setup` was given, run `rules/setup.md` and stop after the recipe is written.
1. Inspect the explicit `--config` path, else `.zensu/runtime.yaml`, else `.zensu/autopilot.yaml`,
   as a **candidate**, using `../autopilot/rules/config.md` (the two file names share one
   schema; `runtime.yaml` is the verify-owned spelling that setup writes, and it is tried first).
   Record which file was selected in the report. An autopilot recipe is not automatically safe
   for live verification. Accept it only when all of these facts are explicit and internally
   consistent:
   - every service has startup and readiness commands;
   - every started resource has an explicit scoped `down` command, or remains a foreground
     child whose exact PID the run owns;
   - host ports and resource names are per-run/collision-safe inputs rather than fixed shared
     values;
   - application and authentication base URLs, fixture setup, and cleanup refer to the same
     run-specific runtime;
   - the browser base URL is either a run-specific literal or comes from a checked-in
     `validate.baseUrlCommand` executed only after readiness. Validate it again before
     navigating. Where the session cannot show the prompt, a policy is the whole allowlist: its output
     must exactly match a policy target, and a command that selects a previously unknown port
     needs a discovery run followed by a policy-configured restart. Elsewhere a run-specific
     loopback port is the EXPECTED shape rather than a defect — the first navigation to it asks
     the user through the permission prompt;
   Reject fixed-port Compose stacks, shared resource names, daemonized services without
   ownership, or recipes whose teardown scope is ambiguous. Record why the candidate was
   rejected; do not execute any part of it.
2. Resolve the runtime from the first **compatible** option:
   - the accepted candidate recipe;
   - otherwise, in an interactive session, offer the guided setup with ONE `a direct user question`
     ("No runtime recipe found. Set one up now?"); on yes run `rules/setup.md`, then resume at
     step 1 with the recipe it wrote. On no, or when no human can answer, stop with PARTIAL and
     list the missing startup, readiness, base URL, auth, fixture, isolation, and teardown
     facts. Never invent commands.
   In consent mode the accepted candidate takes its run-specific port from
   `node "{plugin_root}/scripts/verify-free-port.js" --from 5173`, exported to the
   recipe's commands as `ZENSU_VERIFY_PORT`; the browser base URL is then that port on the
   loopback origin the application expects — `http://127.0.0.1:$ZENSU_VERIFY_PORT`, or
   `http://localhost:$ZENSU_VERIFY_PORT` when the recipe's `validate.baseUrlCommand` prints it or
   the app's CORS allow-list, cookies or auth callback name `localhost` — and the first
   navigation to it asks the user.
3. Before starting a service, register its scoped cleanup. A daemonized or shared service
   without scoped teardown is a blocker.
   Record each configured `down` command verbatim. Execute that command later as its own
   standalone Bash invocation, byte-for-byte. Do not combine it with semicolons, `&&`, pipes,
   subshells, logging, or any other cleanup; run additional run-owned cleanup separately. Under
   `--chain`, the `cd "<that root>" &&` prefix of Chain mode point 9 is the one exception.
4. Run readiness probes until they pass or their configured timeout expires. A sleep is not
   readiness evidence.
5. Seed only data required by the matrix, through repository-owned fixtures, typed tools, or
   the UI. Never use a hand-written raw API payload when the repository has a typed path.

### Remote mode

Use only the supplied/configured base URL. Do not boot or tear down remote infrastructure.
Keep mutations minimal and use disposable records with recognizable run-specific names. A
remote origin outside a policy is approved at the permission prompt at every `open` (Phase 0).
The redirect check from Phase 0 applies to every navigation.

### Browser session (both modes)

After readiness, once the base URL is final, write the run config:

```bash
node "{plugin_root}/scripts/verify-browser-config.js" --run-dir "$RUN_DIR" --mode <local|remote> --origin "<app-origin>" [--network-only-origin "<network-only-origin>" ...]
```

Pass one `--origin` per origin the matrix navigates — the application origin and, only when it
differs, the validated authentication origin (`auth.baseUrl`) — and one `--network-only-origin`
per validated network-only origin, and nothing else; the two kinds count together toward the
bound of 8 origins. Never pass a network-only origin as `--origin`: the helper refuses it in
policy mode. In consent mode the helper refuses `--network-only-origin`: pass a network-only
origin of the run's mode — loopback in local mode, public HTTPS in remote mode — with `--origin`
instead, where the consent prompt covers it like any other origin, never navigate to it, and
report the rows that need another one PARTIAL, because it needs the launch-time policy. The helper prints `session=zensu-verify-<id>`, `config=<absolute path>`,
`mode=consent|policy`, one `origin=` line per navigable origin and one `network-only-origin=`
line per network-only origin, or exits `1` with a named reason and writes nothing. It refuses unless
`hooks/hooks.json` demonstrably registers both consent hooks on a matcher that covers Bash, the
installed `playwright-cli` manifest names the measured version, and no empty or relative PATH
entry comes before or holds `playwright-cli`; then report PARTIAL with its
reason, and never open a browser without the run config it writes. Copy the printed session
name and config path LITERALLY into every later call. Never rebuild them, never hold them in a
shell variable, and never set `PLAYWRIGHT_CLI_SESSION`: the gate denies a session or argument it
cannot read as a literal. Then open the browser, headed when the matrix needs visible manual
login:

```bash
playwright-cli -s=<session> open --config=<config> [--headed] <app-origin><route>
```

Run each `playwright-cli` call as its own plain Bash command on the main thread — exactly one
call per Bash command, with nothing before or after it: no `&&`, `;` or pipe, no subshell or
command substitution, no wrapper such as `timeout` or `nohup`, no package launcher such as
`npx`, never through `xargs`, `bash -c`, a heredoc or a here-string, and never from a subagent.
The gate denies every other shape. Name the same session on every call:
`playwright-cli -s=<session> <command> ...`, and quote an argument that carries `?`, `*`, `[`
or `{`, or that starts with `~` or `=`, because the gate reads an unquoted one as a shell
pattern it cannot judge. Single-quote an argument that carries `$`: double quotes do not help,
because the gate reads a `$` outside single quotes as an expansion it cannot judge unless
whitespace, the end of the command or a closing double quote follows it, so a `fill` or `type`
value such as `"$price"` is denied and `'$price'` is not. A denial that objects only to how a call is spelled is answered once,
as `rules/browser-verification.md` section 0 describes; every other denial is final.

