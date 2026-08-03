# Local runtime rules

How `/zensu-verify-feature` gets an isolated, owned, disposable instance of the application
running from the **current worktree**, and how it proves a route is safe to observe. The
runtime always comes from something **checked in** — a project recipe or a repository-owned
lifecycle controller. This skill never invents startup, readiness, or teardown commands.

## 1. The recipe candidate

The candidate is the explicit `--config` path or `.zensu/autopilot.yaml`. The file itself is
defined by `../../autopilot/rules/config.md` (committed, shared, secret-free). A recipe that is
good enough for an autopilot build is **not automatically safe for live verification**: verify
runs against a real browser surface, alongside whatever the developer already has running.

Accept the candidate only when all of these facts are explicit and internally consistent:

- every service has a startup command **and** a readiness command;
- every started resource has an explicit scoped `down` command, or remains a foreground child
  whose exact process the run owns;
- host ports and resource names are per-run/collision-safe inputs rather than fixed shared
  values;
- application URL, authentication target, fixture setup, and cleanup all refer to the **same**
  run-specific runtime;
- the browser base URL is either a run-specific literal or comes from a checked-in command
  executed only after readiness, and its output is re-validated against the run allowlist
  before navigating.

Reject fixed-port compose stacks, shared resource names, daemonized services without an
ownership handle, and recipes whose teardown scope is ambiguous. Record **why** a candidate was
rejected; do not execute any part of a rejected recipe.

## 2. Resolution order

1. The accepted candidate recipe.
2. A repository-owned lifecycle controller that satisfies the ownership contract in section 3
   (this is the extension slot for a repository that needs more than a flat recipe — for
   example the Zensu monorepo, recognizable by `backend/cmd/zensu`, `backend/Makefile`,
   `frontend/package.json`, and `frontend/pnpm-lock.yaml`). A controller must be checked into
   the repository under verification and invoked verbatim; this plugin ships none.
3. Otherwise stop with PARTIAL and list the missing startup, readiness, base URL, auth,
   fixture, isolation, and teardown facts. Never guess a command.

Remote mode skips this section entirely: it boots nothing and tears down nothing.

## 3. Ownership and teardown contract

- Create `$GIT_ROOT/.zensu/verify-feature-runs/<random>` first, reject a symlinked `.zensu` or
  `verify-feature-runs` boundary, and remove only that unique leaf at the end.
- Register the scoped `down` command **before** the matching `up` runs. A service started
  without a registered teardown is a blocker, not a warning.
- Record each `down` command verbatim and execute it later as its own standalone shell
  invocation, byte-for-byte — never combined with semicolons, `&&`, pipes, subshells, logging,
  or other cleanup. Run other run-owned cleanup as separate calls.
- Stop only what this run created: its own process groups, its uniquely named containers and
  volumes, its run directory. Never `pkill` by pattern, never remove a pre-existing container,
  never touch another worktree's resources or a service the user started.
- A controller must be able to prove ownership before it signals anything (a private per-run
  lease, a unique resource name, or an owned foreground process). Mutable state alone must
  never authorize a signal or a container removal.
- Teardown runs on PASS, FAIL, cancellation, timeout, and setup failure alike.
- Secrets a controller generates stay inside the controller: it may persist them mode `0600`
  under the run directory for its own later actions. This skill never reads, prints, or passes
  that file to another tool.

## 4. Readiness and fixtures

- Poll each service's readiness command until it succeeds or its configured timeout expires. A
  sleep is never readiness evidence.
- After readiness, confirm the runtime reports the exact origin the run allowlist authorized.
  A byte-level mismatch means tear down without navigating and report PARTIAL.
- Seed only the data the matrix needs, through repository-owned fixture paths, typed commands,
  or the UI. Never hand-write a raw API payload when the repository has a typed path.
- Fixture names carry the run identifier so leftovers are always attributable.
- Authentication stays credential-blind: visible manual login only. A seed path that would hand
  a generated password or session to the agent is not usable — continue with public scenarios
  and report the authenticated coverage as PARTIAL.

## 5. Platform note

Scoped teardown relies on POSIX process-group signaling. On a host where a controller cannot
own its child process groups that way, report PARTIAL and point at a POSIX shell environment, a
deployed remote target, or a checked-in platform-specific runtime instead of starting services
that cannot be cleanly stopped.

## 6. `validate.evidenceSafety` — the fail-closed evidence declaration

Observing a route means model-visible page content. A protected or otherwise sensitive route
may only be opened when the recipe declares it safe. The declaration lives in the same
`.zensu/autopilot.yaml` the runtime comes from:

```yaml
validate:
  evidenceSafety:
    mode: declared-safe        # the ONLY accepted value
    target: "<origin>"         # must equal the validated run origin byte-for-byte
    routes:                    # exact page routes, no glob, no prefix, no regex
      - "/dashboard"
      - "/features/new"
    declaredBy: "<what guarantees the data is synthetic or pre-classified non-sensitive>"
```

Evaluation rules — all fail-closed:

- A missing, unparsable, or empty block means **no protected route may be opened**. Skip those
  scenarios and report PARTIAL.
- `mode` must be exactly `declared-safe`. There is no redaction-driver mode: coverage that is
  not proven safe is skipped, never sanitized after the fact.
- `target` must equal the origin that passed the Phase 0 URL rules, byte for byte. A mismatch
  invalidates the whole block.
- Route matching is exact string equality. A route that is not listed is not covered — no
  prefix, glob, or regex expansion, and no inheriting coverage from a parent path.
- Enforce the check **before** navigation, before login, and before any screenshot, because a
  navigation result can itself return page content. Redaction in the final report is too late.
- Unauthenticated, synthetic, secret-free local fixtures still need the declaration for any
  route that could render real user data.
