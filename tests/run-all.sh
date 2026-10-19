#!/bin/bash
# Master test runner for the zensu-antigravity port.
#
#   (no arg)   DETERMINISTIC suites only — no network, no agy, no API spend:
#                - every tests/structure/test-*.sh
#                - evals/config-gate/run-eval.sh --self-check (~55 offline gate evals)
#                - evals/promptfoo/run-eval.sh (the offline capability proof suite)
#
# Exit 0 iff every selected suite passed. A "suite" = one script; it passes iff
# it exits 0. Per-script internal tallies are streamed; this runner tallies suites.
#
# The live suite is deliberately NOT here. `evals/promptfoo/live/run-live.sh` drives a
# real logged-in agy (one model call per scenario), so it cannot run in CI — but it is
# the only harness that can see the host, and three defects shipped while everything
# below was green. Run it by hand after touching anything host-facing.
# CI runs exactly this command.
set -u

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$TESTS_DIR/.." && pwd)"

node "$TESTS_DIR/prepare-runtime.js" "$ROOT" || exit 2

RESULTS_DIR="$TESTS_DIR/results"
mkdir -p "$RESULTS_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$RESULTS_DIR/run-all-$TIMESTAMP.txt"

PASS=0; FAIL=0
log() { printf "%s\n" "$1" | tee -a "$REPORT"; }

# Fixture suites own separate temporary roots. Bound their concurrency while
# retaining one ordered report; missing exit records are failures, never skips.
JOBS="${ZENSU_TEST_JOBS:-4}"
case "$JOBS" in [1-8]) ;; *) echo 'ZENSU_TEST_JOBS must be 1..8' >&2; exit 2 ;; esac
RUN_TMP="$(mktemp -d -t zensu-suite-batch-XXXXXX)" || exit 2
trap 'rm -rf "$RUN_TMP"' EXIT

# Run a script; suite PASS iff exit 0. Streams the script's own output indented.
report_suite() {
  local label="$1" rc="$2" out="$3"
  printf '%s\n' "$out" | sed 's/^/      /' | tee -a "$REPORT" >/dev/null
  if [ "$rc" -eq 0 ]; then
    PASS=$((PASS+1)); log "  PASS  $label"
  else
    FAIL=$((FAIL+1)); log "  FAIL  $label (exit $rc)"
    printf '%s\n' "$out" | sed 's/^/      /'
  fi
}
run_suite() {
  local label="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  report_suite "$label" "$rc" "$out"
}

log "════════════════════════════════════════════════════════════"
log "  zensu-antigravity — run-all  ($TIMESTAMP)"
log "  plugin v$(node -e 'process.stdout.write(require("'"$ROOT"'/plugin.json").version)' 2>/dev/null || echo '?')"
log "════════════════════════════════════════════════════════════"

# ── Deterministic: structure tests ───────────────────────────────────
log ""
log "▸ Structure tests (deterministic)"
FILES=(); PIDS=()
for t in "$TESTS_DIR"/structure/test-*.sh; do
  [ -f "$t" ] || continue
  FILES+=("$t")
done
# Claim the next available suite under a short private-directory lock. This
# keeps every worker occupied even when a canonical fixture suite is much slower
# than its neighbors; the report below remains ordered by filename.
printf '0\n' > "$RUN_TMP/next"
for ((worker=0; worker<JOBS; worker++)); do
  (
    while :; do
      attempts=0
      until mkdir "$RUN_TMP/claim" 2>/dev/null; do
        attempts=$((attempts+1))
        [ "$attempts" -le 500 ] || exit 125
        sleep 0.01
      done
      i="$(cat "$RUN_TMP/next")"
      printf '%s\n' "$((i+1))" > "$RUN_TMP/next"
      rmdir "$RUN_TMP/claim"
      [ "$i" -lt "${#FILES[@]}" ] || break
      bash "${FILES[$i]}" >"$RUN_TMP/$i.out" 2>&1
      printf '%s\n' "$?" >"$RUN_TMP/$i.rc.tmp"
      mv "$RUN_TMP/$i.rc.tmp" "$RUN_TMP/$i.rc"
    done
  ) &
  PIDS[$worker]=$!
done
for ((i=0; i<${#FILES[@]}; i++)); do
  while [ ! -f "$RUN_TMP/$i.rc" ]; do
    live=0
    for pid in "${PIDS[@]}"; do kill -0 "$pid" 2>/dev/null && live=1; done
    [ "$live" -eq 1 ] || break
    sleep 0.2
  done
  report_suite "structure/$(basename "${FILES[$i]}")" "$(cat "$RUN_TMP/$i.rc" 2>/dev/null || echo 125)" "$(cat "$RUN_TMP/$i.out" 2>/dev/null)"
done
for pid in "${PIDS[@]}"; do wait "$pid" || true; done

# ── Deterministic: config-gate offline evals ─────────────────────────
log ""
log "▸ Offline evals"
CG="$ROOT/evals/config-gate/run-eval.sh"
[ -f "$CG" ] && run_suite "evals/config-gate (--self-check)" bash "$CG" --self-check

PF="$ROOT/evals/promptfoo/run-eval.sh"
[ -f "$PF" ] && run_suite "evals/promptfoo (capability proof suite)" bash "$PF"

log ""
log "════════════════════════════════════════════════════════════"
log "  SUITES: $PASS passed / $FAIL failed"
log "  Report: $REPORT"
log "════════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ]
