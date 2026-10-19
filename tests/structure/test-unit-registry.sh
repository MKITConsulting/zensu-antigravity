#!/usr/bin/env bash
# Run the registry's negative controls and enforce full repository coverage in CI.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
. "$ROOT/tests/structure/lib-unit-registry.sh"
PASS=0; FAIL=0
check() {
  if [ "$2" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %s\n' "$2" "$1"
}
unit_check "Registry behavioral controls" "$ROOT/tests/structure/unit-registry.test.js"
for operation in census drivers; do
  if node "$ROOT/tests/structure/lib-unit-registry.js" "$operation"; then check "$operation" PASS; else check "$operation" FAIL; fi
done
if node "$ROOT/tests/structure/lib-unit-registry.js" render --check; then check "generated overview" PASS; else check "generated overview" FAIL; fi
unit_check_done
printf 'Registry gate: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
