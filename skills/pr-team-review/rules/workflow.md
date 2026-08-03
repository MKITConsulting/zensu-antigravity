# Workflow Details + Pitfalls

Companion to `SKILL.md`. Read on demand when a phase needs depth.

## Worktree-Isolation (critical safety property)

The skill MUST NOT switch branches in the main working tree. The user is typically working on a feature branch with uncommitted changes — a stray `git checkout pr-<n>-review` would clobber that. Worktree-isolation prevents this.

**Pattern:**

```bash
REPO=<absolute-path-to-repo-root>

# Per-run root with an UNPREDICTABLE name (mktemp -d) — never a fixed /tmp path.
# A predictable world-writable name invites a symlink / pre-creation race.
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pr<n>-review.XXXXXXXX")"
WORKTREE="$WORKDIR/wt"

# Create worktree — separate physical checkout, shared .git. DETACHED at the
# fetched SHA so a re-run's fresh worktree never collides on the branch ref.
git -C "$REPO" fetch origin pull/<n>/head:pr-<n>-review
git -C "$REPO" worktree add --force --detach "$WORKTREE" "$(git -C "$REPO" rev-parse pr-<n>-review)"
```

After `worktree add`:
- `git -C "$REPO" branch --show-current` still reports the user's WIP branch — the main checkout is untouched.
- the worktree is in DETACHED HEAD at the PR head SHA; `git -C "$WORKTREE" rev-parse HEAD` echoes that SHA.
- Both share `.git` — disk overhead is roughly the working-tree size, not double the repo.

**Reviewer prompts MUST inject `$WORKTREE`** as the working directory for all git/grep/file operations. See Phase B Spawn Pitfalls.

**Locating `$REPO`:** if the current CWD is the right repo for `<owner>/<repo>`, use that. Otherwise search `~/IdeaProjects/<repo>`, `~/code/<repo>`, `~/work/<repo>` — if none match, ask the user a single plain numbered question. Never invent paths.

**Disk-space caveat:** worktree duplicates the working files (not `.git`). For repos > 1 GB warn the user before `worktree add`. `du -sh "$REPO" --exclude=.git` gives a quick estimate.

**Cleanup belongs in Phase E:** `git -C "$REPO" worktree remove --force "$WORKTREE"`. Without this, stale worktrees pile up under `/tmp/`. On crash, the user can run `git -C "$REPO" worktree prune` to clean up the bookkeeping.

## Phase A.1 — Scout Pitfalls

- **`git fetch origin pull/<n>/head:pr-<n>-review` fails with "couldn't find remote ref"**: PR is from a fork. Use `gh pr checkout <n>` inside the worktree — but that command checks out into the *current* CWD, so first `cd "$WORKTREE"` then run it. Never run `gh pr checkout` from `$REPO` root.
- **Head SHA changes between scout and publish**: Re-fetch SHA right before the publish step. The reviews API rejects stale SHAs with HTTP 422.
- **Wrong base branch**: PR JSON `baseRefName` is authoritative. Don't assume `main`/`dev` — read it.
- **Huge PR (> 200 files)**: Cap `--stat` output, use `git diff --name-only` for routing only. Don't dump full diff into agent prompts.
- **`$REPO` is not a git repo**: `git -C "$REPO" rev-parse --is-inside-work-tree` fails. Stop and ask the user for the right repo-root path.

## Phase A.2 — Persona-Cast Heuristics

Trigger detection runs against `git diff origin/<base>...pr-<n>-review --name-only`. Cast scoring:

| Signal type | Weight |
|---|---|
| File-extension match | Activates persona |
| Path-prefix match (e.g. `docs/DDD/`) | Activates persona |
| Migration directory present | Forces `persistence-db` |
| New endpoint files | Forces `security` + `rest-api` |
| `--context=` flag | Forces `domain-refiner` |
| `--conversation=` mentions naming/glossary | Forces `ddd-strategic` |
| Any executable-code change | Forces the always-on holistic core (`coverage-audit`, `bug-hunter`, `maintainability`, `adversarial`) |
| Dependency manifest / lockfile change | Forces `supply-chain` |
| New personal-data field, logging of user data, export | Forces `data-privacy` |
| Public contract change (REST/gRPC/GraphQL/events) | Forces `api-compat` |
| Shared mutable state / threads / async | Forces `concurrency` |
| UI templates | Adds `accessibility` alongside `frontend-component` / `frontend-ux` |

