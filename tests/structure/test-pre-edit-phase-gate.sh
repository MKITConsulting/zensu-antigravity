#!/bin/bash
set -u

# TDD phase-gate through the Antigravity writer tools. pre-edit-tdd-reminder.sh
# denies prod edits in RED_FAIL / GREEN_PASS and allows test edits / prod-after-
# IMPL. Antigravity adaptation (MN5): the writers are write_to_file /
# replace_file_content / multi_replace_file_content, each carrying a SINGLE
# TargetFile (normalized to tool_input.file_path) — there is no apply_patch
# multi-file envelope, so the single-file path must win and the gate must treat
# all three writer names identically. Wiring is pinned against hooks.json.template.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/pre-edit-tdd-reminder.sh"
LIB="$PLUGIN_DIR/hooks/lib/zensu-tdd-phase.sh"
TPL="$PLUGIN_DIR/hooks.json.template"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

[ -f "$HOOK" ] || { check "hooks/pre-edit-tdd-reminder.sh exists" FAIL; echo "----"; echo "test-pre-edit-phase-gate: $PASS PASS / $FAIL FAIL"; exit 1; }
check "C0 hook exists" PASS
bash -n "$HOOK" 2>/dev/null && check "C1 bash -n syntax check passes" PASS || check "C1 bash -n syntax check passes" FAIL

# Wiring: the PreToolUse edit entry uses the EXACT writer matcher (BK4) and is
# shim-wrapped.
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const want = "write_to_file|replace_file_content|multi_replace_file_content";
  let ok=false;
  for (const group of Object.values(t)) for (const [ev,arr] of Object.entries(group||{})) {
    if (ev!=="PreToolUse") continue;
    for (const e of (arr||[])) {
      if ((e.matcher||"")!==want) continue;
      for (const h of (e.hooks||[])) if (/antigravity-shim\.sh pre-edit-tdd-reminder\.sh/.test(h.command||"")) ok=true;
    }
  }
  process.exit(ok?0:1);
' "$TPL" 2>/dev/null \
  && check "C-wire pre-edit wired under the exact writer matcher [BK4]" PASS || check "C-wire writer matcher wiring" FAIL

export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
TDD_STATE_DIR="$(mktemp -d)"; export TDD_STATE_DIR
unset ZENSU_TDD_GATE 2>/dev/null || true
cleanup() { rm -rf "$TDD_STATE_DIR"; }
trap cleanup EXIT

source "$LIB"
# 0.4.0+ activation: the gate activates on chain-state (active=true). Shim the
# phase setup to also mark each session active.
eval "$(declare -f tdd_write_phase | sed '1s/^tdd_write_phase/_zensu_orig_write_phase/')"
tdd_write_phase() { tdd_set_flag "$1" active true >/dev/null 2>&1; _zensu_orig_write_phase "$@"; }

SID="phase-gate-1"

gate() { # $1=tool_name $2=file_path -> allow|deny
  printf '{"tool_name":"%s","tool_input":{"file_path":"%s"},"session_id":"%s"}' "$1" "$2" "$SID" \
    | bash "$HOOK" 2>/dev/null | node -e '
      let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{s=s.trim();if(!s){console.log("allow");return}
        try{const j=JSON.parse(s);console.log(j.hookSpecificOutput&&j.hookSpecificOutput.permissionDecision==="deny"?"deny":"allow")}catch(_){console.log("allow")}});'
}

# RED_FAIL: prod denied (all 3 writer names), test allowed.
tdd_write_phase "$SID" "S1" "RED_FAIL" "" >/dev/null
for W in write_to_file replace_file_content multi_replace_file_content; do
  [ "$(gate "$W" src/app.ts)" = "deny" ] && check "RED_FAIL: $W on prod -> deny (single TargetFile)" PASS || check "RED_FAIL: $W prod deny" FAIL
done
[ "$(gate write_to_file src/app.test.ts)" = "allow" ] && check "RED_FAIL: test edit allow" PASS || check "RED_FAIL test allow" FAIL

# IMPL after RED_FAIL: prod allowed (all 3 writers).
tdd_write_phase "$SID" "S1" "IMPL" "" >/dev/null
for W in write_to_file replace_file_content multi_replace_file_content; do
  [ "$(gate "$W" src/app.ts)" = "allow" ] && check "IMPL: $W on prod -> allow" PASS || check "IMPL: $W prod allow" FAIL
done

# GREEN_PASS: prod denied (no drift), test allowed.
tdd_write_phase "$SID" "S1" "GREEN_PASS" "" >/dev/null
[ "$(gate write_to_file src/app.ts)" = "deny" ] && check "GREEN_PASS: prod deny (no drift)" PASS || check "GREEN_PASS prod deny" FAIL
[ "$(gate write_to_file src/app.test.ts)" = "allow" ] && check "GREEN_PASS: test allow" PASS || check "GREEN_PASS test allow" FAIL

# ZENSU_TDD_GATE=off bypass.
OUT="$(printf '{"tool_name":"write_to_file","tool_input":{"file_path":"src/app.ts"},"session_id":"%s"}' "$SID" | ZENSU_TDD_GATE=off bash "$HOOK" 2>/dev/null)"
RC=$?
{ [ "$RC" = "0" ] && ! printf '%s' "$OUT" | grep -qF 'permissionDecision'; } && check "ZENSU_TDD_GATE=off bypasses the gate" PASS || check "gate-off bypass (rc=$RC out=$OUT)" FAIL

# .zensu/ path under UNINITIALIZED -> allowed (the .zensu bypass)
SID2="phase-gate-uninit"
printf '{"session_id":"%s","active":true}\n' "$SID2" > "$TDD_STATE_DIR/tdd-phase-${SID2}.json"
OUT="$(printf '{"tool_name":"write_to_file","tool_input":{"file_path":"/p/.zensu/plans/x.md"},"session_id":"%s"}' "$SID2" | bash "$HOOK" 2>/dev/null)"
! printf '%s' "$OUT" | grep -qF 'permissionDecision' && check ".zensu/ plan path allowed under UNINITIALIZED" PASS || check ".zensu/ path allowed (out=$OUT)" FAIL

echo "----"
echo "test-pre-edit-phase-gate: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
