#!/usr/bin/env bash
# Pointer-first session resolution on Antigravity. The shell
# tool (run_command-launched zensu-log) and the plugin hooks run in DIFFERENT
# process ancestry, so a PPID-keyed cache written by a hook can never match a
# shell-tool caller. Contract (implemented order): explicit id >
# `.zensu/state/session-id-current.txt` (written by lazy-init, the AG
# SessionStart replacement) > transcript helper > PPID-keyed cache > fallback.
# The current file outranks the keyed cache ON PURPOSE.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unset ZENSU_PROJECT_DIR ZENSU_SESSION_ID 2>/dev/null || true
mkdir -p "$TMP/home"; export HOME="$TMP/home"
SID="ag-real-session-uuid-1234"
SHIM="$ROOT/hooks/antigravity/antigravity-shim.sh"
LOG="$ROOT/hooks/lib/zensu-log.sh"

# 1) The shim's lazy-init (fired on a pre-* hook) writes the current-session file
#    from an Antigravity payload carrying the session id. Use a write_to_file
#    payload (a pre-edit hook); the workspace root becomes ZENSU_PROJECT_DIR.
printf '{"toolCall":{"name":"write_to_file","args":{"TargetFile":"%s/src/app.ts"}},"workspacePaths":["%s"],"session_id":"%s"}' "$TMP" "$TMP" "$SID" \
  | bash "$SHIM" pre-edit-tdd-reminder.sh >/dev/null 2>&1
CUR="$TMP/.zensu/state/session-id-current.txt"
[ -f "$CUR" ] && ok "lazy-init wrote session-id-current.txt" || bad "session-id-current.txt missing"
[ "$(cat "$CUR" 2>/dev/null | tr -d '[:space:]')" = "$SID" ] && ok "current file carries the payload sid" || bad "current file content wrong: '$(cat "$CUR" 2>/dev/null)'"

# 2) A model-shell zensu-log call (no --session, no env, different ancestry) must
#    arm the REAL session's state via the current-file lookup.
( cd "$TMP" && ZENSU_PROJECT_DIR="$TMP" bash "$LOG" --tdd-begin >/dev/null 2>&1 )
[ -f "$TMP/.zensu/state/tdd-phase-${SID}.json" ] && ok "shell-tool zensu-log armed the real session state file" || { bad "real-session state file missing"; ls "$TMP/.zensu/state" 2>/dev/null | sed 's/^/      /'; }

# 3) precedence: explicit id wins over the current file.
GOT="$(source "$ROOT/hooks/lib/zensu-session.sh"; ZENSU_PROJECT_DIR="$TMP" zensu_resolve_session_id "explicit-id")"
[ "$GOT" = "explicit-id" ] && ok "explicit id wins over current file" || bad "explicit id lost: got '$GOT'"

# 4) precedence: current file beats the PPID-keyed cache.
KEY="$(source "$ROOT/hooks/lib/zensu-session.sh"; zensu_session_key)"
printf 'keyed-cache-id\n' > "$TMP/.zensu/state/session-id-${KEY}.txt"
GOT="$(source "$ROOT/hooks/lib/zensu-session.sh"; ZENSU_PROJECT_DIR="$TMP" zensu_resolve_session_id "")"
[ "$GOT" = "$SID" ] && ok "current file outranks keyed cache" || bad "keyed cache won: got '$GOT'"
rm -f "$TMP/.zensu/state/session-id-${KEY}.txt"

# 5) Antigravity reality: a payload with NO session_id -> lazy-init SYNTHESIZES a
#    deterministic id (ag-<session-key>) and still writes the current file, so
#    hooks and shell-tool zensu-log converge on one state file.
TMP2="$(mktemp -d)"; mkdir -p "$TMP2"
printf '{"toolCall":{"name":"write_to_file","args":{"TargetFile":"%s/x.ts"}},"workspacePaths":["%s"]}' "$TMP2" "$TMP2" \
  | bash "$SHIM" pre-edit-tdd-reminder.sh >/dev/null 2>&1
CUR2="$TMP2/.zensu/state/session-id-current.txt"
[ -f "$CUR2" ] && ok "no-sid payload: current file still written (synthesized)" || bad "no-sid payload: current file missing"
SYN="$(cat "$CUR2" 2>/dev/null | tr -d '[:space:]')"
printf '%s' "$SYN" | grep -qE '^ag-[A-Za-z0-9_-]{1,}$' && ok "synthesized id has the ag- prefix ('$SYN')" || bad "synthesized id malformed: '$SYN'"
rm -rf "$TMP2"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
