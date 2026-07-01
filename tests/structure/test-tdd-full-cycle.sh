#!/bin/bash
# Full /zensu-tdd lifecycle — hermetic end-to-end walk (no live agy, no API).
# Drives ONE session through the COMPLETE cycle via the real hooks/libs in the
# real order, asserting the phase-gate, witness, post-review routing and Stop-hook
# at EVERY transition. Engine-neutral: the hooks read the flat payload the shim
# produces. The Stop-block assertions run the enforcer DIRECTLY (its
# `decision:block` output is what the shim's ZENSU_AG_STOP_BLOCKS=1 path
# forwards); the shim-level Stop dialect is pinned separately by
# test-antigravity-shim-stop.sh.
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$PLUGIN_DIR/hooks/lib/zensu-log.sh"
GATE="$PLUGIN_DIR/hooks/pre-edit-tdd-reminder.sh"
WITNESS="$PLUGIN_DIR/hooks/post-bash-witness.sh"
STOP="$PLUGIN_DIR/hooks/stop-chain-enforcer.sh"
POSTREV="$PLUGIN_DIR/hooks/post-review-tdd-delegate.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

export ZENSU_PLUGIN_ROOT="$PLUGIN_DIR"
TDD_STATE_DIR="$(mktemp -d)"; export TDD_STATE_DIR
PROJ="$(mktemp -d)"; export ZENSU_PROJECT_DIR="$PROJ"
export ZENSU_PLUGIN_DATA_OVERRIDE="$PROJ/state"
export ZENSU_CONFIG="$TDD_STATE_DIR/strict-config.json"
printf '%s' '{"hooks":{"tddImplementation":true}}' > "$ZENSU_CONFIG"
unset ZENSU_TDD_GATE ZENSU_TEST_WITNESS ZENSU_CHAIN 2>/dev/null || true
cleanup() { rm -rf "$TDD_STATE_DIR" "$PROJ"; }
trap cleanup EXIT

SID="full-cycle"

# Antigravity writer-tool payloads (write_to_file with TargetFile) — the
# normalized shape the wrapped gate reads. MN5: single TargetFile path wins.
PROD='{"tool_name":"write_to_file","tool_input":{"file_path":"src/foo.ts"},"session_id":"'"$SID"'"}'
TEST='{"tool_name":"write_to_file","tool_input":{"file_path":"src/foo.test.ts"},"session_id":"'"$SID"'"}'

gate() {
  printf '%s' "$1" | bash "$GATE" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{s=s.trim();if(!s){console.log("allow");return}
      try{const j=JSON.parse(s);console.log(j.hookSpecificOutput&&j.hookSpecificOutput.permissionDecision==="deny"?"deny":"allow")}
      catch(_){console.log("allow")}});'
}
stop_dec() { printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{s=s.trim();if(!s){console.log("allow");return}
      try{console.log(JSON.parse(s).decision==="block"?"block":"allow")}catch(_){console.log("allow")}});'; }
stop_reason() { printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{try{console.log(JSON.parse(s).reason||"")}catch(_){console.log("")}});'; }
phase_step() { bash "$LOG" --phase "$1" --step "$2" --session "$SID" >/dev/null 2>&1; }

echo "== Phase 0: begin =="
[ "$(gate "$PROD")" = "allow" ] && check "0a pre-begin: gate is a pass-through (no chain-state)" PASS || check "0a pre-begin pass-through" FAIL
bash "$LOG" --tdd-begin --session "$SID" >/dev/null
[ "$(gate "$PROD")" = "deny" ] && check "0c after --tdd-begin: active + UNINITIALIZED -> prod deny" PASS || check "0c begin activates gate" FAIL

