#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
. "$ROOT/tests/structure/lib-unit-registry.sh"
PASS=0; FAIL=0
check() {
  if [ "$2" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %s\n' "$2" "$1"
}
unit_check "Durable work capture" "$ROOT/tests/structure/ai-work-capture.test.js"
unit_check "Native capture binding" "$ROOT/tests/structure/ai-work-native.test.js"
unit_check_done
[ "$FAIL" -eq 0 ]
