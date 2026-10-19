#!/bin/bash
# Config-gate offline eval suite for zensu-antigravity: ~50+ pure-bash,
# engine-neutral, no-API tests covering the FULL-fidelity core — the TDD
# phase-gate allow/deny matrix, the log-style FSM, the auto-fix rounds counter,
# config deep-merge, the config helper, and plugin-root resolution. They depend
# only on the lib FSM and a flat snake_case hook payload — exactly what the
# antigravity-shim's normalize-payload.js produces.
#
# Antigravity registration lives in hooks.json.template; the shim executes the
# tracked neutral hooks/hooks.json inventory. First-use private bootstrap owns
# immutable conversation identity and dispatches the supported startup hooks.
#
#   (no arg)       full suite (structural + every offline test)
#   --self-check   same set, used by tests/run-all.sh; e2e .exp scripts skipped
set -u

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$EVAL_DIR/../.." && pwd)"
RESULTS_DIR="$EVAL_DIR/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT="$RESULTS_DIR/report-$TIMESTAMP.txt"
mkdir -p "$RESULTS_DIR"

MODE="${1:-full}"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL=0

check() {
  local label="$1" result="$2"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  PASS  $label" | tee -a "$REPORT"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL  $label" | tee -a "$REPORT"
  fi
}

run_test() {
  local script="$1"
  local label="$2"
  if [ -f "$script" ]; then
    if bash "$script" >/dev/null 2>&1; then
      check "$label" PASS
    else
      check "$label" FAIL
    fi
  else
    check "$label (missing)" FAIL
  fi
}

echo "=== Config-Gate Eval: $TIMESTAMP ($MODE) ===" | tee "$REPORT"
echo "Plugin dir: $PLUGIN_DIR" | tee -a "$REPORT"
cd "$PLUGIN_DIR"

echo "" | tee -a "$REPORT"
echo "▸ Structural checks" | tee -a "$REPORT"

# hooks.json.template is the TRACKED artifact (install.sh renders the real,
# gitignored hooks.json with absolute paths from it).
if node -e 'JSON.parse(require("fs").readFileSync("hooks.json.template","utf8"))' 2>/dev/null; then
  check "hooks.json.template is valid JSON" PASS
else
  check "hooks.json.template is valid JSON" FAIL
fi

if node -e 'JSON.parse(require("fs").readFileSync("config.example.json","utf8"))' 2>/dev/null; then
  check "config.example.json is valid JSON" PASS
else
  check "config.example.json is valid JSON" FAIL
fi

if [ -f "$PLUGIN_DIR/hooks/lib/zensu-config.sh" ]; then
  check "hooks/lib/zensu-config.sh exists" PASS
else
  check "hooks/lib/zensu-config.sh exists" FAIL
fi

if [ -f "$PLUGIN_DIR/hooks/antigravity/session-bootstrap.js" ] \
  && bash "$PLUGIN_DIR/hooks/antigravity/antigravity-shim.sh" --list-handlers startup-chain.sh Read \
     | grep -qx session-start-evidence-discipline.sh; then
  check "private bootstrap dispatches the supported startup chain" PASS
else
  check "private bootstrap dispatches the supported startup chain" FAIL
fi