echo "== Step S1: RED -> GREEN =="
phase_step RED_WRITE S1
[ "$(gate "$TEST")" = "allow" ] && check "S1a RED_WRITE: test edit allow" PASS || check "S1a RED_WRITE test allow" FAIL
[ "$(gate "$PROD")" = "allow" ] && check "S1b RED_WRITE: prod edit allow (scaffolding ok)" PASS || check "S1b RED_WRITE prod allow" FAIL
phase_step RED_FAIL S1
[ "$(gate "$TEST")" = "allow" ] && check "S1d RED_FAIL: test edit allow" PASS || check "S1d RED_FAIL test allow" FAIL
[ "$(gate "$PROD")" = "deny" ] && check "S1e RED_FAIL: prod edit deny (must IMPL first)" PASS || check "S1e RED_FAIL prod deny" FAIL
phase_step IMPL S1
[ "$(gate "$PROD")" = "allow" ] && check "S1f IMPL after RED_FAIL(S1): prod edit allow" PASS || check "S1f IMPL prod allow" FAIL
phase_step GREEN_PASS S1
[ "$(gate "$PROD")" = "deny" ] && check "S1h GREEN_PASS: prod deny (no drift without new RED)" PASS || check "S1h GREEN_PASS prod deny" FAIL
[ "$(gate "$TEST")" = "allow" ] && check "S1i GREEN_PASS: test edit allow (write next RED)" PASS || check "S1i GREEN_PASS test allow" FAIL

echo "== REFACTOR =="
phase_step REFACTOR S1
[ "$(gate "$PROD")" = "allow" ] && check "R1 REFACTOR: prod edit allow" PASS || check "R1 REFACTOR prod allow" FAIL

echo "== Witness mid-cycle (active session) =="
echo '{"tool_input":{"command":"npm test"},"tool_response":{"exit_code":0,"stdout":"ok"},"session_id":"'"$SID"'"}' | bash "$WITNESS" >/dev/null 2>&1
WLOG="$PROJ/.zensu/logs/witness-${SID}.log"
W1_LINE="$(grep -F 'cmd="npm test"' "$WLOG" 2>/dev/null | head -n1)"
{ [ -f "$WLOG" ] && printf '%s' "$W1_LINE" | grep -qF 'cmd="npm test"' && printf '%s' "$W1_LINE" | grep -qF 'tail="ok"'; } \
  && check "W1 active session records witness line with cmd= + tail=" PASS || check "W1 witness line got='${W1_LINE}'" FAIL

echo "== Terminus: implComplete -> review -> self-review -> done =="
[ "$(stop_dec)" = "allow" ] && check "T0 mid-cycle (!implComplete): Stop allows" PASS || check "T0 mid-cycle allow" FAIL
bash "$LOG" --tdd-complete --session "$SID" >/dev/null
[ "$(stop_dec)" = "block" ] && check "T1 implComplete + !codeReviewDone: Stop BLOCKS" PASS || check "T1 terminus block" FAIL
case "$(stop_reason)" in *"zensu-code-reviewer"*|*"zensu:code-reviewer"*) check "T2 block reason forces the code-reviewer" PASS ;; *) check "T2 reason code-reviewer" FAIL ;; esac
# code-reviewer completes -> post-review routes in-thread + counts a round
CTX="$(printf '%s' '{"tool_input":{"subagent_type":"zensu:code-reviewer"},"session_id":"'"$SID"'"}' | bash "$POSTREV" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(s).hookSpecificOutput.additionalContext||"")}catch(_){console.log("")}})')"
echo "$CTX" | grep -qE '/zensu-tdd|zensu:tdd' && check "T3 post-review routes fixes in-thread (TDD workflow)" PASS || check "T3 in-thread routing" FAIL
RCOUNT="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).count)}catch(_){console.log("?")}' "$PROJ/state/rounds-${SID}.json")"
[ "$RCOUNT" = "1" ] && check "T4 round counter increments (1)" PASS || check "T4 counter=1 (got $RCOUNT)" FAIL
bash "$LOG" --code-review-done --session "$SID" >/dev/null
[ "$(stop_dec)" = "block" ] && check "T5 codeReviewDone + !chainDone: Stop still BLOCKS" PASS || check "T5 pre-self-review block" FAIL
case "$(stop_reason)" in *"self-review"*) check "T6 block reason now forces self-review" PASS ;; *) check "T6 reason self-review" FAIL ;; esac
bash "$LOG" --chain-done --session "$SID" >/dev/null
[ "$(stop_dec)" = "allow" ] && check "T7 chainDone: Stop ALLOWS (cycle complete)" PASS || check "T7 terminus allow" FAIL

echo "----"
echo "test-tdd-full-cycle: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
