#!/bin/bash
set -u

# stop-chain-enforcer.sh — the Stop backstop. Engine-neutral: it reads the flat
# CC payload and emits the CC {"decision":"block","reason":...} shape that the
# shim forwards (under ZENSU_AG_STOP_BLOCKS=1) or degrades to advisory context
# (=0). This test exercises the enforcer DIRECTLY (its raw output), pinning:
# block during the chain (implComplete && !chainDone), two-stage routing to
# self-review, escape ZENSU_CHAIN=off / hooks.chainEnforcer:false, the anti-
# deadlock .stopblocks budget release after the cap, and a re-armed second chain.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STOP="$PLUGIN_DIR/hooks/stop-chain-enforcer.sh"
LOG="$PLUGIN_DIR/hooks/lib/zensu-log.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

[ -f "$STOP" ] || { check "hooks/stop-chain-enforcer.sh exists" FAIL; echo "----"; echo "test-stop-enforcer: $PASS PASS / $FAIL FAIL"; exit 1; }
check "S0 hook exists" PASS
bash -n "$STOP" 2>/dev/null && check "S1 bash -n syntax check passes" PASS || check "S1 bash -n syntax check passes" FAIL

export ZENSU_PLUGIN_ROOT="$PLUGIN_DIR"
TMP="$(mktemp -d)"; export TDD_STATE_DIR="$TMP/state"; mkdir -p "$TDD_STATE_DIR"
export HOME="$TMP/home"; mkdir -p "$HOME"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
SID="stop-enf"

dec() { printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{s=s.trim();if(!s){console.log("allow");return}
      try{console.log(JSON.parse(s).decision==="block"?"block":"allow")}catch(_){console.log("allow")}});'; }
reason() { printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(s).reason||"")}catch(_){console.log("")}});'; }

# 0) inactive session -> silent allow
OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null)"; RC=$?
{ [ "$RC" -eq 0 ] && [ -z "$OUT" ]; } && check "S2 inactive session: silent exit 0" PASS || check "S2 inactive (rc=$RC out='$OUT')" FAIL

# 1) implComplete && !codeReviewDone -> block, reason names reviewer
bash "$LOG" --tdd-begin --session "$SID" >/dev/null 2>&1
bash "$LOG" --tdd-complete --session "$SID" >/dev/null 2>&1
[ "$(dec)" = "block" ] && check "S3 implComplete + !codeReviewDone: BLOCK" PASS || check "S3 terminus block" FAIL
printf '%s' "$(reason)" | grep -qF "zensu-code-reviewer" && check "S4 reason names zensu-code-reviewer" PASS || check "S4 reason reviewer" FAIL
printf '%s' "$(reason)" | grep -qiE 'subagent|review' && check "S5 reason speaks the Antigravity review chain" PASS || check "S5 reason wording" FAIL
printf '%s' "$(reason)" | grep -qF 'Codex' && check "S5b reason free of Codex-isms" FAIL || check "S5b reason free of Codex-isms" PASS

# 2) two-stage terminus: codeReviewDone -> directive routes to self-review
bash "$LOG" --code-review-done --session "$SID" >/dev/null 2>&1
[ "$(dec)" = "block" ] && check "S6 codeReviewDone + !chainDone: still BLOCKS" PASS || check "S6 pre-self-review block" FAIL
printf '%s' "$(reason)" | grep -qF "self-review" && check "S7 directive routes to self-review" PASS || check "S7 self-review routing" FAIL

# 3) chainDone -> silent allow
bash "$LOG" --chain-done --session "$SID" >/dev/null 2>&1
OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null)"; RC=$?
{ [ "$RC" -eq 0 ] && [ -z "$OUT" ]; } && check "S8 chainDone: silent exit 0 (cycle complete)" PASS || check "S8 chainDone (rc=$RC out='$OUT')" FAIL

# 4) escape hatch ZENSU_CHAIN=off
bash "$LOG" --tdd-begin --session "$SID" >/dev/null 2>&1
bash "$LOG" --tdd-complete --session "$SID" >/dev/null 2>&1
OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | ZENSU_CHAIN=off bash "$STOP" 2>/dev/null)"; RC=$?
{ [ "$RC" -eq 0 ] && [ -z "$OUT" ]; } && check "S9 ZENSU_CHAIN=off -> allow (escape)" PASS || check "S9 ZENSU_CHAIN=off (rc=$RC out='$OUT')" FAIL

# 4b) escape hatch hooks.chainEnforcer:false
CFG="$TMP/no-chain.json"; printf '%s' '{"hooks":{"chainEnforcer":false}}' > "$CFG"
OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | ZENSU_CONFIG="$CFG" bash "$STOP" 2>/dev/null)"
[ -z "$OUT" ] && check "S10 hooks.chainEnforcer:false -> allow (config escape)" PASS || check "S10 config escape (out='$OUT')" FAIL

# 5) anti-deadlock budget: a stalled chain stops blocking after the cap
SID="stop-budget"
bash "$LOG" --tdd-begin --session "$SID" >/dev/null 2>&1
bash "$LOG" --tdd-complete --session "$SID" >/dev/null 2>&1
BLOCKED=0; RELEASED=0
for i in $(seq 1 12); do
  OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null)"
  if printf '%s' "$OUT" | grep -q '"decision":"block"'; then BLOCKED=$((BLOCKED+1)); else RELEASED=1; break; fi
done
[ "$BLOCKED" -ge 1 ] && check "S11 budget: blocked at least once ($BLOCKED times)" PASS || check "S11 budget never blocked" FAIL
[ "$RELEASED" -eq 1 ] && check "S12 budget: released after cap (anti-deadlock)" PASS || check "S12 still blocking after 12 stops" FAIL

# 6) a SECOND chain in the same session is enforced again after a clean re-arm
# (--tdd-reset clears chain-1's stale completion flags, then --tdd-begin).
SID="stop-enf"
bash "$LOG" --tdd-reset --session "$SID" >/dev/null 2>&1
bash "$LOG" --tdd-begin --session "$SID" >/dev/null 2>&1
OUT="$(printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null)"
[ -z "$OUT" ] && check "S13 chain 2 re-armed: stop allowed before implComplete" PASS || check "S13 chain 2 pre-complete (out='$OUT')" FAIL
bash "$LOG" --tdd-complete --session "$SID" >/dev/null 2>&1
printf '%s' '{"session_id":"'"$SID"'"}' | bash "$STOP" 2>/dev/null | grep -q '"decision":"block"' \
  && check "S14 chain 2: stop blocks again after re-begin (stale flags cleared)" PASS || check "S14 chain 2 unenforced" FAIL

echo "----"
echo "test-stop-enforcer: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