# Every wrapped hook command in the template routes through the shim with a BARE
# script-name argument (BK1) — the shape the structure suite pins in full.
SHIM_OK="$(node -e '
  const t = JSON.parse(require("fs").readFileSync("hooks.json.template","utf8"));
  let total = 0, shimmed = 0;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.command === "string") {
        total++;
        if (/antigravity-shim\.sh\s+[^/ ]+\.sh/.test(o.command)) shimmed++;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(t);
  process.stdout.write((total > 0 && total === shimmed) ? "yes" : "no");
' 2>/dev/null)"
[ "$SHIM_OK" = "yes" ] && check "every hooks.json.template command is shim-wrapped" PASS || check "every hooks.json.template command is shim-wrapped" FAIL

echo "" | tee -a "$REPORT"
echo "▸ Helper offline tests" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-helper-missing.sh"     "test-helper-missing.sh"
run_test "$EVAL_DIR/test-helper-malformed.sh"   "test-helper-malformed.sh"
run_test "$EVAL_DIR/test-helper-keymissing.sh"  "test-helper-keymissing.sh"
run_test "$EVAL_DIR/test-helper-disabled.sh"    "test-helper-disabled.sh"
run_test "$EVAL_DIR/test-helper-envoverride.sh" "test-helper-envoverride.sh"
run_test "$EVAL_DIR/test-helper-no-node.sh"     "test-helper-no-node.sh"

echo "" | tee -a "$REPORT"
echo "▸ Log-style offline tests" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-log-style-wall.sh"     "test-log-style-wall.sh"
run_test "$EVAL_DIR/test-log-style-relative.sh" "test-log-style-relative.sh"
run_test "$EVAL_DIR/test-log-style-none.sh"     "test-log-style-none.sh"
run_test "$EVAL_DIR/test-log-style-fallback.sh" "test-log-style-fallback.sh"
run_test "$EVAL_DIR/test-log-style-no-node.sh"  "test-log-style-no-node.sh"
run_test "$EVAL_DIR/test-log-style-negative-delta.sh" "test-log-style-negative-delta.sh"
run_test "$EVAL_DIR/test-log-style-bad-epoch.sh"      "test-log-style-bad-epoch.sh"
run_test "$EVAL_DIR/test-log-style-long-delta.sh"     "test-log-style-long-delta.sh"
run_test "$EVAL_DIR/test-log-style-artifacts.sh"      "test-log-style-artifacts.sh"

echo "" | tee -a "$REPORT"
echo "▸ Hook gate offline tests" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-gate-plan.sh"        "test-gate-plan.sh"
run_test "$EVAL_DIR/test-gate-postreview.sh"  "test-gate-postreview.sh"
run_test "$EVAL_DIR/test-gate-session.sh"     "test-gate-session.sh"
run_test "$EVAL_DIR/test-isolation-preserved.sh" "test-isolation-preserved.sh"
run_test "$EVAL_DIR/test-no-pluginroot-env.sh"   "test-no-pluginroot-env.sh"
run_test "$EVAL_DIR/test-pluginroot-default-setu.sh" "test-pluginroot-default-setu.sh"

echo "" | tee -a "$REPORT"
echo "▸ Config deep-merge offline tests" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-config-merge.sh" "test-config-merge.sh"

echo "" | tee -a "$REPORT"
echo "▸ Auto-fix flag offline tests (Suggestions routing + loop guard)" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-helper-autofix-flags.sh"             "test-helper-autofix-flags.sh"
run_test "$EVAL_DIR/test-autofix-suggestions-on.sh"           "test-autofix-suggestions-on.sh"
run_test "$EVAL_DIR/test-autofix-suggestions-off.sh"          "test-autofix-suggestions-off.sh"
run_test "$EVAL_DIR/test-autofix-rounds-increment.sh"         "test-autofix-rounds-increment.sh"
run_test "$EVAL_DIR/test-autofix-rounds-convergence.sh"       "test-autofix-rounds-convergence.sh"
run_test "$EVAL_DIR/test-autofix-rounds-session-isolation.sh" "test-autofix-rounds-session-isolation.sh"
run_test "$EVAL_DIR/test-autofix-rounds-sanitize.sh"          "test-autofix-rounds-sanitize.sh"
run_test "$EVAL_DIR/test-autofix-rounds-reset-on-fresh-tdd.sh" "test-autofix-rounds-reset-on-fresh-tdd.sh"
run_test "$EVAL_DIR/test-rounds-default-location.sh"          "test-rounds-default-location.sh"
run_test "$EVAL_DIR/test-post-review-combined-summary.sh"     "test-post-review-combined-summary.sh"
run_test "$EVAL_DIR/test-review-convergence-directive.sh"      "test-review-convergence-directive.sh"

echo "" | tee -a "$REPORT"
echo "▸ Pre-Edit TDD-Gate offline tests" | tee -a "$REPORT"

run_test "$EVAL_DIR/test-pre-edit-lib-paths.sh"                "test-pre-edit-lib-paths.sh"
run_test "$EVAL_DIR/test-pre-edit-lib-state.sh"                "test-pre-edit-lib-state.sh"
run_test "$EVAL_DIR/test-pre-edit-isolation.sh"               "test-pre-edit-isolation.sh"
run_test "$EVAL_DIR/test-pre-edit-deny-uninitialized.sh"      "test-pre-edit-deny-uninitialized.sh"
run_test "$EVAL_DIR/test-pre-edit-allow-red-write.sh"         "test-pre-edit-allow-red-write.sh"
run_test "$EVAL_DIR/test-pre-edit-allow-redfail-test-only.sh" "test-pre-edit-allow-redfail-test-only.sh"
run_test "$EVAL_DIR/test-pre-edit-allow-impl-after-redfail.sh" "test-pre-edit-allow-impl-after-redfail.sh"
run_test "$EVAL_DIR/test-pre-edit-allow-refactor.sh"          "test-pre-edit-allow-refactor.sh"
run_test "$EVAL_DIR/test-pre-edit-deny-greenpass-production.sh" "test-pre-edit-deny-greenpass-production.sh"
run_test "$EVAL_DIR/test-pre-edit-override-env.sh"            "test-pre-edit-override-env.sh"
run_test "$EVAL_DIR/test-pre-edit-log-phase-subcmd.sh"        "test-pre-edit-log-phase-subcmd.sh"
run_test "$EVAL_DIR/test-pre-edit-toplevel-paths.sh"          "test-pre-edit-toplevel-paths.sh"
run_test "$EVAL_DIR/test-pre-edit-basename-boundary.sh"       "test-pre-edit-basename-boundary.sh"
run_test "$EVAL_DIR/test-pre-edit-symlink-reject.sh"          "test-pre-edit-symlink-reject.sh"
run_test "$EVAL_DIR/test-pre-edit-inline-header.sh"           "test-pre-edit-inline-header.sh"
run_test "$EVAL_DIR/test-pre-edit-concurrent-write.sh"        "test-pre-edit-concurrent-write.sh"
run_test "$EVAL_DIR/test-pre-edit-agent-trust.sh"             "test-pre-edit-agent-trust.sh"
run_test "$EVAL_DIR/test-pre-edit-greenpass-tight.sh"         "test-pre-edit-greenpass-tight.sh"
run_test "$EVAL_DIR/test-pre-edit-bash-bypass.sh"             "test-pre-edit-bash-bypass.sh"

echo "" | tee -a "$REPORT"
echo "▸ Documentation coverage tests" | tee -a "$REPORT"


if [ "$MODE" = "--self-check" ]; then
  echo "" | tee -a "$REPORT"
  echo "════════════════════════════════════════" | tee -a "$REPORT"
  echo "  SELF-CHECK: $PASS_COUNT/$TOTAL PASS ($FAIL_COUNT FAIL)" | tee -a "$REPORT"
  echo "  E2E (test-e2e-*.exp) skipped — run without --self-check for full suite" | tee -a "$REPORT"
  echo "  Report: $REPORT" | tee -a "$REPORT"
  echo "════════════════════════════════════════" | tee -a "$REPORT"
  [ "$FAIL_COUNT" -eq 0 ]
  exit $?
fi

echo "" | tee -a "$REPORT"
echo "▸ E2E expect scripts (not executed by default — see SPEC out-of-scope)" | tee -a "$REPORT"
echo "  Available: test-e2e-disabled-tdd.exp, test-e2e-default.exp" | tee -a "$REPORT"
echo "  Run manually: expect ./test-e2e-disabled-tdd.exp <log> <plugin_dir>" | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "════════════════════════════════════════" | tee -a "$REPORT"
echo "  TOTAL: $PASS_COUNT/$TOTAL PASS ($FAIL_COUNT FAIL)" | tee -a "$REPORT"
echo "  Report: $REPORT" | tee -a "$REPORT"
echo "════════════════════════════════════════" | tee -a "$REPORT"

[ "$FAIL_COUNT" -eq 0 ]
