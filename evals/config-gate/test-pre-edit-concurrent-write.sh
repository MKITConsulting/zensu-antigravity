#!/bin/bash
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$PLUGIN_DIR/hooks/lib/zensu-tdd-phase.sh"
CORE="$PLUGIN_DIR/hooks/lib/session-control-core-v1.js"
BASELINE="$PLUGIN_DIR/tests/session-control/initialize-baseline.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

WORK_DIR="$(mktemp -d)" || exit 1
[ -n "$WORK_DIR" ] || exit 1
WORK_DIR="$(cd "$WORK_DIR" && pwd -P)" || exit 1
export ZENSU_PROJECT_DIR="$WORK_DIR/project"
mkdir -p "$ZENSU_PROJECT_DIR" || exit 1
source "$LIB" || exit 1

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

state_path_for() {
  local session_id="$1" path
  path="$(tdd_state_file "$session_id")" || return 1
  # A failed or empty binding must never turn a lock fixture into .lockd in cwd.
  # Reject lexical traversal too, even when the path starts with the private root.
  case "$path" in
    *'/../'*|*'/./'*) return 1 ;;
  esac
  case "$path" in
    "$WORK_DIR"/*)
      [ -f "$path" ] && [ ! -L "$path" ] || return 1
      printf '%s\n' "$path" ;;
    *)
      printf 'unsafe Session Control state path for %s: %s\n' "$session_id" "${path:-<empty>}" >&2
      return 1
      ;;
  esac
}

SID="concurrent-1"
# shellcheck disable=SC1090
source "$BASELINE" "$SID" || exit 1
if ! STATE_PATH="$(state_path_for "$SID")"; then exit 1; fi
STATE_DIR="$(dirname "$STATE_PATH")"

# Exercise the refusal before any fixture writer appends .lockd. Each override is
# confined to its subshell; the real state resolver remains active for all cases.
for fixture_case in empty failed outside traversal; do
  if (
    case "$fixture_case" in
      empty) fixture_path=""; fixture_status=0 ;;
      failed) fixture_path="$STATE_PATH"; fixture_status=1 ;;
      outside) fixture_path="$PLUGIN_DIR/plugin.json"; fixture_status=0 ;;
      traversal) fixture_path="$WORK_DIR/../$(basename "$WORK_DIR")/project/.zensu/state/$(basename "$STATE_PATH")"; fixture_status=0 ;;
    esac
    tdd_state_file() { printf '%s\n' "$fixture_path"; return "$fixture_status"; }
    state_path_for "$SID" >"$WORK_DIR/rejected-state-path" 2>/dev/null
  ); then
    check "fixture state path rejects $fixture_case resolution before creating locks" FAIL
  else
    check "fixture state path rejects $fixture_case resolution before creating locks" PASS
  fi
done

N=10
PIDS=()
for i in $(seq 1 $N); do
  ( tdd_write_phase "$SID" "S$i" "RED_WRITE" "" >/dev/null ) &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done

if [ -f "$STATE_PATH" ]; then
  check "state file exists after concurrent writes" PASS
else
  check "state file exists after concurrent writes (missing!)" FAIL
fi

if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$STATE_PATH" 2>/dev/null; then
  check "state file is valid JSON after concurrent writes" PASS
else
  check "state file is valid JSON after concurrent writes" FAIL
fi

HISTORY_LEN=$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(Array.isArray(j.history) ? j.history.length : -1);
' "$STATE_PATH" 2>/dev/null)
if [ "$HISTORY_LEN" = "$N" ]; then
  check "history records ALL $N concurrent writes (got: $HISTORY_LEN)" PASS
else
  check "history records ALL $N concurrent writes (got: $HISTORY_LEN — last-writer-wins)" FAIL
fi

DISTINCT_STEPS=$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const steps = new Set((j.history || []).map(h => h.step));
  console.log(steps.size);
' "$STATE_PATH" 2>/dev/null)
if [ "$DISTINCT_STEPS" = "$N" ]; then
  check "history contains $N DISTINCT step IDs (no duplicates lost)" PASS
else
  check "history contains $N DISTINCT step IDs (got: $DISTINCT_STEPS)" FAIL
fi

SID_STALE="stale-lock-1"
# shellcheck disable=SC1090
source "$BASELINE" "$SID_STALE" || exit 1
if ! STATE_PATH_STALE="$(state_path_for "$SID_STALE")"; then exit 1; fi
mkdir -p "$(dirname "$STATE_PATH_STALE")" || exit 1
STALE_KEY="$(node "$CORE" session-key "$SID_STALE")"
LOCK_FILE="$STATE_DIR/.state-${STALE_KEY}.lock"
printf '%s\n' '{"pid":2147483647,"token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","created_at":"2000-01-01T00:00:00.000Z"}' > "$LOCK_FILE"
touch -t 200001010000 "$LOCK_FILE" 2>/dev/null || true

START_NS=$(node -e 'process.stdout.write(String(Date.now()))')
tdd_write_phase "$SID_STALE" "S1" "RED_WRITE" "" >/dev/null
END_NS=$(node -e 'process.stdout.write(String(Date.now()))')
ELAPSED_MS=$((END_NS - START_NS))

if [ -f "$STATE_PATH_STALE" ]; then
  check "Session Control stale-lock recovery: write succeeded" PASS
else
  check "Session Control stale-lock recovery: write succeeded (state file missing)" FAIL
fi

GOT_STALE_PHASE=$(tdd_phase "$STATE_PATH_STALE")
if [ "$GOT_STALE_PHASE" = "RED_WRITE" ]; then
  check "Session Control stale-lock recovery: phase RED_WRITE recorded" PASS
else
  check "Session Control stale-lock recovery: phase RED_WRITE recorded (got: $GOT_STALE_PHASE)" FAIL
fi

if [ "$ELAPSED_MS" -lt 5000 ] && [ ! -e "$LOCK_FILE" ]; then
  check "Session Control stale-lock recovery completed in <5s and released its generation" PASS
else
  check "Session Control stale-lock recovery completed cleanly (got ${ELAPSED_MS}ms)" FAIL
fi

SID_ENV="env-var-honored-1"
# shellcheck disable=SC1090
source "$BASELINE" "$SID_ENV" || exit 1
if ! STATE_PATH_ENV="$(state_path_for "$SID_ENV")"; then exit 1; fi
mkdir -p "$(dirname "$STATE_PATH_ENV")" || exit 1
LOCK_DIR_ENV="${STATE_PATH_ENV}.lockd"
mkdir "$LOCK_DIR_ENV" || exit 1
echo "99998" > "$LOCK_DIR_ENV/owner"
echo "sentinel" > "$LOCK_DIR_ENV/sentinel.txt"
touch -t 200001010000 "$LOCK_DIR_ENV" 2>/dev/null || true

TDD_DISABLE_FLOCK=1 tdd_write_phase "$SID_ENV" "S1" "RED_WRITE" "" >/dev/null

if [ -f "$STATE_PATH_ENV" ]; then
  check "TDD_DISABLE_FLOCK=1: state file exists after write" PASS
else
  check "TDD_DISABLE_FLOCK=1: state file exists after write (missing!)" FAIL
fi

if [ -f "$LOCK_DIR_ENV/sentinel.txt" ]; then
  check "TDD_DISABLE_FLOCK cannot select the removed shell mutex protocol" PASS
else
  check "TDD_DISABLE_FLOCK unexpectedly selected the removed shell mutex protocol" FAIL
fi

echo "----"
echo "test-pre-edit-concurrent-write: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
