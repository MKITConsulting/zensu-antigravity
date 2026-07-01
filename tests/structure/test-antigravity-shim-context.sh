#!/usr/bin/env bash
# antigravity-shim.sh CONTEXT translation + per-turn de-bounce (BK5). A wrapped
# PreInvocation hook that emits `hookSpecificOutput.additionalContext` is allowed
# AND its text is carried as Antigravity context. Because PreInvocation fires
# before EVERY model step (not once per user turn), the shim de-bounces: an
# identical (script,context) pair is emitted ONCE per turn and SUPPRESSED on an
# identical re-emit within the same turn; a new prompt is a new turn -> re-emit.
# The context text is unwrapped (no hookSpecificOutput JSON leakage).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
WS="$TMP/ws"; mkdir -p "$WS"

# Sandbox shim tree (drop a user-prompt-* stub that emits additionalContext).
SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/antigravity/"*.js "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/lib/"* "$SBX/hooks/lib/" 2>/dev/null
SBSHIM="$SBX/hooks/antigravity/antigravity-shim.sh"
chmod +x "$SBSHIM" 2>/dev/null

CTX="ZENSU: consider running the /zensu-tdd workflow for this change."
STUB="$SBX/hooks/user-prompt-ctx-stub.sh"
cat > "$STUB" <<STUBEOF
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreInvocation","additionalContext":"$CTX"}}'
STUBEOF
chmod +x "$STUB"

# Antigravity PreInvocation payload carries the user prompt + a workspace root.
payload() { # $1=prompt
  printf '{"prompt":"%s","workspacePaths":["%s"],"session_id":"ctx-sess"}' "$1" "$WS"
}
# Capture via a file (NOT command substitution): the shim's per-turn de-bounce
# keys on zensu_session_key (PPID of the shim process). Running the shim inside
# $(...) would fork a fresh command-substitution subshell as its parent each
# call, giving a different PPID -> different de-bounce key -> false re-emit. A
# plain pipeline keeps the shim's parent = this test script (stable PPID), which
# is exactly how Antigravity spawns the per-turn PreInvocation hooks.
OUTF="$TMP/shimout"
run() { # $1=prompt -> sets OUT
  printf '%s' "$(payload "$1")" > "$TMP/pl"
  bash "$SBSHIM" user-prompt-ctx-stub.sh < "$TMP/pl" > "$OUTF" 2>/dev/null
  OUT="$(cat "$OUTF" 2>/dev/null)"
}

# 1) first emit of the turn carries the context text (unwrapped)
run 'add a slugify helper'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "first call emits the additionalContext text" || bad "first call lacks context: '$OUT'"
printf '%s' "$OUT" | grep -q 'hookSpecificOutput' && bad "context output leaks hookSpecificOutput" || ok "context output is unwrapped (no hookSpecificOutput)"
# the verdict allows the action (allow_tool:true / decision:allow)
printf '%s' "$OUT" | grep -qE '"allow_tool":true|"decision":"allow"' && ok "context verdict allows the action" || bad "context verdict not an allow: '$OUT'"

# 2) identical (script,context) re-emit WITHIN the same turn is SUPPRESSED
run 'add a slugify helper'
if printf '%s' "$OUT" | grep -qF "$CTX"; then
  bad "BK5: identical context re-emitted same turn (de-bounce failed): '$OUT'"
else
  ok "BK5: identical context suppressed on same-turn re-emit"
fi

# 3) a DIFFERENT prompt is a new turn -> context re-emitted
run 'now add a parser'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "BK5: context re-emitted after the prompt changes (new turn)" || bad "context not re-emitted on new prompt: '$OUT'"

# 4) the de-bounce state file is project-scoped under the workspace root
[ -f "$WS/.zensu/state/preinv-"*.txt ] 2>/dev/null && ok "de-bounce marker written under workspace .zensu/state" || {
  # glob may not expand if absent
  if ls "$WS"/.zensu/state/preinv-*.txt >/dev/null 2>&1; then ok "de-bounce marker written under workspace .zensu/state"; else bad "no preinv de-bounce marker under workspace"; fi
}

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
