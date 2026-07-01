#!/bin/bash
set -u

# Plan->TDD decision gate. CC fired plan-approved-delegate.sh on ExitPlanMode
# (PostToolUse) to route an approved plan into the TDD-vs-direct decision.
# Antigravity has NO ExitPlanMode analog (fidelity matrix: DEGRADE ->
# workflow/rule), so the delegate is NOT WIRED in hooks.json.template; the plan-
# time decision is re-expressed as always-on rules + the workflow shims. The
# engine-neutral delegate SCRIPT is still shipped (kept-but-unwired) and ports
# verbatim, so this pins BOTH: (a) the script routes to skill='zensu:tdd' when
# run directly, and (b) the re-expression — the delegate is NOT in the template,
# and rules/ + the tdd workflow carry the plan-time TDD steering.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$PLUGIN_DIR/hooks/plan-approved-delegate.sh"
TPL="$PLUGIN_DIR/hooks.json.template"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

# (b) The delegate is NOT wired in the template (no ExitPlanMode analog, MJ5).
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let wired=false;
  const walk=(o)=>{if(Array.isArray(o)){o.forEach(walk);return}if(o&&typeof o==="object"){if(typeof o.command==="string"&&/plan-approved-delegate\.sh/.test(o.command))wired=true;Object.values(o).forEach(walk)}};
  walk(t);
  process.exit(wired?1:0);
' "$TPL" 2>/dev/null \
  && check "P0 plan-approved-delegate NOT wired in template (no ExitPlanMode analog)" PASS \
  || check "P0 plan-approved-delegate wrongly wired in template" FAIL

# The plan-time TDD steering migrated to rules/ + the tdd workflow.
TDD_RULE="$PLUGIN_DIR/rules/zensu-tdd.md"
{ [ -f "$TDD_RULE" ] && grep -qiE 'plan|tdd' "$TDD_RULE"; } \
  && check "P0b rules/zensu-tdd.md carries the plan-time TDD decision steering" PASS \
  || check "P0b rules/zensu-tdd.md lacks the plan-time steering" FAIL

# (a) The engine-neutral delegate script (kept-but-unwired) still routes.
if [ ! -f "$SCRIPT" ]; then
  check "P1 plan-approved-delegate.sh present (kept-but-unwired)" FAIL
  echo "----"; echo "test-plan-approved-delegate: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "P1 plan-approved-delegate.sh present (kept-but-unwired)" PASS
bash -n "$SCRIPT" 2>/dev/null && check "P2 bash -n syntax check passes" PASS || check "P2 bash -n syntax check passes" FAIL

export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
PAYLOAD='{"tool_name":"ExitPlanMode","tool_input":{"plan":"build a slugify helper"}}'

# autoTdd enabled (default) -> routes to skill='zensu:tdd' with additionalContext
NOCFG="$PLUGIN_DIR/.no-such-$$.json"; rm -f "$NOCFG"
OUT="$(printf '%s' "$PAYLOAD" | ZENSU_CONFIG="$NOCFG" bash "$SCRIPT" 2>/dev/null)"
case "$OUT" in *"skill='zensu:tdd'"*) check "P3 autoTdd default: routes to skill='zensu:tdd'" PASS ;; *) check "P3 routing (got: ${OUT:0:80})" FAIL ;; esac
case "$OUT" in *"additionalContext"*) check "P4 emits additionalContext" PASS ;; *) check "P4 additionalContext" FAIL ;; esac

# autoTdd disabled -> empty (no routing)
CFG="$PLUGIN_DIR/.cfg-off-$$.json"; printf '%s' '{"hooks":{"autoTdd":false}}' > "$CFG"
OUT="$(printf '%s' "$PAYLOAD" | ZENSU_CONFIG="$CFG" bash "$SCRIPT" 2>/dev/null)"; RC=$?
{ [ -z "$OUT" ] && [ "$RC" -eq 0 ]; } && check "P5 autoTdd=false -> empty stdout, exit 0" PASS || check "P5 autoTdd=false (out='$OUT' rc=$RC)" FAIL
rm -f "$CFG"

# names the AG workflow in prose (the C13 sweep keeps /zensu-tdd)
printf '%s' "$PAYLOAD" | ZENSU_CONFIG="$NOCFG" bash "$SCRIPT" 2>/dev/null | grep -qF '/zensu-tdd' \
  && check "P6 directive names the /zensu-tdd workflow (AG invocation)" PASS || check "P6 names /zensu-tdd" FAIL

echo "----"
echo "test-plan-approved-delegate: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