Cast size sanity check: with the always-on core a typical code PR runs 6-12 reviewers. Under 6 → ask the user if more breadth is wanted. Over 12 → ask the user to trim, but the holistic core is never trimmed.

For docs-only PRs (only `*.md` changes), skip the specialist multi-cast — go straight to `docs-only` PLUS `coverage-audit` (which reports `N/A`) + simplified synthesis. The `### Test Coverage` section still renders.

## Phase A.1.1 — Coverage Evidence (main-thread only)

The `coverage-audit` persona is cast on every run and its `### Test Coverage` section is mandatory (see Phase D). Evidence collection belongs to the main thread; the reviewer only classifies the prepared evidence. Operational notes:

- **Static-first is the default.** Without `--run-coverage`, the main thread does not build or run the suite. It maps changed production files to tests by name/import/symbol reference and crosses any *already-present* coverage report against the diff before spawn. This keeps the skill inside its 3-7 min budget.
- **"Production file" = changed, non-test, executable source.** Exclude test files, fixtures, generated code, lockfiles, and pure docs/config from the uncovered inventory (a changed `*.md` or `*.lock` is not "uncovered code"). When in doubt, list it under `partial_files`/notes rather than as a hard `uncovered_files` entry. The authoritative list lands in `$WORKDIR/_changed-production-files.txt`.
- **Existing report, not a fresh run.** The main thread reads artifacts that already exist in the checkout (CI left a `jacoco.xml`, a `coverage/lcov.info`, etc.) and records relevant excerpts in `_coverage-evidence.md`. Finding none is normal — fall back to static and say so in `coverage_source`.
- **`--run-coverage` is slow + fragile.** The main thread detects the project's coverage process (config files first), executes it once, and captures output/status/report paths in `_coverage-evidence.md`. On any failure it records the reason and falls back to static; a failed coverage run never aborts the review. A reviewer never starts a process.
- **Honesty over precision.** Static mapping is an approximation; label it as such. A file with no matching test is `uncovered`; a file whose new public method has no test is a `partial` with that method under `uncovered_paths`.
- **Fallback if the agent dies.** If `coverage-audit.json` is missing/broken at Phase C, synthesize a minimal report from the diff (changed non-test files → `uncovered`, `coverage_source: "static (fallback)"`) so the section still renders. The guarantee is the section's presence, not the agent's liveness.

## Phase B — Spawn Pitfalls

- **Inject `$WORKTREE` into every reviewer prompt** — explicit instruction: "use `$WORKTREE` as CWD for git/grep/file reads; never `cd` into the main repo at `$REPO`". Without this, agents default to running git commands wherever and can clobber the user's branch (see Worktree-Isolation section above).
- **Parallel spawn matters**: spawn ALL reviewer subagents in ONE parallel batch. Serial spawning wastes wall-clock time (each reviewer takes 1-2 min — parallel completes in 2 min, serial in 16 min). If first-class parallel subagents are unavailable in your Antigravity build, adopt each role sequentially yourself.
- **Pass each subagent a `name`**: required so you can track and address (shut down) each reviewer.
- **Inject ALL context in the prompt**: the agent starts fresh with no history. Include PR metadata, head SHA, base ref, `$WORKTREE` path, `--context` paths verbatim, `--conversation` text.
- **Reference the persona template in the prompt**: don't inline the full template — the agent can `read` `{PLUGIN_ROOT}/skills/pr-team-review/rules/reviewer-personas.md` if it needs the schema.

## Phase C — Debate Strategy

