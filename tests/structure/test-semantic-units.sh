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
unit_check "aspect-activation-v1.test.js" "$ROOT/tests/structure/aspect-activation-v1.test.js"
unit_check "evidence-run-v1.test.js" "$ROOT/tests/structure/evidence-run-v1.test.js"
unit_check "external-review-v1.test.js" "$ROOT/tests/structure/external-review-v1.test.js"
unit_check "finding-verify-v1.test.js" "$ROOT/tests/structure/finding-verify-v1.test.js"
unit_check "fixture-mutation-watch.test.js" "$ROOT/tests/structure/fixture-mutation-watch.test.js"
unit_check "full-suite-ci-v1.test.js" "$ROOT/tests/structure/full-suite-ci-v1.test.js"
unit_check "owned-process.test.js" "$ROOT/tests/structure/owned-process.test.js"
unit_check "plan-payload-v1.test.js" "$ROOT/tests/structure/plan-payload-v1.test.js"
unit_check "playwright-cli-version-v1.test.js" "$ROOT/tests/structure/playwright-cli-version-v1.test.js"
unit_check "plugin-data-guard-v1.test.js" "$ROOT/tests/structure/plugin-data-guard-v1.test.js"
unit_check "process-supervisor.test.js" "$ROOT/tests/structure/process-supervisor.test.js"
unit_check "prompt-listing-v1.test.js" "$ROOT/tests/structure/prompt-listing-v1.test.js"
unit_check "review-round-scope-v1.test.js" "$ROOT/tests/structure/review-round-scope-v1.test.js"
unit_check "rule-block-v1.test.js" "$ROOT/tests/structure/rule-block-v1.test.js"
unit_check "session-adopt-report-v1.test.js" "$ROOT/tests/structure/session-adopt-report-v1.test.js"
unit_check "session-auto-adopt-v1.test.js" "$ROOT/tests/structure/session-auto-adopt-v1.test.js"
unit_check "session-control-lineage.test.js" "$ROOT/tests/structure/session-control-lineage.test.js"
unit_check "subagent-shell-guard-v1.test.js" "$ROOT/tests/structure/subagent-shell-guard-v1.test.js"
unit_check "verify-browser-config.test.js" "$ROOT/tests/structure/verify-browser-config.test.js"
unit_check "verify-consent-v1.test.js" "$ROOT/tests/structure/verify-consent-v1.test.js"
unit_check "verify-free-port.test.js" "$ROOT/tests/structure/verify-free-port.test.js"
unit_check "verify-navigation-floor-v1.test.js" "$ROOT/tests/structure/verify-navigation-floor-v1.test.js"
unit_check "zensu-doctor-invocation.test.js" "$ROOT/tests/structure/zensu-doctor-invocation.test.js"
unit_check_done
printf 'Unit files: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
