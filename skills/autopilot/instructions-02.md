
### Phase 1 — Build  (autonomous, ZERO questions) — strictly ordered

Run these in order. Implement **via the Zensu workflow** throughout.

1. **Implement** — invoke `/zensu-tdd` (vanilla mode) with the complete spec + ACs **WITH AC IDs**: retain every `AC-###` and `FR-###` identifier and requirement text verbatim, mark deprecated criteria explicitly, and include the exact
   `AUTOPILOT-RUN: <RUN_ID>` line as the feature
   specification. Let the built-in review chain run and address what it raises.
   Stay in the worktree.
   (Vanilla `/zensu-tdd` may ship thin coverage — `/zensu-cover` on the diff hardens the
   durable test net; opt in with `--cover`, applied in step 6b below.)
2. **Gates green** — run every command in the resolved `gates:` recipe; all must pass
   before the PR opens (e.g. type-check, lint, unit tests, per-file coverage floor).
   Persist `GATES_PASSED` with the tested head SHA; on failure persist `GATES_FAILED`, then
   run the bound `/zensu-tdd` fix attempt and return here.
2b. **Converge (report-only)** — run `/zensu-converge <session-plan-path>` (always the
   session plan, never mtime-resolved — scoped fix runs write newer plans): a
   `contradicts` finding on an active AC **blocks the PR open** until fixed via
   `/zensu-tdd` (vanilla, scoped); after each fix re-run the converge report against the
   SAME session plan — if `contradicts` persists after 2 fix attempts, treat it as a
   stop-the-world blocker per The one rule (halt + report). `missing`/`partial`
   findings feed the step-6 validate loop; with `--no-validate`, `missing` on an
   active AC also blocks the PR open and `partial` is recorded unvalidated in the
   PR body's per-AC table. Flow-back edit proposals are reported only — never
   auto-applied in this non-interactive run. Persist `CONVERGENCE_PASSED` before PR open;
   each contradiction uses `CONVERGENCE_FAILED` and the bound TDD return path.
3. **Open the PR** — commit (Conventional Commits, no watermark), push, then open the PR/MR
   against `--base` **through the driver** (run from `$REPO` so `gh`/`glab` resolve the host;
   GitHub → `gh pr create`, GitLab → `glab mr create` with `--source-branch`/`--target-branch`,
   the driver picks per `$PROVIDER` and returns the PR/MR URL):

   ```bash
   REPO="$(git rev-parse --show-toplevel)"
   HEAD="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
   URL="$(cd "$REPO" && bash "$VCS" --open-pr --provider "$PROVIDER" \
     --base "$BASE" --head "$HEAD" --title "$TITLE" --body-file "$BODY_FILE")" \
     || { echo "PR/MR open failed — see the driver's stderr above"; exit 1; }
   [ -n "$URL" ] || { echo "PR/MR open returned an empty URL — aborting"; exit 1; }
   ```

   Persist `PR_OPEN_REQUESTED` with a deterministic operation key before calling the driver;
   after success persist `PR_OPENED` with that same key, PR number/URL, and current head.
   `$HEAD` is the worktree's feature branch (already pushed above), `$BASE` the `--base` arg
   (default `main`), `$TITLE`/`$BODY_FILE` the render step below. A failed PR-open (auth
   expired, an MR already exists on the branch, a push race) is a **stop-the-world blocker**
   (The one rule) — halt and report; never run step 4+ against a PR/MR that was not created.

   Render the body (`$BODY_FILE`, English title + body) from the resolved template
   (`$(git rev-parse --show-toplevel)/.zensu/templates/autopilot-pr-body.md` when that file
   exists, else `$ROOT/templates/autopilot-pr-body.md` under the validated session plugin root): it carries a per-AC checklist table keyed
   by the stable `AC-###` IDs — one row per AC, with verification evidence for each active AC
   (deprecated rows stay listed with status `⚪ deprecated`, no evidence; status filled in after
   step 6). Every `Status` cell carries a leading marker — 🟢 pass, 🟡 partial, 🟡 unvalidated,
   🔴 fail, ⚪ deprecated — prefixing the word rather than replacing it; ⚪ is bound to
   provenance, so use it only for a row the spec already marks deprecated. The body also carries one audit line
   `Gates bypassed during build: <list|none|UNREADABLE — …>`
   from the bypass ledger: after EVERY `/zensu-tdd` chain in this build (the initial one and
   each fix loop), run `{session-helper} --helper log -- --bypass-list`
   and union the non-`none` entries. **Check its exit status, not just its output.** On a
   non-zero exit the verb did not read a ledger: exit 3 prints an `UNREADABLE — …` line on
   stdout, and any other non-zero exit leaves stdout empty with the diagnosis on stderr.
   That sentence is NOT an entry to union — it is prose, and unioning it would splice it
   into the PR body as if it were a gate name. Instead it POISONS the build union: carry it
   verbatim as the whole value of the audit line for this build, and never collapse it to
   `none`. `none` may be rendered only when every chain's `--bypass-list` exited 0 and
   returned `none` — a ledger nobody could read is not a clean ledger, and this line
   outlives the session —
   each `--tdd-begin` resets the per-run ledger, so the union is the build-level truth.
   Persist the running union durably after every chain as a `Gates bypassed (build union):`
   line in the autopilot plan artifact — the PR body is rendered FROM that line, never from
   conversation memory, so a compaction or session restart between chains cannot
   under-report. Render `none` when the union is empty; update the line whenever step 5/6
   pushes.
