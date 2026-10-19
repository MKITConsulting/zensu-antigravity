### `--reanchor` — moving the anchor to a sibling worktree of the same repository

Native limit: the canonical reanchor helper requires complete live-session ownership
proof. The native conversation index and transcript snapshots do not establish that proof.
Until a verified native live-session registry is available, relay `live-sessions-unverifiable`
and start a fresh conversation in the desired worktree; never synthesize registry files,
force the move, or claim a safe reanchor from a Session Trail snapshot. The checks below
state the helper's strict prerequisites; they are not a claim that this host meets them.

A third mode, and its own question: the record is healthy and served, but this session
now works in a DIFFERENT worktree of the same repository than the one its record names.
Until the anchor moves, the opt-in source-write gate, while it is on (`hooks.bashWriteGate:
true`), denies `git add` and new source writes in the worktree the session actually works in,
and review/evidence snapshots remain bound to their original tree.

Run it FROM INSIDE the worktree this session should be anchored to. The working
directory of the command is the target; a subdirectory is fine, because the worktree's
top-level is what moves in. No argument names the target, so select it in
the native command tool's `Cwd` field. Do not prepend `cd` to the guarded helper call:

```bash
{session-helper} --helper session-reanchor --
```

Read-only — it reports `MOVABLE` or `NOT MOVABLE (<reason>)` and writes nothing. **With
`--confirm`** it re-mints this session's Session Control record with the new project root
and nothing else changed — the same installation, runtime digest, version and
`created_at` — and sets the previous record aside unchanged as
`<session-key>.superseded-reanchor-<UTC stamp>.json`. It then creates this session's
workflow document under the new worktree when there is none, writes one
`PROJECT_ROOT_REANCHORED` history entry into the new AND the old workflow document, sets
aside review-evidence leases bound to the old root, moves this session's `tdd-mode`,
`delivery-route` and `zen-mode` markers to the new worktree, and, while
`hooks.worktreeKeep` is on, ages this session's keep anchor in the old worktree and
writes one in the new one. The move takes effect from the next tool call for the
source-write gate, the reviewers and the `zensu-log.sh` verbs. The host does not move: it
keeps this session's start directory, and the Bash tool returns there after a command that
leaves it, so give your own commands — a build, a test run, `git` — a `cd` into the new
anchor. `/zensu-tdd`, `/zensu-self-review`, `/zensu-converge` and
`/zensu-verify-feature --chain` read the anchor from `zensu-log.sh --project-root` and run
their own commands inside it, and `--evidence-run` runs there too, so their plan, run log,
baseline, edit-landing audit, test runs and acceptance checks follow the move, and a new
`/zensu-tdd` chain can start in this session — unless the new anchor's path holds a double
quote, a dollar sign, a backtick or a backslash, which `--project-root` refuses; the report
then says so instead of promising a chain. `/zensu-plan-review`, `/zensu-setup`,
`/zensu-cover`, `/zensu-autopilot` and `/zensu-pilot` still read plans, config, overlays and
templates from the start directory, and so does the source-write gate's project-level
`hooks.bashWriteGate` opt-in, which it reads through the host's project directory ahead of
its bind.

The target is verified, never trusted. It refuses unless every one of these holds:

- the record reads strictly and this installation serves it — after a plugin update
  that breaks the lineage, adopt first;
- the recorded project root still EXISTS inside a git worktree, because a root that is
  gone cannot prove which repository it belonged to — `--restore-root` is the mode for
  that state;
- the command's directory is inside a git worktree of the SAME repository (the same git
  common directory), and that worktree is registered with git and not prunable;
- it is not already the anchor, it does not contain the recorded root — that would widen
  the anchor instead of moving it — and no other registered worktree lies inside it;
- this session's workflow document under the recorded root is readable and holds no open
  work: no armed chain short of its terminus, no open skill workflow, no linked Autopilot
  run, no pending review rearm and no claimed deferred review. That evidence is bound to
  the old root and is never carried across;
- no Autopilot run this session owns under the recorded root is still open. The Autopilot
  state library answers that, so a run no chain links yet counts too; a run at `DONE` or
  `CANCELLED` does not, and a run state or lock the library cannot read refuses. Cancel an
  open run of this session through `--autopilot-event --event CANCEL`:
  `/zensu-autopilot-release` refuses the caller's own run;
