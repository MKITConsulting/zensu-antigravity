#!/bin/bash
set -u

# hooks/lib/zensu-autopilot-state.sh — the durable orchestration state that lets
# an /zensu-autopilot run survive across sessions.
#
# The four properties that matter, and why:
#   1. the document lands under the SESSION state dir (one place for a project's
#      zensu runtime state; a resumed session finds it where it looks)
#   2. round-trips (what a stage/artifact write claims is what the next session
#      reads back — otherwise "resume" reopens a second PR)
#   3. FAILS OPEN on corruption (bookkeeping must never halt an approved build)
#   4. concurrent writers do not interleave (a lost stage write is a repeated
#      irreversible step)

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$PLUGIN_DIR/hooks/lib/zensu-autopilot-state.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

[ -f "$LIB" ] || { check "A0 hooks/lib/zensu-autopilot-state.sh exists" FAIL; echo "----"; echo "test-autopilot-state: $PASS PASS / $FAIL FAIL"; exit 1; }
check "A0 lib exists" PASS
bash -n "$LIB" 2>/dev/null && check "A1 bash -n syntax check passes" PASS || check "A1 bash -n syntax check passes" FAIL

export ZENSU_PLUGIN_ROOT="$PLUGIN_DIR"
TMP="$(mktemp -d)"; export TDD_STATE_DIR="$TMP/state"
export HOME="$TMP/home"; mkdir -p "$HOME"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ap() { bash "$LIB" "$@" 2>/dev/null; }
field() { printf '%s' "$1" | cut -f"$2"; }
jq_node() { node -e '
  try { const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        const p = process.argv[2].split("."); let v = j;
        for (const k of p) v = v == null ? v : v[k];
        process.stdout.write(v === undefined || v === null ? "" : String(v)); }
  catch (_) { process.stdout.write("ERR"); }' "$1" "$2" 2>/dev/null; }

SID="ap-state"
SF="$TDD_STATE_DIR/autopilot-${SID}.json"

# --- 1) state file lands under the session state dir ------------------------
RESOLVED="$(ap file --session "$SID")"
[ "$RESOLVED" = "$SF" ] && check "A2 state file resolves under the session state dir" PASS || check "A2 resolved='$RESOLVED' want='$SF'" FAIL

RUN_ID="$(ap begin --session "$SID" --feature "checkout redesign" --base main)"
[ -f "$SF" ] && check "A3 begin creates the document on disk" PASS || check "A3 no document created" FAIL
printf '%s' "$RUN_ID" | grep -qE '^ap-[0-9]{8}-[0-9]{6}-[0-9]+$' && check "A4 begin echoes a well-formed run id" PASS || check "A4 run id '$RUN_ID'" FAIL
[ "$(jq_node "$SF" schema)" = "zensu-autopilot-state/1" ] && check "A5 document carries its schema marker" PASS || check "A5 schema marker" FAIL

# The document must NOT leak into the project root when the state dir is set.
[ -f "$PLUGIN_DIR/autopilot-${SID}.json" ] && check "A6 no stray state file beside the plugin" FAIL || check "A6 no stray state file beside the plugin" PASS

# --- 2) round-trip read/write ----------------------------------------------
LINE="$(ap status --session "$SID")"
[ "$(field "$LINE" 1)" = "$RUN_ID" ] && check "A7 status round-trips the run id" PASS || check "A7 status run id" FAIL
[ "$(field "$LINE" 2)" = "PLANNING" ] && check "A8 a fresh run starts in PLANNING" PASS || check "A8 initial stage" FAIL
[ "$(field "$LINE" 3)" = "$SID" ] && check "A9 status round-trips the owning session" PASS || check "A9 owner session" FAIL
[ "$(field "$LINE" 4)" = "checkout redesign" ] && check "A10 status round-trips the feature" PASS || check "A10 feature" FAIL

ap event --session "$SID" --stage IMPLEMENTING --note "tdd handed the spec" >/dev/null \
  && check "A11 event advances the stage" PASS || check "A11 event rc" FAIL
[ "$(ap stage --session "$SID")" = "IMPLEMENTING" ] && check "A12 the advanced stage reads back" PASS || check "A12 stage read-back" FAIL

ap artifact --session "$SID" --key prUrl --value "https://forge.test/pr/7" >/dev/null \
  && check "A13 artifact write succeeds" PASS || check "A13 artifact rc" FAIL
[ "$(field "$(ap status --session "$SID")" 5)" = "https://forge.test/pr/7" ] \
  && check "A14 the PR url round-trips (resume must not open a second PR)" PASS || check "A14 prUrl round-trip" FAIL

ap requirements --session "$SID" --ids "AC-002,AC-001,FR-010,not-an-id" >/dev/null \
  && check "A15 requirements write succeeds" PASS || check "A15 requirements rc" FAIL
REQS="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.requirements.join(","))' "$SF" 2>/dev/null)"
[ "$REQS" = "AC-001,AC-002,FR-010" ] && check "A16 requirement ids are kept, sorted, and non-ids dropped" PASS || check "A16 requirements='$REQS'" FAIL
ap requirements --session "$SID" --ids "AC-001,AC-003" >/dev/null
REQS="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.requirements.join(","))' "$SF" 2>/dev/null)"
[ "$REQS" = "AC-001,AC-002,AC-003,FR-010" ] && check "A17 requirement ids are additive, never renumbered" PASS || check "A17 additive requirements='$REQS'" FAIL

# The event trail is append-only.
EVENTS="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.events.length))' "$SF" 2>/dev/null)"
[ "$EVENTS" = "2" ] && check "A18 event trail appends (create + 1 transition)" PASS || check "A18 event count=$EVENTS" FAIL

# begin on an existing valid run resumes it instead of clobbering it.
SAME="$(ap begin --session "$SID" --feature "something else")"
[ "$SAME" = "$RUN_ID" ] && check "A19 begin resumes an existing run (no clobber)" PASS || check "A19 begin resumed '$SAME'" FAIL
[ "$(ap stage --session "$SID")" = "IMPLEMENTING" ] && check "A20 resuming preserves the current stage" PASS || check "A20 stage after resume" FAIL

# Unknown stages and terminal runs are refused.
ap event --session "$SID" --stage NOT_A_STAGE >/dev/null && check "A21 unknown stage refused" FAIL || check "A21 unknown stage refused" PASS
ap event --session "$SID" --stage DONE --note delivered >/dev/null
ap event --session "$SID" --stage VALIDATE >/dev/null && check "A22 a DONE run refuses further transitions" FAIL || check "A22 a DONE run refuses further transitions" PASS

# --- 3) corrupt state fails open -------------------------------------------
SID="ap-corrupt"; CF="$TDD_STATE_DIR/autopilot-${SID}.json"
ap begin --session "$SID" --feature broken >/dev/null
printf '%s' '{"runId": "ap-1", "stage": ' > "$CF"      # truncated mid-write
OUT="$(ap status --session "$SID")"; RC=$?
{ [ "$RC" -ne 0 ] && [ -z "$OUT" ]; } && check "A23 corrupt document: status reports no run (rc!=0, silent)" PASS || check "A23 corrupt status rc=$RC out='$OUT'" FAIL
ap show --session "$SID" >/dev/null 2>&1 && check "A24 corrupt document: show refuses to emit garbage" FAIL || check "A24 corrupt document: show refuses to emit garbage" PASS
ap event --session "$SID" --stage GATES >/dev/null 2>&1 && check "A25 corrupt document: event refuses (caller falls back)" FAIL || check "A25 corrupt document: event refuses (caller falls back)" PASS
grep -qF '"runId": "ap-1", "stage": ' "$CF" 2>/dev/null && check "A26 corrupt document is left intact for forensics" PASS || check "A26 corrupt document mutated" FAIL

# A fresh begin recovers: the corrupt document is quarantined, not overwritten.
NEW_ID="$(ap begin --session "$SID" --feature recovered)"
printf '%s' "$NEW_ID" | grep -qE '^ap-' && check "A27 begin recovers from a corrupt document" PASS || check "A27 recovery run id '$NEW_ID'" FAIL
ls "$TDD_STATE_DIR" 2>/dev/null | grep -q "autopilot-${SID}.json.corrupt." && check "A28 the corrupt document is quarantined, not destroyed" PASS || check "A28 no quarantine copy" FAIL
[ "$(ap stage --session "$SID")" = "PLANNING" ] && check "A29 the recovered run is usable again" PASS || check "A29 recovered stage" FAIL

# A missing document is simply "no durable run" — never an error the skill must handle.
OUT="$(ap status --session "never-started")"; RC=$?
{ [ "$RC" -ne 0 ] && [ -z "$OUT" ]; } && check "A30 absent run: silent no-run answer" PASS || check "A30 absent run rc=$RC out='$OUT'" FAIL

# Symlinked state is refused rather than written through.
SID="ap-symlink"; LF="$TDD_STATE_DIR/autopilot-${SID}.json"
mkdir -p "$TDD_STATE_DIR"; printf '%s' 'victim' > "$TMP/victim.json"; ln -s "$TMP/victim.json" "$LF"
ap begin --session "$SID" --feature evil >/dev/null 2>&1 && check "A31 refuses to write through a symlinked state file" FAIL || check "A31 refuses to write through a symlinked state file" PASS
[ "$(cat "$TMP/victim.json")" = "victim" ] && check "A32 symlink target untouched" PASS || check "A32 symlink target was written" FAIL

# --- 4) concurrent writers do not interleave --------------------------------
SID="ap-concurrent"; CSF="$TDD_STATE_DIR/autopilot-${SID}.json"
ap begin --session "$SID" --feature "fan out" >/dev/null
WRITERS=12
for i in $(seq 1 "$WRITERS"); do
  ap event --session "$SID" --stage GATES --note "writer-$i" >/dev/null &
done
wait
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$CSF" 2>/dev/null \
  && check "A33 document still parses after $WRITERS concurrent writers" PASS || check "A33 document corrupted by concurrency" FAIL
SEEN="$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const n = j.events.map(e => e.note).filter(x => /^writer-[0-9]+$/.test(x));
  process.stdout.write(String(new Set(n).size));' "$CSF" 2>/dev/null)"
[ "$SEEN" = "$WRITERS" ] && check "A34 every concurrent write landed (no lost update)" PASS || check "A34 only $SEEN/$WRITERS writes landed" FAIL
DUPES="$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const n = j.events.map(e => e.note).filter(x => /^writer-[0-9]+$/.test(x));
  process.stdout.write(String(n.length - new Set(n).size));' "$CSF" 2>/dev/null)"
[ "$DUPES" = "0" ] && check "A35 no write was recorded twice" PASS || check "A35 $DUPES duplicated writes" FAIL
find "$TDD_STATE_DIR" -maxdepth 1 -name "autopilot-${SID}.json.*" 2>/dev/null | grep -q . \
  && check "A36 no lock or temp residue left behind" FAIL || check "A36 no lock or temp residue left behind" PASS

# --- 5) retire ---------------------------------------------------------------
ap clear --session "$SID" >/dev/null
[ -f "$CSF" ] && check "A37 clear retires the run" FAIL || check "A37 clear retires the run" PASS

echo "----"
echo "test-autopilot-state: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
