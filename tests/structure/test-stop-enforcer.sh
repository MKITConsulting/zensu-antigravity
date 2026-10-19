#!/usr/bin/env bash
# Strict registry grading rejects absent, cancelled or unexpectedly skipped cases.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
. "$ROOT/tests/structure/lib-unit-registry.sh"
PASS=0; FAIL=0
check() {
  if [ "$2" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %s\n' "$2" "$1"
}
unit_check "test-stop-session-state.js" "$ROOT/tests/host/test-stop-session-state.js"
unit_check_done
printf 'Unit files: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