- no other live session is found in that worktree. A live session is found when this
  Antigravity configuration's live-session registry (`<config dir>/sessions/`) lists it
  with a working directory or a Zensu-recorded project root there, or when its
  worktree-keep anchor there is live — an anchor this build cannot validate counts as
  well. A session that only edits files there by absolute path is none of these, which is
  why the report lists the target's uncommitted paths;
- that evidence is complete: the registry is readable, lists THIS session, and every entry
  of a live process in it can be read.

Its refusals, each of which writes nothing and prints its own remedy: `session-id-unusable`,
`private-record-store-unsafe`, `record-unreadable`, `recorded-root-missing`,
`not-served-by-executing-runtime`, `plugin-data-mismatch`, `workflow-document-unusable`,
`workflow-in-progress`, `autopilot-state-unverifiable`, `recorded-root-not-in-a-worktree`,
`target-not-in-a-worktree`, `different-repository`, `target-not-a-registered-worktree`,
`already-anchored`, `target-contains-recorded-root`, `target-contains-other-worktrees`,
`target-workflow-document-unusable`, `claimed-by-live-session`,
`live-sessions-unverifiable` and `verdict-unavailable`. Render the reason, its remedy
and every detail line verbatim.

**Confirm with the user before adding `--confirm` here too.** `--confirm` is an argument
anyone who can run the command can add, so this step is the consent. Run the read-only
form, relay both roots and the uncommitted paths it lists verbatim together with its
detection bound — a session visible to none of its sources, for example one started under
another host profile without a keep anchor, or one that only edits there by
absolute path, is not detected — and only after the user agrees run the confirm form from
the worktree the report named as `new anchor`, so the move lands where the user agreed:

```bash
{session-helper} --helper session-reanchor -- --confirm
```

**What it keeps.** The source-write gate, whenever it is opted in, still compares every write
against the one recorded root and is not weakened: the move refuses a worktree in which it finds another
live session and a checkout that contains other worktrees, so it never widens this
session over another session's tree that its sources show. It only changes which
worktree of this repository counts as this session's own. The old worktree is outside
this session from then on, including for reviewers.

Its `--confirm` output is `MOVED` with a row per fact, including which session markers
moved; a marker that could not move keeps its setting under the old root, where this
session no longer reads it. Relay every `WARNING:` line: one
about the lease store means a lease still bound to the old root could not be set aside
and review-evidence operations of this session keep failing until it is moved by hand,
and one about provenance means the move is real but not recorded in that history. Exit
codes: `0` for a report or a clean move, `1` for a refusal, a failure, or a move whose
lease sweep was incomplete, `2` for a bad argument.

Main thread only: a reviewer or neutral child is refused by every gate.

## Phase 1: Report, adopt, verify

> **If the diagnosis is a vanished recorded project root, this Phase does not apply.**
> That state has its own mode, `--restore-root`, documented under Prerequisites above —
> including its own confirm-with-the-user step, which the three steps below do not cover.
> Read that section before emitting anything, and never emit `--restore-root --confirm`
> from here. The same holds for a session that works in a sibling worktree of the same
> repository: that is `--reanchor`, with its own consent step.

**Step 1 of 3 — report.** Run the read-only form. It changes nothing.

```bash
{session-helper} --helper session-adopt --
```

Render both versions and the verdict verbatim. On a refusal, render the reason
and its remedy verbatim too and STOP — every refusal names a different cause.

**A quoted, backslash-escaped value is NORMAL output, not corruption.** Every
non-constant string in the report goes through a positive allowlist: an ordinary
path — including a localized one with umlauts, accents or CJK — prints as itself,
and anything outside the set is emitted JSON-quoted with non-ASCII folded to
`\uXXXX`. Two further shapes force the quoted form even when every character is
allowed: a run of two or more spaces, and a literal `" : "`. Both exist because the
report is a list of `label : value` pairs and a directory name must not be able to
forge another one. Render whatever you get verbatim; do NOT un-escape it, and do not
report it as damage.

Every refusal a user can see is in the table below. Most are `adoptableRecord`
verdicts; THREE are emitted by the ENTRY POINT and are marked as such —
`session-id-unusable` and `private-record-store-unsafe` before those verdicts are
ever reached, and `superseded-record-exists` after they passed. Each prints its own
remedy inline, so render that verbatim too.

