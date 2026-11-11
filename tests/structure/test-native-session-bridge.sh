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
unit_check "native-agent-provenance.test.js" "$ROOT/tests/host/native-agent-provenance.test.js"
unit_check "native-self-review.test.js" "$ROOT/tests/host/native-self-review.test.js"
unit_check "native-reviewer-outcome.test.js" "$ROOT/tests/host/native-reviewer-outcome.test.js"
unit_check "test-native-agent-lifecycle.js" "$ROOT/tests/host/test-native-agent-lifecycle.js"
unit_check "test-native-agent-shim.js" "$ROOT/tests/host/test-native-agent-shim.js"
unit_check "test-native-review.js" "$ROOT/tests/host/test-native-review.js"
unit_check "test-native-spawn-allow.js" "$ROOT/tests/host/test-native-spawn-allow.js"
unit_check "test-native-rules-worker-probes.js" "$ROOT/tests/host/test-native-rules-worker-probes.js"
unit_check "test-review-worker.js" "$ROOT/tests/host/test-review-worker.js"
unit_check "test-session-adapter.js" "$ROOT/tests/host/test-session-adapter.js"
unit_check "test-native-doctor.js" "$ROOT/tests/host/test-native-doctor.js"
unit_check_done
printf 'Unit files: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