4. **Team review — ONCE** — derive the deterministic key and exact four-line envelope above,
   persist `TEAM_REVIEW_REQUESTED`, then run `/zensu-pr-team-review` on the PR. Its delegated
   path reconciles the write-ahead operation remotely and returns the structured receipt;
   persist `TEAM_REVIEW_PUBLISHED` only after that receipt validates. This is the single deep
   multi-persona pass. It runs **exactly once** and does **not** re-run in the loop.
5. **Fix the findings** — invoke `/zensu-pr-fix-findings` with the exact three-line envelope
   above. Its delegated path fetches the complete thread set, performs one aggregate bound
   TDD fix run serially in this task, re-runs the gates, pushes with current-PR guards,
   advances the durable PR head, and resolves the addressed threads. Repeat only while its
   authoritative paginated re-fetch still reports unresolved threads. Persist
   `FINDINGS_CLEARED` only after that count is zero.
6. **Validate ↔ fix LOOP** — only now exercise the running feature:
   a. Run the resolved validation **driver** (see `rules/drivers.md`), authenticating via
      the credential-blind login script if one is configured (see `rules/auth.md`). Assert
      **every non-deprecated AC by its `AC-###` ID** and capture evidence per AC under that
      ID (ACs marked deprecated are exempt — their rows stay in the table per the
      never-recycle rule).
   b. Every non-deprecated AC passes + gates green → persist `VALIDATION_PASSED` and
      **exit the loop**.
   c. Anything off → persist `VALIDATION_FAILED`, fix it through `/zensu-tdd` (vanilla,
      scoped to the failing AC(s), carrying `AUTOPILOT-RUN: <RUN_ID>`),
      re-run the step-2 gates, push to update the PR, then go back to (a).
   d. Repeat (a)–(c) until all non-deprecated ACs pass. `/zensu-pr-team-review` does **not** re-run here.
6b. **Persist coverage — opt-in `--cover`** — with `--cover`, after the loop exits green,
   invoke `/zensu-cover --from-acs` to emit the now-passing ACs as **durable committed
   tests** (one test per active `AC-###` ID, keyed by the ID; deprecated ACs are skipped),
   then persist `COVERAGE_PASSED`; on failure use `COVERAGE_FAILED` and the bound TDD
   return path. This turns the
   throwaway live validation into a permanent regression net in the same PR. Off by default;
   the live validate↔fix loop above is unchanged.

### Phase 2 — Deliver

After all delivery invariants and current-head evidence are durable, apply
`DELIVERY_COMPLETE`. Stop at a **ready, pushed PR** whose body contains a per-AC pass/fail table keyed by the
stable `AC-###` IDs — one evidence entry per active ID; deprecated rows stay listed with
status `⚪ deprecated`, no evidence — and the `Gates bypassed during build:` audit line
(the step-3 union, `none` when clean). Then:
- **Do NOT merge, push a release, or deploy.** The final merge is the human's.
- Report: the PR link, the per-AC table, what looped and why, and anything decided
  autonomously that the user may want to revisit.

