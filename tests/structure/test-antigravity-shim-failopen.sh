#!/usr/bin/env bash
# Standalone shim diagnostics preserve native permission handling on failures.
# Registered production chains have separate fail-closed coverage. An empty
# PreToolUse object is a native denial, so exact ask output is required here.
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

PAYLOAD='{"toolCall":{"name":"run_command","args":{"CommandLine":"echo hi"}}}'
denies() { printf '%s' "$1" | grep -qE '"allow_tool":false|"decision":"deny"'; }
asks() { [ "$(cat "$TMP/o")" = '{"decision":"ask"}' ] && ok "$1: explicit native permission decision" || bad "$1: missing explicit ask: $(cat "$TMP/o")"; }

# 1) unknown wrapped script -> exit 0, silent, no deny
printf '%s' "$PAYLOAD" | bash "$SBSHIM" no-such-hook.sh PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "unknown wrapped script: exit 0" || bad "unknown script exit $RC"
denies "$(cat "$TMP/o")" && bad "unknown script produced a DENY" || ok "unknown script does not deny"
asks "unknown diagnostic script"

# 2) shim with NO script arg -> exit 0
printf '%s' "$PAYLOAD" | bash "$SBSHIM" > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "no script arg: exit 0" || bad "no-arg exit $RC"

# 3) a script arg containing '/' (mis-rendered template) -> exit 0, never
#    resolves outside hooks/ (BK1 safety)
printf '%s' "$PAYLOAD" | bash "$SBSHIM" ../../../etc/passwd PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "slash-bearing \$1: exit 0 (refuses to resolve outside hooks/)" || bad "slash \$1 exit $RC"
denies "$(cat "$TMP/o")" && bad "slash \$1 produced a DENY" || ok "slash \$1 does not deny"
asks "invalid diagnostic script path"

# 4) BROKEN wrapped script (rc 2 from a runtime error) -> exit 0, NOT a deny;
#    stderr passes through (raw branch).
STUB="$SBX/hooks/zz-broken.sh"
printf '#!/bin/bash\ncat >/dev/null 2>&1 || true\necho "diagnostic noise" >&2\nexit 2\n' > "$STUB"; chmod +x "$STUB"
printf '%s' "$PAYLOAD" | bash "$SBSHIM" zz-broken.sh PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "crashing wrapped script (rc 2): shim exits 0 (NOT an accidental deny)" || bad "crashing script -> shim exit $RC (accidental deny!)"
denies "$(cat "$TMP/o")" && bad "crashing script produced a DENY" || ok "crashing script does not deny"
asks "crashed diagnostic script"
grep -qF "diagnostic noise" "$TMP/e" && ok "raw branch passes wrapped stderr through" || bad "raw branch swallowed stderr"

# 5) SYNTAX-ERROR wrapped script -> exit 0, NOT a deny
printf '#!/bin/bash\nif [ broken-syntax\n' > "$STUB"
printf '%s' "$PAYLOAD" | bash "$SBSHIM" zz-broken.sh PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "syntax-error wrapped script: shim exits 0" || bad "syntax-error script -> shim exit $RC (accidental deny!)"
denies "$(cat "$TMP/o")" && bad "syntax-error script produced a DENY" || ok "syntax-error script does not deny"
asks "syntax-error diagnostic script"

# 6) a wrapped script that emits GARBAGE (non-JSON) stdout -> RAW passthrough,
#    exit 0, no deny
printf '#!/bin/bash\ncat >/dev/null 2>&1 || true\necho "this is not json at all"\n' > "$STUB"; chmod +x "$STUB"
printf '%s' "$PAYLOAD" | bash "$SBSHIM" zz-broken.sh PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
[ "$RC" -eq 0 ] && ok "garbage stdout: exit 0 (RAW passthrough)" || bad "garbage stdout exit $RC"
denies "$(cat "$TMP/o")" && bad "garbage stdout produced a DENY" || ok "garbage stdout does not deny"
asks "non-JSON diagnostic output"

# 7) missing node -> exit 0, silent (PATH stripped of node)
EMPTYBIN="$TMP/empty"; mkdir -p "$EMPTYBIN"
for t in bash cat printf sed mktemp rm dirname; do
  p="$(command -v "$t" 2>/dev/null)"; [ -n "$p" ] && ln -s "$p" "$EMPTYBIN/$t" 2>/dev/null
done
if [ -x "$EMPTYBIN/bash" ]; then
  printf '%s' "$PAYLOAD" | env -i HOME="$HOME" PATH="$EMPTYBIN" "$EMPTYBIN/bash" "$SBSHIM" zz-broken.sh PreToolUse > "$TMP/o" 2>"$TMP/e"; RC=$?
  [ "$RC" -eq 0 ] && ok "missing node: shim exits 0 (fail-open, no parse)" || bad "missing-node exit $RC"
  denies "$(cat "$TMP/o")" && bad "missing-node produced a DENY" || ok "missing-node does not deny"
  asks "missing-node diagnostic path"
else
  ok "skipped: minimal-PATH sandbox not reproducible here (covered on Linux CI)"
  ok "skipped: missing-node deny check (covered on Linux CI)"
fi

# Positive control. Every assertion above is of the form "this does NOT deny"; with
# no case that DOES deny, a regression that silences the deny path entirely would
# leave the whole suite green. This proves the deny path is reachable at all.
CTRL="$SBX/hooks/zz-ctrl-deny.sh"
cat > "$CTRL" <<'CTRLEOF'
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"control"}}'
CTRLEOF
chmod +x "$CTRL"
printf '%s' "$PAYLOAD" | bash "$SBSHIM" zz-ctrl-deny.sh PreToolUse > "$TMP/o" 2>/dev/null
if denies "$(cat "$TMP/o")"; then
  ok "positive control: a real deny DOES reach the host (every check above can therefore fail)"
else
  bad "positive control FAILED — the deny path is unreachable, so every 'does not deny' check above is vacuous: $(cat "$TMP/o")"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
