---
name: doctor
description: '[Zensu] Read-only setup diagnostics for the Zensu plugin. Runs hooks/lib/zensu-doctor.sh and prints a four-block table: CLI & tooling (zensu CLI + auth, node, the agy host binary, the code-forge CLI gh/glab resolved from the provider of the repo), plugin integrity (plugin.json version, the ~/.zensu/plugin-root pointer, hooks.json entries wired to files that exist on disk), config (valid JSON, the quoted-boolean trap where "true"/"false" as a string is silently ignored by strict === checks), and session state (state dir writable, stale or expired markers). The only write is an explicit, user-confirmed cleanup of one expired pending-review marker. Use when the user asks to "diagnose zensu", "check my zensu setup", "why is a zensu hook or gate not firing", "zensu doctor", or the slash command /zensu-doctor.'
---

# /zensu-doctor

Read-only health check for the Zensu plugin install. It answers the questions
that otherwise get debugged by hand: is the CLI authenticated, is the plugin
staged where Antigravity actually looks for it, are the hooks wired to scripts
that exist, is the config being read the way you think it is (the quoted-boolean
trap bites silently), and is there stale session state. It prints one four-block
table and changes nothing — the single exception is removal of an expired
`pending-review.json` you explicitly confirm.

> One command to see why something is not firing. Nothing is changed unless you say so.

## When to Use

- The user asks to "diagnose zensu", "check my zensu setup", "run zensu doctor",
  or invokes `/zensu-doctor`.
- A hook or gate is not firing and you need to see whether it is staged, wired,
  configured, or authenticated.
- After onboarding a new machine, re-running `install.sh`, or switching
  worktrees.

## Do NOT Use For

- Changing configuration — that is `/zensu-setup` (guided writes).
- Resetting the auto-fix round counter — that is `/zensu-reset-review-limit`.
- Any repair beyond the confirmed expired-pending-review cleanup below. Doctor
  diagnoses; it does not fix staging, wiring, versions, or auth.

## Prerequisites

None. No API key, no network. The tool probes are local (`command -v`,
`--version`, auth-status exit codes) and the manifest/config/state reads are
local files.

## Phase 1: Run the diagnostics

The plugin runtime root is the content of `~/.zensu/plugin-root`, written by
`install.sh` when it staged the plugin into `~/.gemini/config/plugins/zensu`
(IDE) and `~/.gemini/antigravity-cli/plugins/zensu` (CLI).

Run the following as ONE shell call. The explicit preflight deliberately does
not use `${VAR:?...}`: a missing or invalid root must still print the same
standardized doctor table fragment instead of terminating in an unformatted
shell error.

```bash
ROOT="$(cat "$HOME/.zensu/plugin-root" 2>/dev/null)"
case "$ROOT" in /*) ;; *) ROOT="" ;; esac
if [ -z "$ROOT" ] || [ -L "$ROOT" ] || [ ! -d "$ROOT" ] \
  || [ -L "$ROOT/hooks/lib/zensu-doctor.sh" ] || [ ! -f "$ROOT/hooks/lib/zensu-doctor.sh" ]; then
  printf '%s\n' \
    'Zensu doctor — read-only setup diagnostics' '' 'Plugin integrity' \
    '  ❌  plugin root unavailable or invalid — re-run install.sh, then restart Antigravity' \
    '' 'Summary: 1 ❌  0 ⚠️  — resolve the ❌ items first.'
else
  ZENSU_PROJECT_DIR="${ZENSU_PROJECT_DIR:-$(pwd)}" bash "$ROOT/hooks/lib/zensu-doctor.sh"
fi
```

Print its output verbatim to the user — it is already the formatted four-block
table with a summary line. The helper always exits 0; a red ❌ is a finding in
the report, not a failed command. Do not re-render or paraphrase the table.

## Phase 2: Interpret

Briefly call out, in one or two lines, the highest-severity findings and the
concrete next step for each — but only for rows the table actually marked
⚠️ or ❌:

- **❌ zensu CLI not found** → install it (`curl -fsSL https://zensu.dev/install.sh | sh`)
  and make sure it is on `PATH`. Every Zensu command in this plugin is a typed
  `zensu` CLI call, so nothing else works without it.
- **⚠️ zensu not authenticated** → `zensu auth login`.
- **❌ plugin-root pointer stale** → `~/.zensu/plugin-root` names a directory that
  no longer holds the plugin. Re-run `install.sh`, then restart Antigravity.
- **❌ hooks wiring: referenced but missing** → a `hooks.json` command points at a
  script that is not on disk; that hook silently never runs. Re-run `install.sh`
  so the template is re-rendered against the staged tree.
- **⚠️ hooks.json not rendered yet** → the report fell back to
  `hooks.json.template`, which means this is a source checkout rather than a
  staged install. Run `install.sh`.
- **⚠️ config quoted boolean** → the named key is a string (`"true"`) where a real
  boolean is required; a strict `=== true` check ignores it, so the feature stays
  at its default. Drop the quotes (offer `/zensu-setup` to rewrite it safely).
- **⚠️ forge CLI not authenticated / not found** → authenticate or install the CLI
  the report names for the detected provider: `gh auth login` for GitHub,
  `glab auth login` for GitLab (`unknown` means no github/gitlab remote was
  detected — add one, or export `ZENSU_VCS_PROVIDER=github|gitlab` for a
  self-hosted host).
- **⚠️ agy host not on PATH** → only matters for the CLI plugin dir; IDE-only use
  is unaffected.
- **❌ state dir not writable** → the FSM cannot record chain markers, so the
  review chain and the phase-gate degrade. Fix the directory permissions.

If everything is green, say so in one line and stop — there is nothing to do.

## Phase 3: Expired pending-review cleanup (the ONLY write, always user-gated)

`tdd-phase-*.json` files are live per-session workflow documents, not leftovers.
Never delete, rename, or rewrite them here. Their round and chain flags are
re-armed only by `/zensu-reset-review-limit`.

Only when the **Session state** block explicitly reports
`pending-review.json ... expired`, you MAY offer to remove that one exact file:

1. Derive the exact state directory of the current worktree without scanning:
   `${ZENSU_PROJECT_DIR:-$(pwd)}/.zensu/state`. Reject a missing directory or
   any symlink.
2. Set `PENDING="$STATE_DIR/pending-review.json"`. Require a regular,
   non-symlink file. Show this exact path; do not list the directory.
3. Ask the user a single plain numbered question:
   "Remove expired pending-review.json? [1) Remove  2) Keep it]".
4. On explicit confirmation only, run `rm -f -- "$PENDING"`. Never use a glob,
   `find`, parent traversal, or worktree discovery.
5. Non-interactive runs remain report-only.

An unparseable workflow document is a fail-closed diagnostic, never a cleanup
candidate. Recommend a fresh session and code-level investigation instead of
mutating it.

## Response Style

Terse and concrete. Lead with the table (verbatim), then at most two lines of
interpretation, then the cleanup offer only for an expired pending-review file.
Reference config keys and file paths exactly as the table printed them.
