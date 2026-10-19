#!/usr/bin/env bash
# antigravity-shim.sh DENY translation. The shim runs a wrapped engine-neutral
# script, reads its stdout, and on `hookSpecificOutput.permissionDecision="deny"`
# emits the host's TOP-LEVEL PreToolUse verdict: {"decision":"deny","reason":...}.
#
# There is no dialect choice any more. The output schema was an [AMBIGUOUS] item
# probed via ZENSU_AG_HOOK_CONTRACT ∈ {superset, allow_tool, decision, exit} until
# the host's own spec settled it (~/.gemini/antigravity-cli/builtin/skills/
# agy-customizations/docs/hooks.md, agy 1.1.10): PreToolUse takes
# `decision` + `reason`, and `allow_tool`/`deny_reason` are not host keys at all.
# The env var and the exit-2 variant are retired; the shim always exits 0.
#
# The shim takes TWO arguments — `<bare-script>.sh <Event>`. The event selects the
# verdict dialect, so a caller that omits it gets the safe empty verdict. Both
# cases are pinned here.
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
# can drop a stub wrapped script without polluting the repo working tree.
SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
for name in normalize-payload.js emit-verdict.js session-paths.js; do cp "$ROOT/hooks/antigravity/$name" "$SBX/hooks/antigravity/"; done
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

PAYLOAD='{"toolCall":{"name":"run_command","args":{"CommandLine":"x"}}}'

run() { # $@ = shim args -> stdout; RC in the caller via $?
  printf '%s' "$PAYLOAD" | bash "$SBSHIM" "$@" 2>/dev/null
}

# --- the single host dialect ---------------------------------------------------
OUT="$(run zz-deny-stub.sh PreToolUse)"; RC=$?
printf '%s' "$OUT" | grep -q '"decision":"deny"' && ok "deny emits decision:deny" || bad "no decision:deny ($OUT)"
printf '%s' "$OUT" | grep -qF "$REASON" && ok "deny carries the reason text" || bad "reason missing ($OUT)"
[ "$RC" -eq 0 ] && ok "deny exits 0 (the shim never signals via exit code)" || bad "deny exit $RC (want 0)"

# --- the retired dialect must not come back ------------------------------------
printf '%s' "$OUT" | grep -q 'allow_tool'  && bad "deny still emits the retired allow_tool key ($OUT)"  || ok "no retired allow_tool key"
printf '%s' "$OUT" | grep -q 'deny_reason' && bad "deny still emits the retired deny_reason key ($OUT)" || ok "no retired deny_reason key"

# The env var is retired: setting it must change nothing.
for legacy in allow_tool decision superset exit; do
  O="$(printf '%s' "$PAYLOAD" | env ZENSU_AG_HOOK_CONTRACT="$legacy" bash "$SBSHIM" zz-deny-stub.sh PreToolUse 2>/dev/null)"; R=$?
  [ "$O" = "$OUT" ] && ok "ZENSU_AG_HOOK_CONTRACT=$legacy is inert (output unchanged)" || bad "ZENSU_AG_HOOK_CONTRACT=$legacy changed the output: $O"
  [ "$R" -eq 0 ] && ok "ZENSU_AG_HOOK_CONTRACT=$legacy still exits 0" || bad "ZENSU_AG_HOOK_CONTRACT=$legacy exited $R"
done

# --- a caller that forgets the event gets the SAFE verdict, never a wrong one ---
OUT_NOEV="$(run zz-deny-stub.sh)"; RC=$?
[ "$OUT_NOEV" = "{}" ] && ok "missing event arg yields the empty verdict (fails safe, does not guess)" || bad "missing event arg emitted '$OUT_NOEV'"
[ "$RC" -eq 0 ] && ok "missing event arg still exits 0" || bad "missing event arg exited $RC"

OUT_BADEV="$(run zz-deny-stub.sh NotAnEvent)"
[ "$OUT_BADEV" = "{}" ] && ok "unknown event arg yields the empty verdict" || bad "unknown event arg emitted '$OUT_BADEV'"

# --- reason is plain text (no schema leakage) ----------------------------------
OUT="$(run zz-deny-stub.sh PreToolUse)"
printf '%s' "$OUT" | grep -q 'permissionDecision'  && bad "deny output leaks raw permissionDecision" || ok "deny output free of raw permissionDecision"
printf '%s' "$OUT" | grep -q 'hookSpecificOutput'  && bad "deny output leaks hookSpecificOutput"     || ok "deny output free of hookSpecificOutput"

# --- allow path: a neutral wrapped script never denies -------------------------
OUT="$(run zz-allow-stub.sh PreToolUse)"; RC=$?
printf '%s' "$OUT" | grep -q '"decision":"deny"' && bad "neutral script wrongly denied ($OUT)" || ok "neutral wrapped script does not deny"
[ "$OUT" = '{"decision":"ask"}' ] && ok "neutral script emits ask without auto-approving" || bad "neutral script emitted '$OUT' instead of ask"
[ "$RC" -eq 0 ] && ok "neutral path exit 0" || bad "neutral path exit $RC"

# --- RAW: arbitrary stdout must never reach the host's JSON parser --------------
# The shim used to forward the wrapped script's stdout verbatim. A crashed hook could
# therefore push shell noise into a stream the host parses as JSON. Without a stub
# that actually PRINTS something, a partial regression (forward when non-empty, {}
# otherwise) would pass every other assertion in this file.
NOISE_STUB="$SBX/hooks/zz-noise-stub.sh"
cat > "$NOISE_STUB" <<'NOISEEOF'
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s\n' 'bash: line 3: syntax error near unexpected token'
printf '%s\n' 'zz-noise: partial output before the crash' >&2
exit 1
NOISEEOF
chmod +x "$NOISE_STUB"
OUT="$(run zz-noise-stub.sh PreToolUse)"; RC=$?
[ "$OUT" = '{"decision":"ask"}' ] && ok "a diagnostic hook's noisy stdout is replaced by ask" \
                  || bad "RAW branch forwarded the wrapped stdout: '$OUT'"
printf '%s' "$OUT" | grep -q 'syntax error' && bad "the wrapped script's text leaked to stdout" || ok "no wrapped text on stdout"
[ "$RC" -eq 0 ] && ok "a crashed wrapped script still exits 0 (never an accidental deny)" || bad "crashed script exit $RC"
ERRTXT="$(printf '%s' "$PAYLOAD" | bash "$SBSHIM" zz-noise-stub.sh PreToolUse 2>&1 >/dev/null)"
printf '%s' "$ERRTXT" | grep -q 'zz-noise' && ok "the wrapped script's stderr still reaches stderr for debugging" || bad "stderr was swallowed"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
