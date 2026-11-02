#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
. "$ROOT/tests/structure/lib-unit-registry.sh"
PASS=0; FAIL=0
check() {
  if [ "$2" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %s\n' "$2" "$1"
}
unit_check "edit-landing-scope-v1.test.js" "$ROOT/tests/structure/edit-landing-scope-v1.test.js"
unit_check "native-audit-session.test.js" "$ROOT/tests/host/native-audit-session.test.js"
unit_check "workflow-artifacts-v1.test.js" "$ROOT/tests/structure/workflow-artifacts-v1.test.js"
unit_check "workflow-guidance.test.js" "$ROOT/tests/structure/workflow-guidance.test.js"
unit_check_done
printf "Unit files: %s passed / %s failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