| Reason | Meaning |
|--------|---------|
| `session-id-unusable` | Entry-point refusal, raised before anything is read: the session identity the command was given is empty, malformed, or a DERIVED Session Control identifier rather than the raw host session id. Nothing is read and nothing is changed, and the record store is not implicated — a fresh Antigravity session is the way forward. |
| `private-record-store-unsafe` | Entry-point refusal, raised before `adoptableRecord` runs: the private record store itself could not be opened safely — missing, aliased, or carrying unsafe permissions or ownership. |
| `superseded-record-exists` | Entry-point refusal, raised AFTER `adoptableRecord` passed: the record itself is adoptable, but an interrupted adoption left `<session-key>.superseded-<version>.json` in place and the adoption refuses to overwrite it. Both forms name the file — the read-only report as `NOT adoptable`, `--confirm` as `NOT adopted` — because the shared preview owns the check. Moving the file aside is the remedy; a retry alone is a loop. |
| `record-unreadable` | The record no longer re-verifies against the installation that minted it — altered, or a real schema change. Two states that used to land here no longer do on their own: a recorded project root that is merely GONE is adoptable, and so is a minting installation merely pruned from the cache. A pruned installation IS still this refusal when the recorded project root is ALSO gone, and so is a vanished project root when the minting installation is also pruned, because each relaxed reader pins the other's waiver off and nothing is left to anchor the record to. |
| `plugin-data-mismatch` | The record belongs to a different plugin-data store. Never relaxed. |
| `already-served` | Nothing to RE-MINT, and TWO things beside the record can still be wedged. **The workflow document** this session is anchored to may be gone — a deleted and re-created worktree loses it, because `.zensu/state/` is gitignored — and while it is, the capability gate denies every tool in the session. **The lease store** is the second: an adoption writes the record first and sweeps the store afterwards, so a run that died in between leaves exactly that state. The report below the remedy says which of the two applies. Re-running with `--confirm` repairs both, idempotently, and re-mints nothing. If tools still fail after that, run `/zensu-doctor`. |
| `not-a-sibling-installation` | The executing tree is not an upgrade of the recorded one (for example a `--plugin-dir` checkout). |
| `executing-runtime-unidentified` | The executing installation declares no usable version. |
| `executing-runtime-older` | The executing installation is OLDER. Only forwards is ever allowed. |
| `workflow-schema-mismatch` | The workflow document cannot be read by this runtime — the case adoption must refuse. |

A gate's deny after an AUTOMATIC adoption that did not bind the session carries one
of the reasons above, or one of these entry-level tokens, which are not
`adoptableRecord` verdicts. The deny's own verb tells the two kinds apart: a record
that was judged reads `it was REFUSED: <token>`, a ladder that never reached a
verdict reads `it did not complete: <token>`.
`opted-out` (`hooks.sessionAutoAdopt: false` — the operator switched the automatic
path off on purpose; report it and ask the user whether to run the `--confirm` form,
which ignores the opt-out, and never run it on your own initiative),
`adopted-concurrently` (a sibling hook won the race and the record serves now; retry
the call), `not-completed`, `lock-timeout` and `adoption-failed` (the adoption did
not finish; retry, then run the report — the last two appear only in the all-tool
gate's deny, which sees the adoption's own error where the shell gates see a
preview), `superseded-record-exists` (an interrupted adoption left
`<session-key>.superseded-<version>.json` in place; the report names it in BOTH forms —
see the table row above — and moving it aside lets the adoption complete; a retry
alone is a loop), and `(unknown)` when
the binder could not answer at all. A refusal that establishes no named state —
`record-unreadable`, `plugin-data-mismatch` — rides on the generic bind-failure deny
as one appended sentence rather than on the lineage or pruned wording.

A deny can also follow an automatic adoption that DID land on the same call — the
workflow document was missing, or the tool is one the principal may not use. The cause
still leads, and the deny then says `This call also adopted the Session Control record
(<recorded> -> <executing>)`. That is a completed adoption to report, not a refusal to
repair: answer the cause the deny names — for a missing workflow document that is its
own `--confirm` rebuild, which needs the user's yes as Step 2 below states — and never
run `--confirm` to repeat the adoption. `/zensu-doctor` shows the adoption afterwards
when a workflow document recorded it.

