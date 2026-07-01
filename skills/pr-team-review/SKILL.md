---
name: pr-team-review
description: >
  Orchestrate a multi-agent PR review on GitHub: scout the PR, auto-cast a tailored
  reviewer team from a 14-persona pool (DDD strategic/tactical, backend, persistence,
  security, REST API, tests, domain refiner, frontend component/UX, IaC, CI/CD,
  performance, docs), spawn them in parallel, run a debate + synthesis phase, and
  publish one consolidated GitHub review with inline comments + overall body via
  `gh api`. Use whenever the user wants a comprehensive multi-perspective PR review:
  triggers include "team review", "multi-agent PR review", "horde review",
  "agent-team review", "reviewer consensus", "PR debate", "publish team feedback
  to GitHub", a shared GitHub PR URL with the word "review", or the slash command
  /zensu-pr-team-review. Skill drives the workflow end-to-end and posts the result.
---

# /zensu-pr-team-review

Multi-agent PR review orchestrator. Scouts the PR, auto-casts a tailored reviewer team, runs reviews in parallel, debates, synthesises, publishes a single consolidated GitHub review.

## Arguments

Parse from the user prompt. Slash form: `/zensu-pr-team-review <pr-url> [--flag=value ...]`.

| Arg | Required | Default | Notes |
|---|---|---|---|
| `<pr-url>` | yes | — | `https://github.com/<owner>/<repo>/pull/<n>` |
| `--roles=<comma-list>` | no | auto-cast per PR (see `rules/reviewer-personas.md`) | Override the auto-cast |
| `--context=<path>[,<path>...]` | no | none | Extra reference docs (refinement wiki, glossary). Activates `domain-refiner`. |
| `--conversation=<text-or-path>` | no | none | Inline conversation context (naming debate, design decisions, screenshot OCR) |
| `--verdict=<COMMENT\|REQUEST_CHANGES\|APPROVE>` | no | `COMMENT` | Final review event |
| `--max-inline=<n>` | no | 25 | Cap on consolidated inline comments |

If `<pr-url>` is missing, ask the user a single plain numbered question for it.

## Workflow

Five phases. Track each as a tracked item (one per role + one each for Debate, Synthesis, Publish).

### Phase A — Scout + Persona-Cast

**A.1 Scout (read-only) + Worktree Setup:**

```bash
# 1. PR metadata
gh pr view <n> --repo <owner>/<repo> --json title,body,headRefName,baseRefName,files,additions,deletions,author,labels

# 2. Locate repo-root for <owner>/<repo>. If current CWD is not that repo, search
#    standard paths (~/IdeaProjects/<repo>, ~/code/<repo>) or ask the user.
REPO=<repo-root-absolute-path>

# 3. Verify it's a git repo
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null || { echo "not a git repo"; exit 1; }

# 4. Per-run workspace with an UNPREDICTABLE name (mktemp -d) — never a fixed
#    /tmp path. A predictable world-writable name invites a symlink / pre-creation
#    race on shared hosts. Artifacts and the worktree both live under here.
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pr<n>-review.XXXXXXXX")"
WORKTREE="$WORKDIR/wt"

# 5. Fetch PR head into a local ref; capture the head SHA (reviews API needs it)
git -C "$REPO" fetch origin pull/<n>/head:pr-<n>-review
SHA=$(git -C "$REPO" rev-parse pr-<n>-review)

# 6. Worktree at the fetched SHA, DETACHED — MAIN CHECKOUT IS NOT TOUCHED, and a
#    detached checkout never collides on the branch ref when the skill re-runs.
git -C "$REPO" worktree add --force --detach "$WORKTREE" "$SHA"

# 7. Persist env for downstream phases (inside the per-run dir)
printf 'REPO=%s\nWORKDIR=%s\nWORKTREE=%s\nSHA=%s\n' "$REPO" "$WORKDIR" "$WORKTREE" "$SHA" > "$WORKDIR/.env"

# 8. Tell the user where everything lives — the mktemp name is random by design
echo "Review workspace (artifacts + worktree): $WORKDIR"

# 9. Diff-stats from the worktree
git -C "$WORKTREE" diff origin/<base>...HEAD --stat | tail -10
```