## The two seams

The orchestration above is constant. Only two things vary per project, both resolved by
the probe:

```
Driver           = how the app is exercised + ACs observed (rules/drivers.md)
                   browser | api | cli | library | async | iac | mobile | desktop | custom
Session artifact = what "logged in" means for that driver (rules/auth.md)
                   storageState | bearer-token-file | keychain | none
```

## Credential-blind auth (iron rule)

**The AI never sees a password or token.** When a feature needs an authenticated session,
a project **login script** holds the secret, performs the login, writes a session
**artifact**, and prints exactly one line — `<KEY>=<path|ok>` — never the secret itself.
Before invoking it, the skill creates a mode-`0700` run-owned directory and exports its
absolute physical path as `ZENSU_AUTH_ARTIFACT_DIR`, resolves the selected runtime's auth/API
origin and browser application origin, and exports them separately as
`ZENSU_AUTH_BASE_URL` and `ZENSU_APP_ORIGIN`; the script logs in only against the former,
creates browser storage state valid for the latter, and writes the artifact beneath the
directory boundary. The skill receives only the path, validates containment without reading
the file, loads the artifact into the driver, and validates. A script ships **no app code**
(zero prod attack surface), which is why it is preferred over a test-login endpoint. Full
contract, artifact handling, and the security rules: `rules/auth.md`.

## Config

`.zensu/autopilot.yaml` — committed, shared, **secret-free**, written by the skill after a
successful probe and hand-editable but never required. Real secret values live in a
gitignored `.env`, referenced by name only; throwaway login credentials are derived at
runtime inside the login script. Schema + a concrete worked instance: `rules/config.md`.

## Degradation ladder (never dead-end)

```
no start command found   → one plain question in Phase 0 (best guess pre-filled)
no scriptable login      → one question OR skip authenticated validation + note it
no UI                    → validate via api / cli / custom, no browser
toolchain missing        → degrade that driver, note what was skipped
worst case               → still a reviewed, tested PR — minus the live proof, stated
```

## Reference Files

- `rules/probe.md` — detection sources per stack, the resolution order, verify-before-trust,
  and how the resolved recipe is written back.
- `rules/auth.md` — the credential-blind login-script contract, artifact forms + handling,
  the no-endpoint rule, and the security checks the skill enforces.
- `rules/drivers.md` — the driver catalog: how to exercise + assert per driver, sub-modes,
  cross-cutting augments, on-demand drivers, and the `custom` escape hatch.
- `rules/config.md` — `.zensu/autopilot.yaml` schema, a concrete worked instance, and the
  login-script prerequisite a project supplies.
- `rules/work-order.md` — work-order mode: branch, plan file, spec binding, push and PR helpers.

## Critical Conventions

- **Worktree only.** The origin checkout is never built on. If the session starts there,
  `git worktree add .zensu/worktrees/<slug> -b <branch> <base>` and continue inside it.
- **One planning gate.** Zero questions after approval — safest reversible assumption +
  note for non-blockers; halt + report only on a true blocker.
- **Credential-blind.** The AI never receives a password or token; a script delivers auth
  and returns only an artifact path. Artifacts are treated as credentials (temp dir,
  `chmod 600`, deleted after the run, never logged or printed).
- **Never auto-merge / auto-deploy.** Stop at a ready PR. The merge is the human's.
- **Never push to a merged/closed branch.** Re-check `bash "$VCS" --pr-state --provider "$PROVIDER" <n>`
  immediately before every push; if it returns `MERGED`/`CLOSED`, branch off `origin/<base>` and
  open a fresh PR/MR.
- **English PR + commits.** Conventional Commits. No AI watermark / co-author trailer.
- **iac never against prod.** Default plan/dry-run + kind/localstack/throwaway target;
  `apply` only to a disposable environment (see `rules/drivers.md`).
- **Review runs once.** `/zensu-pr-team-review` is the single mid-point pass; the tail loop
  is `/zensu-pr-fix-findings` + validate, never another team review.