**Step 2 of 3 — adopt.** The same adoption runs automatically on every hook bind, so
this form exists for a refusal and for the opt-out — and `--confirm` is a token you
supply yourself, not a consent the user gave. TWO of its uses therefore need the
user's explicit yes BEFORE you run it, and you wait for that answer: when the report
answered `already-served` and its `workflow baseline` line reads MISSING, `--confirm`
REBUILDS the document and the review chain that was live when it vanished is lost —
say so, in the user's language, and wait; and when a gate's deny or the Stop release
named `opted-out`, the operator switched the automatic path off — report that and
wait. The report itself never names `opted-out`, and neither does the `/zensu-doctor`
row, which cannot tell the three cases apart: the report shows such
a record as ADOPTABLE, because the opt-out governs the automatic path only. Do NOT
read an ADOPTABLE report in a session whose tools are denied as the signature of the
opt-out, though: an adoption that did not complete (`not-completed`, `lock-timeout`,
`adoption-failed`) reads ADOPTABLE too, and there `--confirm` needs no one's yes. The
TOKEN in the gate's deny or in the Stop release is what tells the two apart — when you
have no token, ask rather than assume. For
every other refusal, and for the idempotent lease-store repair on an `already-served`
record whose baseline is present, run it directly. Tell the user, in their language,
what it does — both versions, and the one consequence that is not obvious: any
review-evidence lease from before the update has to be re-gathered — then run it:

```bash
{session-helper} --helper session-adopt -- --confirm
```

Render the output verbatim. FIVE things are NOT clean states and must be
surfaced rather than summarized away:

- a `workflow baseline` value other than `present`, `rebuilt` or `already present` — and any
  `WARNING:` line about the workflow document. `rebuilt` is a real repair and
  still carries a cost the user has to hear: the chain that was live when the
  document vanished is gone. Anything else means the document was NOT repaired,
  and the cause named in the report has to be cleared before re-running;
- a `provenance` of anything but `recorded` means the takeover happened but was
  not written into the history. `no-workflow-document` is NOT a clean value: it
  means the session has no workflow document at all, so the capability gate keeps
  denying every tool until a `--confirm` run rebuilds it;
- a non-zero `leases set aside` means evidence reservations were dropped and
  have to be gathered again;
- a non-zero `leases stuck` is the serious one — those entries could NOT be moved
  out of the records directory, and because every lease read validates the whole
  set, review-evidence operations keep failing for this session until they are
  moved by hand. Do NOT assert why: an entry lands there when the move collided
  with a file already set aside, when the link or the unlink half failed, or on an
  ordinary I/O error. Relay the rendered warning, which names the collision case
  first. The adoption itself is complete; say both things;
- any `WARNING:` line about the review-evidence lease store. Report it verbatim
  and tell the user to look at the named directory before running the adoption
  again — never fold it into a summary. Do NOT assert a cause: the same verdict is
  produced by an entry that is not a plain directory they own, which would be a
  tamper signal, and by an ordinary I/O failure such as a full or read-only store.
  The command cannot tell those apart, so neither can you.

Exit codes: `0` on a successful report, adoption, or in-place repair — the
in-place repair is a third exit-0 shape and prints `ALREADY SERVED (...)` rather
than `ADOPTED`. It has TWO halves and EITHER one failing exits `1`: a workflow
baseline that could not be judged or rebuilt, or a sweep that was refused or left
leases stuck. A rebuilt baseline does not launder a stuck lease, and a clean sweep
does not launder a refused rebuild. `1` on a refusal or a precondition failure,
`2` on a bad argument. A non-zero exit is not a broken command — read the message.

**Step 3 of 3 — confirm the repair.** Re-run `/zensu-doctor` and report the binding
row, and read it before you describe the outcome. When the recorded project root still
exists the session is bound from the next tool call onward — do not tell the user to
restart. When it is GONE the doctor renders the ❌ orphaned-project-root row instead, and
that is the expected result rather than a failed repair: the lineage break is cleared,
Bash and the read-only diagnostics work again, and native file-write/edit tools stay denied, and so does any Bash
command that WRITES while the opt-in source-write gate is on (`hooks.bashWriteGate: true`), until that exact directory is re-created. Say which of the two happened; never report the second as an
unqualified success.

## Invocation Constraints

Both forms are recognized by the PreToolUse Bash gates only in their exact shape:
a whitelisted assignment prefix, `bash`, the script path in the executing
installation, and at most the literals `--restore-root` and `--confirm`, each at
most once and NEITHER taking a value. Anything else — a second
command, a different flag, a path, a copy of the script — is denied. Every PATH assignment in
that prefix must carry a rooted literal value; an empty one is refused, which is
one reason the form above passes only the variable the script actually reads.
Emit the command exactly as written above; do not wrap it, redirect it, or chain
anything onto it.

`--reanchor` runs a different script, `hooks/lib/zensu-session-reanchor.sh`, and the
bind-failure recognizer admits it in NO shape: it runs only in a session whose binding
works, where the ordinary Bash gates judge it like any other command. Its only argument
is `--confirm`, at most once.