**Why lead-consolidated, not DM-roundtrip:** spawning a second round (each agent reviewing the others' reports) doubles wall-clock time without doubling signal. The lead has full read access to all reports and can identify convergence/conflicts directly. Use a second round only when:

- Reviewers explicitly contradict on a major decision (e.g., one says APPROVE, three say REQUEST_CHANGES).
- Naming/architecture decision requires multi-stakeholder buy-in beyond what the lead can adjudicate.

**Schema normalization:** reviewers may write slightly different schemas — handle defensively:

```bash
# Inspect actual keys
for f in $WORKDIR/*.json; do echo "=== $f ==="; jq 'keys' "$f" 2>&1 | head -5; done
```

Common variations:
- `findings` vs `inline_findings`
- `verdict` vs `verdict_hint`
- `severity: P1/P2/P3` vs `HIGH/MEDIUM/LOW` vs `blocker/major/minor`

Normalize during read, not before — keep the raw files for debug.

**Broken JSON:** if `jq` errors on a file, use `read` to inspect and parse the structure manually. Common cause: agent embedded a code block containing `{` that breaks naive JSON parsers (rare with modern agents but possible).

**Challenge Round (anti-groupthink) — MANDATORY before finalizing consensus.** Lead consolidation is efficient but risks rubber-stamping: five personas that each glance at the happy path can all miss the same failure, and a pile-up of agreeing findings reads as more certainty than it earned. The always-on `adversarial` persona exists to break that. Before writing `consensus.verdict`:

1. Take the `adversarial` report (`$WORKDIR/adversarial.json`) — its pre-mortem, steelman, and "what did the siloed specialists collectively miss" notes.
2. For each emerging **P1**, test it against the adversarial lens: does the pre-mortem / steelman refute it, reframe its severity, or leave it standing? Drop or re-rank the findings that don't survive; keep the survivors with more confidence.
3. For any **APPROVE-leaning** verdict, run the pre-mortem first — "it's 3am, this change caused the incident, what was it?" — and keep APPROVE only if nothing plausible surfaces.
4. Promote any adversarial risk that no specialist raised, but that would sink the change, into the P1/P2 list.

The rule is **convergence != correctness**: high convergence raises a finding's authority but does not verify it, and a real risk only the adversarial persona saw still counts. Record the surviving / killed / added set in `_debate.json` under `challenge_round` so the synthesis can cite it. This stays lead-driven; there is no extra reviewer-to-reviewer messaging round.

**Convergence map:** when N agents flag the same line, that's high-signal. Merge into one inline comment citing all sources ("Convergence: backend-idiom, rest-api, tests-qa all flagged this — ..."). Increases the comment's authority + reduces duplicate noise on the PR.

## Phase D — Synthesis + Publish

**Test Coverage section (mandatory, never dropped):**

Render `### Test Coverage` in the overall body on EVERY run from `consensus.coverage` (the `coverage-audit` report carried through Phase C). Rules:

- **Open with a one-line source disclosure**, italic, so the reader knows how the numbers were derived: `_Source: <coverage_source> — <AI static mapping (approximate) | from report:<path> | tool-run>._` The default is the AI's static diff-vs-test mapping; only `--run-coverage` or an ingested report gives measured numbers. State it honestly.
- **Then a compact status table** — the ONE table permitted in the body (see the No-tables carve-out below). Exactly four short **numeric** columns, so the forge cannot squeeze it:

  ```markdown
  | Covered | Partial | Uncovered | Changed prod files |
  |--:|--:|--:|--:|
  | 12 | 2 | 3 | 17 |
  ```

  Counts come from `covered_files[]`, `partial_files[]`, `uncovered_files[]`, `changed_production_files`. When `changed_production_files == 0` (docs/config-only PR) DROP the table entirely and render just `N/A — no production code changed in this PR.`
- Below the table, list every `uncovered_files[]` entry as a bullet — `` `path` — reason — risk ``. If empty: "None — every changed production file is exercised by a test."
- List `partial_files[]` uncovered paths as an **Uncovered paths** bullet list — `` `path` -> `fn/method/branch` (covered by: `<test>`) ``. If empty: "None."
- **Detail stays in bullets, never in the table.** Long file paths wrap character-by-character inside a table cell — exactly the failure the No-tables rule guards against. The table carries only the at-a-glance counts; everything with a path goes in a bullet.
- The section is present even when the verdict is APPROVE and even for docs-only PRs. A green coverage result is still reported explicitly — silence is not allowed.
- `--coverage-gate`: if set and `uncovered_files[]` (production) is non-empty, the verdict is `REQUEST_CHANGES` and the Recommendation cites the uncovered files. Without the flag, coverage is advisory and the verdict is unaffected.

**Inline-comment cap (`--max-inline`):**

Default 25. Strategy when consolidated findings exceed cap:
1. Always include all P1 findings.
2. Fill remaining slots with P2 findings, sorted by convergence (multi-agent first).
3. Drop P3 findings into the overall body as a "P3 Nits" bulleted list — no inline comment for those.
4. If still over cap → keep only the most actionable P2s; mention skipped P2s in overall body.

**Overall body length:** target 600-1200 words. Reviewer fatigue is real — a 5000-word body gets skimmed. Cut Strengths section to 5-7 bullets max. Cut Open Questions to 5 max.

**No tables — one carve-out.** The forge's PR/MR view squeezes Markdown tables into narrow columns that wrap character-by-character — unreadable. Use numbered subsections (`#### 1. ...`) for P1 findings and bullet lists with bold prefixes (`- **Area**: ...`) for P2 / Strengths / Open Questions. Lead is responsible for the synthesis Markdown — persona reports may still use tables internally (they live in `$WORKDIR/<role>.json` and are not posted), but the synthesis MUST flatten everything to prose/bullets/headings. **The sole exception is the `### Test Coverage` status table** above: four short all-numeric columns (Covered / Partial / Uncovered / Changed) that the forge cannot squeeze because every cell is a small integer. That carve-out is limited to those counts — file paths, findings, and every other table stay banned and flatten to bullets.

**No tables in inline comments either.** Inline comments suffer the same column compression. Use code fences, bullet lists, bold prefixes only. The coverage-table carve-out is **body-only** — inline comments never contain a table.

**Anchor validation (mandatory, before the preview):** validate every inline comment's `(path, line, side)` against the PR diff with

```bash
node "<absolute-plugin-root>/hooks/lib/valid-diff-lines.js" '<path>' '<line>' '<side>' < "$WORKDIR/_pr.diff"
```

where `<absolute-plugin-root>` is replaced with the concrete plugin root the parent skill already resolved in Step 0, before issuing the shell call. Follow `github-publish.md` § Pre-Publish Anchor Validation — the quoting rules there are load-bearing: `valid` → keep, `remap <n>` → move the anchor and append the remap note to the comment body, `none` (or no output) → fold the finding into the overall body under **Findings without a diff anchor**. The payload may only carry validated anchors — this eliminates the 422 line-out-of-diff round-trip.

**Pre-publish preview:** ALWAYS show the user the final overall body + inline count before posting and wait for an explicit publication approval. Approval to run the skill or to accept the cast is not publication approval. If the user declines, keep the local artifacts and stop without posting.

## Phase E — Cleanup

- Request a shutdown of each reviewer subagent once its report is read (skip if you ran the roles sequentially).
- Don't delete `$WORKDIR/` — it's a debug artifact. macOS clears `/tmp` on reboot.
- Mark all tracked items `completed`.
- Final message to user: review URL + one-sentence summary of verdict.

## Failure Modes

- **POST 422 line out-of-diff**: should not happen — every anchor is pre-validated with `valid-diff-lines.js` before the payload is written. If it still fires, re-derive `_pr.diff`, re-validate every anchor, and retry; only as a last resort drop the offending comment and fold it into the overall body.
- **POST 401**: tell the user to re-authenticate the detected forge's CLI (`gh auth refresh` / `glab auth login`). Never fall back to the other forge.
- **VCS driver missing** (`hooks/lib/zensu-vcs.sh` absent): announce degraded mode once, treat the forge as GitHub, and use the direct `gh` equivalents. Do not hand-roll a GitLab path — ask the user to reinstall the plugin.
- **`coverage-audit` report missing/broken**: synthesize the minimal static fallback report (Phase A.1.1) so the mandatory `### Test Coverage` section still renders.
- **Reviewer agent dies mid-run**: a tracked item shows in_progress; respawn that single agent (same name, same prompt).
- **All reviewers report APPROVE**: still post the review with `event=COMMENT` summarising strengths — user values the audit trail.
- **PR closed/merged while review runs**: detect via `gh pr view --json state`; abort gracefully, save artifacts.
- **Worktree / branch-checkout collisions** (path already exists, branch already checked out, orphaned dir): no longer occur — each run gets a fresh `mktemp -d` workspace and the worktree is DETACHED at the head SHA (it never checks out the `pr-<n>-review` branch). After a crash the worktree just lingers under its random `$WORKDIR`; `git -C "$REPO" worktree prune` clears the stale bookkeeping and the next run is unaffected.
- **Disk full while creating worktree**: detect via `df -h /tmp`; warn user and offer `--worktree-path=<custom>` (later enhancement) or proceed without worktree (degraded: read diff via `gh pr diff` only, no file-level reads).

## Performance

Typical end-to-end timing (8-reviewer cast on 100-file PR):

| Phase | Wall clock |
|---|---|
| A.1 Scout | 10-20 s |
| A.2 Persona-Cast + user confirm | 30-60 s (user-dependent) |
| B Spawn | < 5 s |
| Reviewer parallel run | 1-3 min |
| C Debate | 30-60 s (lead reads + writes) |
| D Synthesis | 30-90 s |
| D Publish | 5-10 s |
| **Total** | **3-7 min** |

Serial spawn would be 8-24 min — always parallel.
