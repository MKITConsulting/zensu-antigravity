#!/bin/bash
# lazy-init.sh — SessionStart replacement. Antigravity exposes no SessionStart
# event to plugin hooks.json, so the shim fires this on the first pre-* hook of a
# turn to do the two things CC's session-start hooks did as a side-effect:
#   1. pin ~/.zensu/plugin-root (so skills/hooks resolve the plugin root by pointer)
#   2. capture the session id into the project-scoped pointer files so that
#      run_command-launched `zensu-log.sh` calls and the hooks agree on ONE sid.
#
# Idempotent and cheap: safe to run on every pre-* call. Reads the (normalized)
# payload on stdin. CLAUDE_PROJECT_DIR is already exported by the shim from the
# workspace root. Fail-open everywhere — never breaks the host session.
set -u

: "${CLAUDE_PLUGIN_ROOT:=${ZENSU_PLUGIN_ROOT:-${ANTIGRAVITY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}}}"

# 1. pin the plugin-root pointer
mkdir -p "$HOME/.zensu" 2>/dev/null || true
_cur="$(cat "$HOME/.zensu/plugin-root" 2>/dev/null || true)"
if [ "$_cur" != "$CLAUDE_PLUGIN_ROOT" ]; then
  printf '%s\n' "$CLAUDE_PLUGIN_ROOT" > "$HOME/.zensu/plugin-root" 2>/dev/null || true
fi

PAYLOAD="$(cat 2>/dev/null || true)"
command -v node >/dev/null 2>&1 || exit 0
[ -f "${CLAUDE_PLUGIN_ROOT}/hooks/lib/zensu-session.sh" ] || exit 0
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/zensu-session.sh" 2>/dev/null || exit 0

SID="$(printf '%s' "$PAYLOAD" | node -e '
  let s = "";
  process.stdin.on("data", c => s += c);
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s || "{}");
      process.stdout.write((typeof j.session_id === "string" && j.session_id) ? j.session_id : "");
    } catch (_) {}
  });
' 2>/dev/null)"

# Antigravity pre-tool payloads may carry no session_id. Synthesize a
# deterministic id from the session key (PPID-based, STABLE across the turn's
# concurrent hook subprocesses — NOT $$, which differs per shim process and would
# let three first-calls write three different ids).
if [ -z "$SID" ]; then
  SID="ag-$(zensu_session_key)"
fi

CACHE_DIR="${CLAUDE_PROJECT_DIR:-.}/.zensu/state"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

_write_atomic() {
  local target="$1" value="$2" tmp
  tmp="$(mktemp "${target}.XXXXXX" 2>/dev/null)" || return 0
  if printf '%s\n' "$value" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$target" 2>/dev/null || rm -f "$tmp" 2>/dev/null
  else
    rm -f "$tmp" 2>/dev/null
  fi
}

# Project-scoped "current session" pointer (consulted first by
# zensu_resolve_session_id, above the transcript helper + keyed cache) and the
# keyed cache itself.
KEY="$(zensu_session_key)"
_write_atomic "$CACHE_DIR/session-id-current.txt" "$SID"
_write_atomic "$CACHE_DIR/session-id-${KEY}.txt" "$SID"
exit 0
