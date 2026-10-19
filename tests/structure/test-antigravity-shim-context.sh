#!/usr/bin/env bash
# antigravity-shim.sh CONTEXT translation + per-turn de-bounce (BK5). A wrapped
# PreInvocation hook that emits `hookSpecificOutput.additionalContext` has its
# text injected into the model's context. On this host that means the
# PreInvocation dialect — {"injectSteps":[{"ephemeralMessage":"..."}]} — NOT an
# allow verdict; an allow/additionalContext object is silently ignored here, which
# is why no zensu advisory ever reached the model before this was fixed.
# Because PreInvocation fires before EVERY model step (not once per user turn),
# the shim de-bounces: an identical (script,context) pair is emitted ONCE per turn
# and SUPPRESSED on an identical re-emit within the same turn; a new prompt is a
# new turn -> re-emit. A suppressed call still emits the empty verdict {}.
# The context text is unwrapped (no hookSpecificOutput JSON leakage).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; TMP="$(cd "$TMP" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
WS="$TMP/ws"; mkdir -p "$WS"
export ZENSU_PLUGIN_DATA="$TMP/private"; mkdir -m 700 "$ZENSU_PLUGIN_DATA"
SID=ctx-sess

# Sandbox shim tree (drop a user-prompt-* stub that emits additionalContext).
SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
for name in normalize-payload.js emit-verdict.js session-paths.js; do cp "$ROOT/hooks/antigravity/$name" "$SBX/hooks/antigravity/"; done
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
  printf '{"prompt":"%s","workspacePaths":["%s"],"session_id":"%s"}' "$1" "$WS" "$SID"
}
# Capture by file to inspect each verdict. De-bounce keys come from the explicit
# native conversation identity and prompt text, independently of process PPID.
OUTF="$TMP/shimout"
run() { # $1=prompt -> sets OUT
  printf '%s' "$(payload "$1")" > "$TMP/pl"
  bash "$SBSHIM" user-prompt-ctx-stub.sh PreInvocation < "$TMP/pl" > "$OUTF" 2>/dev/null
  OUT="$(cat "$OUTF" 2>/dev/null)"
}

# 1) first emit of the turn carries the context text (unwrapped)
run 'add a slugify helper'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "first call emits the additionalContext text" || bad "first call lacks context: '$OUT'"
printf '%s' "$OUT" | grep -q 'hookSpecificOutput' && bad "context output leaks hookSpecificOutput" || ok "context output is unwrapped (no hookSpecificOutput)"
# the advisory travels in the host's PreInvocation dialect, not as a verdict
printf '%s' "$OUT" | grep -q '"injectSteps"' && ok "advisory uses the host injectSteps dialect" || bad "no injectSteps in the advisory: '$OUT'"
printf '%s' "$OUT" | grep -q '"ephemeralMessage"' && ok "advisory carried as an ephemeralMessage step" || bad "no ephemeralMessage step: '$OUT'"
printf '%s' "$OUT" | grep -qE '"allow_tool"|"additionalContext"' && bad "advisory still emits a retired key: '$OUT'" || ok "advisory free of the retired allow_tool/additionalContext keys"
printf '%s' "$OUT" | grep -q '"decision"' && bad "PreInvocation must not emit a tool decision: '$OUT'" || ok "PreInvocation emits no tool decision"

# 2) identical (script,context) re-emit WITHIN the same turn is SUPPRESSED
run 'add a slugify helper'
if printf '%s' "$OUT" | grep -qF "$CTX"; then
  bad "BK5: identical context re-emitted same turn (de-bounce failed): '$OUT'"
else
  ok "BK5: identical context suppressed on same-turn re-emit"
fi
[ "$OUT" = "{}" ] && ok "a suppressed re-emit still emits the empty verdict" || bad "suppressed re-emit emitted '$OUT' instead of {}"

# 3) a DIFFERENT prompt is a new turn -> context re-emitted
run 'now add a parser'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "BK5: context re-emitted after the prompt changes (new turn)" || bad "context not re-emitted on new prompt: '$OUT'"

# 4) Private data stores opaque conversation hashes; workspace files cannot
# suppress a policy advisory or collide after punctuation sanitization.
if ls "$ZENSU_PLUGIN_DATA"/advisory-turns/*.json >/dev/null 2>&1; then
  ok "de-bounce record written to private adapter data"
else bad "missing private advisory record"; fi
[ ! -e "$WS/.zensu/state" ] && ok "workspace carries no advisory authority" || bad "advisory state leaked into workspace"
SID=ctx:sess; run 'same prompt'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "first punctuated conversation receives context" || bad "punctuated conversation lost context"
SID=ctx_sess; run 'same prompt'
printf '%s' "$OUT" | grep -qF "$CTX" && ok "distinct raw conversation cannot collide with punctuation replacement" || bad "conversation keys collided"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
