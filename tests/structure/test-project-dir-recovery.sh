#!/bin/bash
# Project-dir recovery for NON-HOOK state verbs.
#
# Antigravity exports ZENSU_PROJECT_DIR to HOOKS only (the shim derives it from
# the tool payload's workspace root). A state writer launched through the shell
# tool — `bash .../hooks/lib/zensu-log.sh --chain-done|--tdd-*|--phase|…` —
# inherits nothing, so `${ZENSU_PROJECT_DIR:-.}` used to resolve to the
# terminal's cwd. From a subdirectory or a worktree that anchors chain state to
# the WRONG directory and the Stop-hook enforcer deadlocks waiting on a flag
# written somewhere else.
#
# The fix is a cwd-independent resolver at one choke point (zensu-log.sh),
# reusing this plugin's own session pointer (.zensu/state/session-id-current.txt,
# written by the lazy-init hook) rather than any transcript.
#
# The worktree case is exercised through the on-disk signature of a linked git
# worktree (a `.git` FILE carrying a `gitdir:` line) so the suite stays
# deterministic and runs no VCS commands — the resolver is git-free by design.
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RESOLVER="$PLUGIN_DIR/hooks/lib/resolve-project-dir.js"
SESSION_LIB="$PLUGIN_DIR/hooks/lib/zensu-session.sh"
LOG="$PLUGIN_DIR/hooks/lib/zensu-log.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$RESOLVER" ]; then
  check "hooks/lib/resolve-project-dir.js exists" FAIL
  echo "----"; echo "test-project-dir-recovery: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "P1 resolver exists" PASS

if ! command -v node >/dev/null 2>&1; then
  check "node required for the recovery suite" FAIL
  echo "----"; echo "test-project-dir-recovery: $PASS PASS / $FAIL FAIL"; exit 1
fi

node --check "$RESOLVER" 2>/dev/null \
  && check "P2 node --check syntax check passes" PASS \
  || check "P2 node --check syntax check passes" FAIL

grep -qF 'zensu_resolve_project_dir' "$SESSION_LIB" \
  && check "P3 zensu-session.sh exposes zensu_resolve_project_dir" PASS \
  || check "P3 zensu-session.sh exposes zensu_resolve_project_dir" FAIL

grep -qF 'zensu_resolve_project_dir' "$LOG" \
  && check "P4 zensu-log.sh recovers the project dir at one choke point" PASS \
  || check "P4 zensu-log.sh recovers the project dir at one choke point" FAIL

TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
CFG="$TMP/config.json"; printf '%s' '{"hooks":{}}' > "$CFG"
SID="recovery-sid"

# The project as the hooks would have left it: session pointer written by
# lazy-init into the real workspace root.
ROOT="$TMP/workspace"
mkdir -p "$ROOT/.zensu/state" "$ROOT/packages/api/src"
printf '%s\n' "$SID" > "$ROOT/.zensu/state/session-id-current.txt"

# A LINKED WORKTREE nested under the workspace: its `.git` is a file, not a dir.
WT="$ROOT/.zensu/worktrees/feature-x"
mkdir -p "$WT/src"
printf 'gitdir: %s/.git/worktrees/feature-x\n' "$ROOT" > "$WT/.git"

resolve_at() { ( cd "$1" && node "$RESOLVER" ); }

# --- P5: ZENSU_PROJECT_DIR set wins, unchanged -------------------------------
OUT="$( cd "$ROOT/packages/api" && ZENSU_PROJECT_DIR="/declared/project/dir" node "$RESOLVER" )"
[ "$OUT" = "/declared/project/dir" ] \
  && check "P5 declared ZENSU_PROJECT_DIR wins unchanged (no behavior change)" PASS \
  || check "P5 declared ZENSU_PROJECT_DIR wins (got '$OUT')" FAIL

# --- P6: unset + valid pointer recovers the right dir ------------------------
OUT="$(resolve_at "$ROOT")"
[ "$OUT" = "$ROOT" ] \
  && check "P6 unset + valid pointer recovers the project dir" PASS \
  || check "P6 unset + valid pointer (got '$OUT' want '$ROOT')" FAIL

# --- P7: from a subdirectory -> the same dir as from the root ----------------
SUB="$(resolve_at "$ROOT/packages/api/src")"
[ "$SUB" = "$OUT" ] \
  && check "P7 subdirectory resolves the same dir as the root" PASS \
  || check "P7 subdirectory (got '$SUB' want '$OUT')" FAIL

# --- P8: from a git worktree -> the same dir as from the root ----------------
WTO="$(resolve_at "$WT")"
[ "$WTO" = "$OUT" ] \
  && check "P8 git worktree resolves the same dir as the root" PASS \
  || check "P8 git worktree (got '$WTO' want '$OUT')" FAIL
WTS="$(resolve_at "$WT/src")"
[ "$WTS" = "$OUT" ] \
  && check "P8b subdirectory inside the worktree resolves the same dir" PASS \
  || check "P8b worktree subdir (got '$WTS' want '$OUT')" FAIL

# --- P9: nearest ancestor wins — an own armed project keeps its own state ----
OWN="$TMP/other-project"
mkdir -p "$OWN/.zensu/state" "$OWN/deep"
printf 'other-sid\n' > "$OWN/.zensu/state/session-id-current.txt"
[ "$(resolve_at "$OWN/deep")" = "$OWN" ] \
  && check "P9 nearest ancestor wins (a sibling project keeps its own dir)" PASS \
  || check "P9 nearest ancestor wins (got '$(resolve_at "$OWN/deep")')" FAIL

