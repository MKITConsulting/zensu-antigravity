#!/bin/bash
# Master test runner for the zensu-antigravity port.
#
#   (no arg)   DETERMINISTIC suites only — no network, no agy, no API spend:
#                - every tests/structure/test-*.sh
#                - evals/config-gate/run-eval.sh --self-check (~55 offline gate evals)
#
# Exit 0 iff every selected suite passed. A "suite" = one script; it passes iff
# it exits 0. Per-script internal tallies are streamed; this runner tallies suites.
#
# No --live block for v1: there is no verified headless `agy` invocation, so all
# live-agent e2e is deferred (see the verification register / fidelity matrix).
# CI runs exactly this command.
set -u

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$TESTS_DIR/.." && pwd)"

RESULTS_DIR="$TESTS_DIR/results"
mkdir -p "$RESULTS_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$RESULTS_DIR/run-all-$TIMESTAMP.txt"

PASS=0; FAIL=0
log() { printf "%s\n" "$1" | tee -a "$REPORT"; }

# Run a script; suite PASS iff exit 0. Streams the script's own output indented.
run_suite() {
  local label="$1"; shift
  local out
  out="$("$@" 2>&1)"
  local rc=$?
  printf '%s\n' "$out" | sed 's/^/      /' | tee -a "$REPORT" >/dev/null
  if [ "$rc" -eq 0 ]; then
    PASS=$((PASS+1)); log "  PASS  $label"
  else
    FAIL=$((FAIL+1)); log "  FAIL  $label (exit $rc)"
    printf '%s\n' "$out" | sed 's/^/      /'
  fi
}

log "════════════════════════════════════════════════════════════"
log "  zensu-antigravity — run-all  ($TIMESTAMP)"
log "  plugin v$(node -e 'process.stdout.write(require("'"$ROOT"'/plugin.json").version)' 2>/dev/null || echo '?')"
log "════════════════════════════════════════════════════════════"

# ── Deterministic: structure tests ───────────────────────────────────
log ""
log "▸ Structure tests (deterministic)"
for t in "$TESTS_DIR"/structure/test-*.sh; do
  [ -f "$t" ] || continue
  run_suite "structure/$(basename "$t")" bash "$t"
done

# ── Deterministic: config-gate offline evals ─────────────────────────
log ""
log "▸ Offline evals"
CG="$ROOT/evals/config-gate/run-eval.sh"
[ -f "$CG" ] && run_suite "evals/config-gate (--self-check)" bash "$CG" --self-check

log ""
log "════════════════════════════════════════════════════════════"
log "  SUITES: $PASS passed / $FAIL failed"
log "  Report: $REPORT"
log "════════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ]
