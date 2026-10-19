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
unit_check "prompt-listing-v1.test.js" "$ROOT/tests/structure/prompt-listing-v1.test.js"
unit_check "native-review-artifacts.test.js" "$ROOT/tests/structure/native-review-artifacts.test.js"
unit_check "native-skill-content.test.js" "$ROOT/tests/structure/native-skill-content.test.js"
unit_check "native-worker-witness.test.js" "$ROOT/tests/structure/native-worker-witness.test.js"
unit_check_done
printf 'Unit files: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]

PYTHONDONTWRITEBYTECODE=1 python3 "$ROOT/tests/fixtures/native-workflow/test_python_workflow.py" || exit 1
PYTHONDONTWRITEBYTECODE=1 python3 "$ROOT/tests/fixtures/native-workflow/compare_parity.py" "$ROOT/templates/workflows/zensu-review-v1.js" || exit 1
