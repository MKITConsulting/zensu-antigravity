#!/usr/bin/env bash
# antigravity-shim.sh Stop translation, parameterized by ZENSU_AG_STOP_BLOCKS
# (MJ8b — a REAL shim knob, default 0 until a live probe confirms a plugin Stop
# hook can hard-block):
#   1 -> the wrapped Stop hook's {"decision":"block","reason":...} is emitted as
#        the Antigravity Stop-block shape (full parity).
#   0 -> the directive is emitted as ADVISORY allow-context instead (Stop is
#        advisory; the agent is nudged, not forced — codex's degrade).
# Either way the shim exits 0. The reason text is plain (no schema leakage).
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
cp "$ROOT/hooks/antigravity/"*.js "$SBX/hooks/antigravity/" 2>/dev/null
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

run_stop() { # $1=ZENSU_AG_STOP_BLOCKS value -> sets OUT, RC
  printf '{"session_id":"stop-sess"}' > "$TMP/pl"
  bash "$SBSHIM" stop-stub.sh < "$TMP/pl" > "$TMP/out" 2>/dev/null
  RC=$?
  OUT="$(cat "$TMP/out" 2>/dev/null)"
}

# --- ZENSU_AG_STOP_BLOCKS=1 -> emit the Stop-block shape ---------------------
ZENSU_AG_STOP_BLOCKS=1 run_stop
printf '%s' "$OUT" | grep -q '"decision":"block"' && ok "STOP_BLOCKS=1: emits decision:block" || bad "STOP_BLOCKS=1: no block shape ($OUT)"
printf '%s' "$OUT" | grep -qF "$REASON" && ok "STOP_BLOCKS=1: carries the reviewer directive" || bad "STOP_BLOCKS=1: reason missing"
[ "$RC" -eq 0 ] && ok "STOP_BLOCKS=1: exit 0" || bad "STOP_BLOCKS=1: exit $RC"
printf '%s' "$OUT" | grep -qiF "zensu-code-reviewer" && ok "STOP_BLOCKS=1: reason names zensu-code-reviewer" || bad "STOP_BLOCKS=1: reviewer not named"

# --- ZENSU_AG_STOP_BLOCKS=0 (default) -> advisory context, NOT a block -------
ZENSU_AG_STOP_BLOCKS=0 run_stop
printf '%s' "$OUT" | grep -q '"decision":"block"' && bad "STOP_BLOCKS=0: still emitted a hard block ($OUT)" || ok "STOP_BLOCKS=0: no hard block (advisory)"
printf '%s' "$OUT" | grep -qE '"allow_tool":true|"decision":"allow"|additionalContext|"context"' && ok "STOP_BLOCKS=0: emits the directive as advisory context" || bad "STOP_BLOCKS=0: no advisory context ($OUT)"
printf '%s' "$OUT" | grep -qF "$REASON" && ok "STOP_BLOCKS=0: advisory still carries the directive text" || bad "STOP_BLOCKS=0: directive text dropped"
[ "$RC" -eq 0 ] && ok "STOP_BLOCKS=0: exit 0" || bad "STOP_BLOCKS=0: exit $RC"

# --- default (knob unset) == advisory (0) ------------------------------------
printf '{"session_id":"stop-sess"}' > "$TMP/pl"
bash "$SBSHIM" stop-stub.sh < "$TMP/pl" > "$TMP/out" 2>/dev/null
OUT="$(cat "$TMP/out" 2>/dev/null)"
printf '%s' "$OUT" | grep -q '"decision":"block"' && bad "default knob hard-blocked (should be advisory)" || ok "default (unset) == advisory, no hard block"

# --- reason is plain (no schema leakage) -------------------------------------
ZENSU_AG_STOP_BLOCKS=1 run_stop
printf '%s' "$OUT" | grep -q 'hookSpecificOutput' && bad "stop output leaks hookSpecificOutput" || ok "stop output free of hookSpecificOutput"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
