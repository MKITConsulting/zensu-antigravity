#!/bin/bash
# Antigravity adaptation of CC's test-no-pluginroot-env.sh. The guarantee is
# engine-neutral: the hook scripts self-resolve their plugin root from their own
# path and must work even when ZENSU_PLUGIN_ROOT is unset. The two delegate
# hooks (post-review-tdd-delegate.sh, plan-approved-delegate.sh) are kept on disk
# but unwired in Antigravity (MJ5: hooks.json.template ships the safe Scenario-B
# default; they are documented prose for the Scenario-A upgrade). CC's third
# assertion targeted session-start-pulse.sh, which Antigravity dropped in favor
# of hooks/antigravity/lazy-init.sh — so that line is retargeted to lazy-init.
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

unset ZENSU_PLUGIN_ROOT
unset ZENSU_CONFIG

export ZENSU_PLUGIN_DATA_OVERRIDE="$(mktemp -d)"
cleanup() { rm -rf "$ZENSU_PLUGIN_DATA_OVERRIDE"; }
trap cleanup EXIT

POSTREV="$PLUGIN_DIR/hooks/post-review-tdd-delegate.sh"
if [ -f "$POSTREV" ]; then
  OUT_POSTREVIEW="$(echo '{"tool_name":"Task","tool_input":{"subagent_type":"zensu-code-reviewer","prompt":"x"}}' | "$POSTREV" 2>/dev/null)"
  case "$OUT_POSTREVIEW" in
    *"zensu-code-reviewer"*|*"/zensu-tdd"*|*"zensu:tdd"*) check "post-review-tdd-delegate.sh works WITHOUT ZENSU_PLUGIN_ROOT" PASS ;;
    *)                                                    check "post-review-tdd-delegate.sh works WITHOUT ZENSU_PLUGIN_ROOT (got: ${OUT_POSTREVIEW:0:80})" FAIL ;;
  esac
else
  check "post-review-tdd-delegate.sh present (kept-but-unwired)" FAIL
fi

PLANHOOK="$PLUGIN_DIR/hooks/plan-approved-delegate.sh"
if [ -f "$PLANHOOK" ]; then
  OUT_PLAN="$(echo '{"tool_name":"ExitPlanMode","tool_input":{"plan":"x"}}' | "$PLANHOOK" 2>/dev/null)"
  case "$OUT_PLAN" in
    *"tdd"*) check "plan-approved-delegate.sh works WITHOUT ZENSU_PLUGIN_ROOT" PASS ;;
    *)       check "plan-approved-delegate.sh works WITHOUT ZENSU_PLUGIN_ROOT (got: ${OUT_PLAN:0:80})" FAIL ;;
  esac
else
  check "plan-approved-delegate.sh present (kept-but-unwired)" FAIL
fi

# CC tested session-start-pulse.sh here; Antigravity's SessionStart replacement
# is lazy-init.sh. It pins the plugin-root pointer + captures the session id; it
# must self-resolve its root and never break the call when ZENSU_PLUGIN_ROOT is
# absent. Run in a sandbox HOME so the real ~/.zensu pointer is untouched.
LAZY="$PLUGIN_DIR/hooks/antigravity/lazy-init.sh"
if [ -f "$LAZY" ]; then
  SBX_HOME="$(mktemp -d)"
  printf '{"session_id":"no-root-lazy"}' | env -u ZENSU_PLUGIN_ROOT HOME="$SBX_HOME" ZENSU_PROJECT_DIR="$SBX_HOME" bash "$LAZY" >/dev/null 2>&1
  RC=$?
  [ "$RC" -eq 0 ] && check "lazy-init.sh works WITHOUT ZENSU_PLUGIN_ROOT (self-resolves root)" PASS || check "lazy-init.sh WITHOUT ZENSU_PLUGIN_ROOT (rc=$RC)" FAIL
  rm -rf "$SBX_HOME"
else
  check "lazy-init.sh present" FAIL
fi

echo "----"
echo "test-no-pluginroot-env: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
