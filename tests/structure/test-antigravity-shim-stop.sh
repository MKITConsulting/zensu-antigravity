#!/usr/bin/env bash
# antigravity-shim.sh Stop translation.
#
# The wrapped chain-enforcer emits the engine-neutral {"decision":"block",...}.
# The host reads something else entirely: on Stop, `{"decision":"continue"}` is
# the ONLY value that blocks stopping — "any other value allows the agent to
# stop" (~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/
# hooks.md, agy 1.1.10). So the shim must TRANSLATE block -> continue.
#
# This is the suite's whole reason to exist. The plugin previously forwarded
# `decision:"block"` verbatim (and only under ZENSU_AG_STOP_BLOCKS=1, which
# defaulted to 0), so the chain-enforcer could never hold a turn open and nothing
# warned. That knob is retired; the translation is unconditional.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"

SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
for name in normalize-payload.js emit-verdict.js session-paths.js; do cp "$ROOT/hooks/antigravity/$name" "$SBX/hooks/antigravity/"; done
cp "$ROOT/hooks/lib/"* "$SBX/hooks/lib/" 2>/dev/null
SBSHIM="$SBX/hooks/antigravity/antigravity-shim.sh"
chmod +x "$SBSHIM" 2>/dev/null

REASON="Run zensu-code-reviewer before stopping: the review chain is incomplete."
STOP_STUB="$SBX/hooks/stop-stub.sh"
cat > "$STOP_STUB" <<STUBEOF
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s' '{"decision":"block","reason":"$REASON"}'
STUBEOF
chmod +x "$STOP_STUB"

QUIET_STUB="$SBX/hooks/stop-quiet-stub.sh"
printf '#!/bin/bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$QUIET_STUB"
chmod +x "$QUIET_STUB"

run_stop() { # $@ = shim args -> sets OUT, RC
  printf '{"executionNum":1,"terminationReason":"model_stop","session_id":"stop-sess"}' > "$TMP/pl"
  bash "$SBSHIM" "$@" < "$TMP/pl" > "$TMP/out" 2>/dev/null
  RC=$?
  OUT="$(cat "$TMP/out" 2>/dev/null)"
}

# --- block -> continue (the translation that makes the backstop real) ---------
run_stop stop-stub.sh Stop
printf '%s' "$OUT" | grep -q '"decision":"continue"' && ok "an enforcer block emits decision:continue (the only value that blocks stopping)" || bad "no decision:continue ($OUT)"
printf '%s' "$OUT" | grep -q '"decision":"block"' && bad "still forwards the engine-neutral decision:block — the host would let the agent stop ($OUT)" || ok 'never forwards the CC-shaped decision:"block"'
printf '%s' "$OUT" | grep -qF "$REASON" && ok "carries the reviewer directive" || bad "reason missing ($OUT)"
printf '%s' "$OUT" | grep -qiF "zensu-code-reviewer" && ok "reason names zensu-code-reviewer" || bad "reviewer not named"
[ "$RC" -eq 0 ] && ok "exit 0" || bad "exit $RC (want 0)"

# --- the retired knob must be inert ------------------------------------------
BASE="$OUT"
for v in 0 1; do
  ZENSU_AG_STOP_BLOCKS="$v" run_stop stop-stub.sh Stop
  [ "$OUT" = "$BASE" ] && ok "ZENSU_AG_STOP_BLOCKS=$v is inert (output unchanged)" || bad "ZENSU_AG_STOP_BLOCKS=$v changed the verdict: $OUT"
done

# --- nothing to enforce -> the agent is allowed to stop -----------------------
run_stop stop-quiet-stub.sh Stop
[ "$OUT" = "{}" ] && ok "a quiet enforcer emits {} so the agent may stop" || bad "quiet enforcer emitted '$OUT' instead of {}"
[ "$RC" -eq 0 ] && ok "quiet path exit 0" || bad "quiet path exit $RC"

# --- a caller that omits the event fails safe (does not wedge the loop) -------
run_stop stop-stub.sh
[ "$OUT" = "{}" ] && ok "missing event arg yields {} — a mis-wired Stop hook cannot wedge the loop" || bad "missing event arg emitted '$OUT'"

# --- reason is plain (no schema leakage) --------------------------------------
run_stop stop-stub.sh Stop
printf '%s' "$OUT" | grep -q 'hookSpecificOutput' && bad "stop output leaks hookSpecificOutput" || ok "stop output free of hookSpecificOutput"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