**Critical:** never run `git checkout pr-<n>-review` in `$REPO`. That would clobber the user's WIP branch. The worktree is a separate physical checkout sharing the same `.git` — `git -C "$REPO" branch --show-current` continues to show the user's branch after worktree add.

For PRs > 50 files: launch 1-2 read-only exploration subagents in parallel (Antigravity `/agents`) for deep diff inspection per main area (point them at `$WORKTREE` for file reads). Keep their reports under 400 words.

**A.2 Persona-Cast:**

Read `rules/reviewer-personas.md` for the 14-persona pool with trigger signals. Based on the diff file types + paths, select the personas whose trigger signals match. Always present the cast to the user before spawning:

```
Cast for PR #<n> (<X> files, <Y>+/<Z>-):
  ddd-tactical    — Aggregate classes + invariant docs in src/main/.../domain/
  backend-idiom   — 87 *.java files, Spring annotations detected
  persistence-db  — 6 Flyway migrations in db/migration/
  security        — Auth config + new endpoints
  rest-api        — Controller files + OpenAPI annotations
  tests-qa        — Test files present (97 @Test)
```

Ask the user a single plain numbered question: "Cast OK? [1) Go  2) Reduce  3) Expand  4) Custom]". On `Custom` → user gives comma list. If `--roles=` arg was provided → skip the question entirely.

### Phase B — Reviewer Spawn

Spawn all reviewers in a **single parallel batch** as Antigravity subagents (see `/agents`) — one subagent per role:

- `name: <role-id>` (so you can track and address each one)
- Run them in parallel (one batch), not serially.
- Prompt: derived from the `rules/reviewer-personas.md` template for that role + an injected context block (PR metadata, head SHA, base, `--context` paths, `--conversation` text, **`WORKTREE=<absolute-path>` for all git/grep/file reads, plus the output path `<WORKDIR>/<role>.json`**)

If first-class parallel subagents are unavailable in your Antigravity build, adopt each role sequentially yourself — review the diff from `$WORKTREE` once per role and write each `<role>.json` — then consolidate the same way. Findings parity is preserved; only wall-clock and context-isolation change.

Every reviewer prompt MUST contain the explicit `WORKTREE` instruction:

> **Working directory for all git/grep/find/file reads: `<WORKTREE>`** (separate worktree). Use `git -C <WORKTREE> ...` or `cd <WORKTREE>` at the start of your shell calls. **Never** `cd` into the main repo at `<REPO>` — the user is working there in parallel and any `git checkout` would clobber their branch. Output JSON goes to the absolute path `<WORKDIR>/<role>.json` (outside the worktree). Refinement-context paths from `--context=` stay absolute (not relative to the worktree).

Each reviewer writes structured JSON to `$WORKDIR/<role>.json`. Schema in `rules/reviewer-personas.md` (key fields: `inline_findings[]`, `overall_notes[]`, `verdict_hint`).

### Phase C — Wait + Debate

When all reviewers finish (parallel subagents) — or after you have adopted every role sequentially:

1. Read every `$WORKDIR/<role>.json` (parallel `read` calls).
2. Normalize: agents may write slightly different schemas — extract `findings`/`inline_findings` and `verdict`/`verdict_hint` defensively (handle missing keys + broken JSON; if `jq` errors on a file, read raw and parse manually).
3. Write `$WORKDIR/_debate.json` with:
   - `consensus.naming_decision` (if naming was a topic)
   - `consensus.p1_required_changes[]` (deduplicated)
   - `consensus.p2_suggestions[]` (deduplicated, capped at ~20)
   - `consensus.p3_nits[]`
   - `convergence_map` — which finding appears in multiple agents' reports
   - `consensus.verdict` — lead's recommendation

Lead-driven consolidation, not a DM roundtrip. See `rules/workflow.md` § Debate Strategy.

