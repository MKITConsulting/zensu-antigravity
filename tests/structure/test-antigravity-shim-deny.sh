#!/usr/bin/env bash
# antigravity-shim.sh DENY translation. The shim runs a wrapped engine-neutral script,
# reads its stdout, and on `hookSpecificOutput.permissionDecision="deny"` emits a
# TOP-LEVEL Antigravity verdict. The output dialect is the one [AMBIGUOUS] item,
# parameterized by ZENSU_AG_HOOK_CONTRACT ∈ {superset, allow_tool, decision, exit}
# (MJ8a — the REAL literal values, NOT A|B):
#   allow_tool -> {"allow_tool":false,...}             (Convention A only)
#   decision   -> {"decision":"deny",...}              (Convention B only)
#   superset   -> BOTH keys                            (probe default)
#   exit       -> Convention B keys + the shim exits 2 (PreToolUse-deny exit)
# The shim ALWAYS exits 0 except under CONTRACT=exit. The reason text must be
# plain (no raw permissionDecision / hookSpecificOutput leakage).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHIM="$ROOT/hooks/antigravity/antigravity-shim.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$SHIM" ] || { bad "antigravity-shim.sh missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"

# Sandbox copy of the shim tree (the shim self-resolves its root from $0) so we
# can drop a stub wrapped script without polluting the repo working tree. The
# shim sources hooks/antigravity/normalize-payload.js + emit-verdict.js + the
# lib FSM, so copy the whole hooks/ subtree.
SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/antigravity/"*.js "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/lib/"* "$SBX/hooks/lib/" 2>/dev/null
SBSHIM="$SBX/hooks/antigravity/antigravity-shim.sh"

REASON="zensu hook says no: production edit blocked"
DENY_STUB="$SBX/hooks/zz-deny-stub.sh"
cat > "$DENY_STUB" <<STUB
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$REASON"}}'
STUB
chmod +x "$DENY_STUB" "$SBSHIM" 2>/dev/null

ALLOW_STUB="$SBX/hooks/zz-allow-stub.sh"
printf '#!/bin/bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$ALLOW_STUB"
chmod +x "$ALLOW_STUB"

run_deny() { # $1=contract -> stdout of shim, RC in global RC
  printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"x"}}}' \
    | env ZENSU_AG_HOOK_CONTRACT="$1" bash "$SBSHIM" zz-deny-stub.sh 2>/dev/null
}

# --- allow_tool (Convention A only) ---------------------------------------
OUT="$(run_deny allow_tool)"; RC=$?
printf '%s' "$OUT" | grep -q '"allow_tool":false' && ok "allow_tool: emits allow_tool:false" || bad "allow_tool: no allow_tool:false ($OUT)"
printf '%s' "$OUT" | grep -q '"decision"' && bad "allow_tool: leaked a decision key" || ok "allow_tool: no decision key (Convention A only)"
printf '%s' "$OUT" | grep -qF "$REASON" && ok "allow_tool: carries the reason text" || bad "allow_tool: reason missing"
[ "$RC" -eq 0 ] && ok "allow_tool: exit 0" || bad "allow_tool: exit $RC (want 0)"

# --- decision (Convention B only) -----------------------------------------
OUT="$(run_deny decision)"; RC=$?
printf '%s' "$OUT" | grep -q '"decision":"deny"' && ok "decision: emits decision:deny" || bad "decision: no decision:deny ($OUT)"
printf '%s' "$OUT" | grep -q '"allow_tool"' && bad "decision: leaked an allow_tool key" || ok "decision: no allow_tool key (Convention B only)"
printf '%s' "$OUT" | grep -qF "$REASON" && ok "decision: carries the reason text" || bad "decision: reason missing"
[ "$RC" -eq 0 ] && ok "decision: exit 0 (deny does not exit non-zero in this dialect)" || bad "decision: exit $RC (want 0)"

# --- superset (BOTH dialects; probe default) ------------------------------
OUT="$(run_deny superset)"; RC=$?
printf '%s' "$OUT" | grep -q '"allow_tool":false' && ok "superset: emits allow_tool:false (Convention A)" || bad "superset: no allow_tool:false ($OUT)"
printf '%s' "$OUT" | grep -q '"decision":"deny"' && ok "superset: emits decision:deny (Convention B)" || bad "superset: no decision:deny ($OUT)"
[ "$RC" -eq 0 ] && ok "superset: exit 0" || bad "superset: exit $RC (want 0)"

# default (no env) == superset
OUT="$(printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"x"}}}' | bash "$SBSHIM" zz-deny-stub.sh 2>/dev/null)"
printf '%s' "$OUT" | grep -q '"allow_tool":false' && printf '%s' "$OUT" | grep -q '"decision":"deny"' \
  && ok "default contract (unset) == superset (both keys)" || bad "default contract not superset ($OUT)"

# --- exit (Convention B + shim exits 2) -----------------------------------
OUT="$(run_deny exit)"; RC=$?
printf '%s' "$OUT" | grep -q '"decision":"deny"' && ok "exit: emits decision:deny" || bad "exit: no decision:deny ($OUT)"
[ "$RC" -eq 2 ] && ok "exit: shim exits 2 (PreToolUse-deny exit)" || bad "exit: shim exit $RC (want 2)"

# --- reason is plain text (no schema leakage) -----------------------------
OUT="$(run_deny superset)"
printf '%s' "$OUT" | grep -q 'permissionDecision' && bad "deny output leaks raw permissionDecision" || ok "deny output free of raw permissionDecision"
printf '%s' "$OUT" | grep -q 'hookSpecificOutput' && bad "deny output leaks hookSpecificOutput" || ok "deny output free of hookSpecificOutput"

# --- allow path: neutral wrapped script never denies -----------------------
for C in allow_tool decision superset; do
  OUT="$(printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"x"}}}' | env ZENSU_AG_HOOK_CONTRACT="$C" bash "$SBSHIM" zz-allow-stub.sh 2>/dev/null)"; RC=$?
  printf '%s' "$OUT" | grep -q '"allow_tool":false' && bad "$C: neutral script wrongly denied ($OUT)" || ok "$C: neutral wrapped script does not deny"
  [ "$RC" -eq 0 ] && ok "$C: neutral path exit 0" || bad "$C: neutral path exit $RC"
done

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