# --- P10: pointer absent but a seeded state dir present ---------------------
SEEDED="$TMP/seeded"
mkdir -p "$SEEDED/.zensu/state" "$SEEDED/nested/deep"
[ "$(resolve_at "$SEEDED/nested/deep")" = "$SEEDED" ] \
  && check "P10 seeded .zensu/state (no pointer yet) still recovers the dir" PASS \
  || check "P10 seeded state dir (got '$(resolve_at "$SEEDED/nested/deep")')" FAIL

# --- P11: unset + no pointer degrades gracefully ----------------------------
BARE="$TMP/bare/deep"
mkdir -p "$BARE"
OUT="$(resolve_at "$BARE")"; RC=$?
if [ "$RC" -eq 0 ] && [ -n "$OUT" ] && [ -d "$OUT" ]; then
  case "$BARE" in
    "$OUT"*) check "P11 no pointer anywhere degrades gracefully (exit 0, usable dir)" PASS ;;
    *) check "P11 no pointer degrades gracefully (got '$OUT' outside '$BARE')" FAIL ;;
  esac
else
  check "P11 no pointer degrades gracefully (rc=$RC out='$OUT')" FAIL
fi

# --- P12: the shell wrapper agrees with the resolver ------------------------
WRAP="$( cd "$ROOT/packages/api/src" && ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" bash -c \
  'source "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-session.sh"; zensu_resolve_project_dir' 2>/dev/null )"
[ "$WRAP" = "$ROOT" ] \
  && check "P12 zensu_resolve_project_dir agrees with the resolver" PASS \
  || check "P12 shell wrapper (got '$WRAP' want '$ROOT')" FAIL

WRAP="$( cd "$ROOT/packages/api/src" && ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="/declared/dir" bash -c \
  'source "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-session.sh"; zensu_resolve_project_dir' 2>/dev/null )"
[ "$WRAP" = "/declared/dir" ] \
  && check "P13 shell wrapper echoes a declared ZENSU_PROJECT_DIR unchanged" PASS \
  || check "P13 shell wrapper declared (got '$WRAP')" FAIL

# Node-free degradation: the pure-shell ancestor walk must reach the same dir.
if PATH=/usr/bin:/bin command -v node >/dev/null 2>&1; then
  check "P14 node-free fallback (skipped: node reachable from a minimal PATH)" PASS
else
  WRAP="$( cd "$ROOT/packages/api/src" && ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" PATH=/usr/bin:/bin bash -c \
    'source "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-session.sh"; zensu_resolve_project_dir' 2>/dev/null )"
  [ "$WRAP" = "$ROOT" ] \
    && check "P14 node-free fallback resolves the same dir" PASS \
    || check "P14 node-free fallback (got '$WRAP' want '$ROOT')" FAIL
fi

# --- P15..P18: end-to-end through the real state verbs ----------------------
state_file() { echo "$1/.zensu/state/tdd-phase-${SID}.json"; }
flag_of() {
  KEY="$2" node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(j[process.env.KEY] === true ? "true" : "false");
    } catch (_) { process.stdout.write("<no-state>"); }
  ' "$1" 2>/dev/null
}

# Arm from the deepest subdirectory, with NO env — the exact shell-tool shape.
( cd "$ROOT/packages/api/src" && ZENSU_CONFIG="$CFG" bash "$LOG" --tdd-begin >/dev/null 2>&1 )
[ -f "$(state_file "$ROOT")" ] \
  && check "P15 --tdd-begin from a subdirectory arms the ROOT state file" PASS \
  || check "P15 --tdd-begin from a subdirectory arms the ROOT state file" FAIL
[ ! -e "$ROOT/packages/api/src/.zensu" ] \
  && check "P16 no stray .zensu/ minted in the calling subdirectory" PASS \
  || check "P16 stray .zensu/ minted in the calling subdirectory" FAIL

# The chain-done write from the WORKTREE must land on the same ROOT state file
# the Stop-hook enforcer reads — this is the deadlock the fix removes.
( cd "$WT/src" && ZENSU_CONFIG="$CFG" bash "$LOG" --chain-done >/dev/null 2>&1 )
[ "$(flag_of "$(state_file "$ROOT")" chainDone)" = "true" ] \
  && check "P17 --chain-done from a worktree lands on the ROOT state file" PASS \
  || check "P17 --chain-done from a worktree (got '$(flag_of "$(state_file "$ROOT")" chainDone)')" FAIL
[ ! -e "$WT/.zensu" ] \
  && check "P18 no stray .zensu/ minted inside the worktree" PASS \
  || check "P18 stray .zensu/ minted inside the worktree" FAIL

# --- P19: a declared ZENSU_PROJECT_DIR still wins end-to-end ----------------
DECL="$TMP/declared"
mkdir -p "$DECL/.zensu/state"
printf '%s\n' "$SID" > "$DECL/.zensu/state/session-id-current.txt"
( cd "$ROOT/packages/api/src" && ZENSU_PROJECT_DIR="$DECL" ZENSU_CONFIG="$CFG" bash "$LOG" --tdd-begin >/dev/null 2>&1 )
[ -f "$(state_file "$DECL")" ] \
  && check "P19 declared ZENSU_PROJECT_DIR still wins end-to-end (hooks unchanged)" PASS \
  || check "P19 declared ZENSU_PROJECT_DIR still wins end-to-end" FAIL

echo "----"
echo "test-project-dir-recovery: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