### Phase D — Synthesis + GitHub Publish

Write `$WORKDIR/_synthesis.json` as the exact `gh api` payload:

```json
{
  "commit_id": "<head-sha>",
  "event": "<verdict>",
  "body": "<markdown overall body>",
  "comments": [
    {"path": "src/...", "line": 42, "side": "RIGHT", "body": "<markdown>"}
  ]
}
```

Overall body structure (Markdown):

```
## Multi-Agent Review — PR #<n> (<title>)

Review by N-agent team (...).

### TL;DR
<2-3 sentence summary>

### Naming Decision   <!-- only if --conversation or DDD-strategic raised it -->
<consensus>

### Required Changes (P1)

#### 1. <Area> — <short title>
<2-4 sentence explanation>. Source: <persona-ids>.

#### 2. <Area> — <short title>
...

### Suggestions (P2)
- **<Area>**: <issue + fix in one sentence>. Source: <persona-id(s)>.
- ...

### Strengths
- ...

### Open Questions
- ...

### Recommendation
<verdict + rationale>
```

**HARD RULE — NO MARKDOWN TABLES** in the overall body or inline comments. GitHub's PR view squeezes wide tables into unreadable narrow columns (text wraps character-by-character). Use:
- numbered subsections (`#### 1. ... #### 2. ...`) for P1 findings
- bullet lists with bold prefixes (`- **Area**: ...`) for P2 / Strengths / Open Questions
- plain prose for everything else

Same rule applies inside inline comments — no tables. Code fences, bullet lists, bold prefixes only.

Inline findings: max `--max-inline` (default 25), sorted by path then line, P1 first. See `rules/github-publish.md` for the `gh api` call, `line`/`side` rules per file `changeType` (ADDED/MODIFIED/RENAMED), and idempotency.

Before posting, show the user the body preview + inline count.

Submit:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<n>/reviews \
  --input $WORKDIR/_synthesis.json
```

Verify:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id>/comments | jq length
```

Return the review URL (`html_url` from the POST response) to the user.

### Phase E — Cleanup

For each parallel subagent: request its shutdown once its report is read (skip if you ran the roles sequentially).

Remove worktree (main checkout untouched):

```bash
git -C "$REPO" worktree remove --force "$WORKTREE"
```

Keep `$WORKDIR/` (JSON artifacts) as a debug record — do not delete.

Ask the user whether to drop the local PR ref:

> Worktree removed. Delete local `pr-<n>-review` ref as well? [y/N]

Default: keep the ref (user can re-inspect or re-run). If `y`: `git -C "$REPO" branch -D pr-<n>-review`.

## Reference Files

- `rules/reviewer-personas.md` — 14-persona pool, trigger signals, prompt templates, JSON schema
- `rules/workflow.md` — phase-by-phase pitfalls + heuristics
- `rules/github-publish.md` — `gh api` reviews schema, side/line rules, fallbacks

## Critical Conventions

- **Never `git checkout` the PR ref in the main working tree.** Always use a detached worktree under an `mktemp -d` workspace (`git worktree add --force --detach "$WORKTREE" "$SHA"`). Reviewer subagents `cd` into the worktree, not the main repo. The main checkout's branch and uncommitted work must stay untouched.
- Always spawn reviewers in **one** parallel batch. Serial spawning wastes wall-clock time; the sequential-role fallback is only for builds without parallel subagents.
- Reviewers write to `$WORKDIR/<role>.json` (absolute path, outside the worktree). Lead reads + consolidates.
- Submit ONE review with bundled inline comments — never N single-comment reviews.
- Default verdict `COMMENT`. Only escalate to `REQUEST_CHANGES`/`APPROVE` if user explicitly asked via `--verdict=`.
- Idempotent: re-running on the same PR posts an additional review (no overwrite). Each run gets a fresh `mktemp -d` workspace + detached worktree, so a re-run never collides with a prior run's worktree or the branch ref.
- If `gh auth status` fails or the user lacks `repo` scope → stop and ask the user to fix auth before doing the review work.
