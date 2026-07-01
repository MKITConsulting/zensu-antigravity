#!/bin/bash
# antigravity-shim.sh — the single engine-translation layer between Antigravity
# hooks and the engine-neutral zensu hook scripts. hooks.json registers every
# hook as `bash <ZENSU_HOME>/hooks/antigravity/antigravity-shim.sh <script>.sh`;
# the wrapped scripts read a flat, normalized payload and stay engine-neutral.
#
# Pipeline:
#   1. resolve plugin root from $0; export ZENSU_PLUGIN_ROOT / ANTIGRAVITY_PLUGIN_ROOT
#   2. normalize-payload.js : Antigravity toolCall.* (camelCase) -> flat
#      snake_case; line 1 = workspace root -> exported as ZENSU_PROJECT_DIR so
#      project state anchors on the workspace, NOT the command cwd
#   3. lazy-init.sh (pre-* only) : SessionStart replacement (pin plugin-root,
#      capture session id)
#   4. run the wrapped script on the normalized payload
#   5. classify its stdout -> deny | context | block | raw
#   6. emit-verdict.js : top-level Antigravity JSON; always exit 0 (exit 2 only
#      when ZENSU_AG_HOOK_CONTRACT=exit on a deny)
#
# Fail-open everywhere: a missing/broken wrapped script, missing node, or a parse
# error must never break the host session, and a CRASHED wrapped script (rc!=0
# with partial output) is classified RAW -> allowed (the shim never surfaces the
# wrapped exit code, so a syntax error can't become an accidental deny). This is
# a convention-nudge posture: the gates are not a security boundary.
set -u

SHIM_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SHIM_DIR/../.." && pwd)"
export ZENSU_PLUGIN_ROOT="$ROOT"
export ANTIGRAVITY_PLUGIN_ROOT="$ROOT"

SCRIPT_NAME="${1:-}"
[ -z "$SCRIPT_NAME" ] && exit 0
# $1 must be a BARE script name (hooks.json renders bare names; a path here means
# a mis-rendered template — fail-open rather than resolve outside hooks/).
case "$SCRIPT_NAME" in */*) exit 0 ;; esac
SCRIPT="$ROOT/hooks/$SCRIPT_NAME"
[ -f "$SCRIPT" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

RAW="$(cat 2>/dev/null || true)"

# --- 2. normalize ---------------------------------------------------------
NORM="$(printf '%s' "$RAW" | node "$SHIM_DIR/normalize-payload.js" 2>/dev/null || true)"
WS_ROOT="$(printf '%s\n' "$NORM" | sed -n '1p')"
PAYLOAD="$(printf '%s\n' "$NORM" | sed -n '2p')"
# fail-open: if normalize produced nothing usable, pass the raw payload through
[ -z "$PAYLOAD" ] && PAYLOAD="$RAW"

# Export the workspace root as the project dir (BK6): the source-write-gate's
# cross-worktree escape check needs projectRoot (workspace) != curdir (command
# cwd). zensu_runtime_apply_project_dir is a no-op once this is set.
if [ -n "$WS_ROOT" ] && [ -d "$WS_ROOT" ]; then
  export ZENSU_PROJECT_DIR="$WS_ROOT"
fi

# --- 3. lazy-init (SessionStart replacement; pre-* hooks only) -------------
case "$SCRIPT_NAME" in
  pre-*|user-prompt-*)
    printf '%s' "$PAYLOAD" | bash "$SHIM_DIR/lazy-init.sh" >/dev/null 2>&1 || true
    ;;
esac

# --- 4. run the wrapped script ----------------------------------
CAP_DIR="$(mktemp -d 2>/dev/null)" || exit 0
OUT_FILE="$CAP_DIR/out"
ERR_FILE="$CAP_DIR/err"
printf '%s' "$PAYLOAD" | bash "$SCRIPT" >"$OUT_FILE" 2>"$ERR_FILE" || true
OUT="$(cat "$OUT_FILE" 2>/dev/null || true)"
ERR="$(cat "$ERR_FILE" 2>/dev/null || true)"
rm -rf "$CAP_DIR" 2>/dev/null || true

# --- 5. classify the wrapped stdout ---------------------------------------
# Prints "<kind>\n<text>": deny | context | block | raw
VERDICT="$(SHIM_OUT="$OUT" node -e '
  const raw = process.env.SHIM_OUT || "";
  const trimmed = raw.trim();
  let kind = "raw", text = "";
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed);
      const hso = j && j.hookSpecificOutput;
      if (hso && hso.permissionDecision === "deny") {
        kind = "deny";
        text = (typeof hso.permissionDecisionReason === "string" && hso.permissionDecisionReason)
          ? hso.permissionDecisionReason : "zensu hook denied this tool call.";
      } else if (j && j.decision === "block") {
        kind = "block";
        text = (typeof j.reason === "string" && j.reason) ? j.reason : "zensu blocked stopping.";
      } else if (hso && typeof hso.additionalContext === "string" && hso.additionalContext) {
        kind = "context";
        text = hso.additionalContext;
      }
    } catch (_) { /* not JSON -> raw */ }
  }
  process.stdout.write(kind + "\n" + text);
' 2>/dev/null || printf 'raw\n')"

KIND="$(printf '%s' "$VERDICT" | sed -n '1p')"
TEXT="$(printf '%s' "$VERDICT" | sed -n '2,$p')"

emit() { ZV_ROLE="$1" ZV_TEXT="$2" node "$SHIM_DIR/emit-verdict.js" 2>/dev/null; }

# Per-turn de-bounce for context injection (BK5): PreInvocation fires before
# EVERY model step, so an advisory hook would re-inject the same directive on
# every tool round. Suppress an identical (script,context) pair within the same
# user turn (turn marker = hash of the prompt). New prompt -> new turn -> re-emit.
shim_context_first_this_turn() {
  local script="$1" text="$2"
  command -v cksum >/dev/null 2>&1 || return 0
  source "$ROOT/hooks/lib/zensu-session.sh" 2>/dev/null || return 0
  local sid prompt turn sig f stored
  sid="$(zensu_session_key 2>/dev/null)"; [ -z "$sid" ] && return 0
  prompt="$(printf '%s' "$PAYLOAD" | node -e '
    let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
    try{const j=JSON.parse(s||"{}");process.stdout.write(typeof j.prompt==="string"?j.prompt:"");}catch(_){}});' 2>/dev/null)"
  turn="$(printf '%s' "$prompt" | cksum 2>/dev/null | cut -d' ' -f1)"
  sig="$(printf '%s\x1f%s' "$script" "$text" | cksum 2>/dev/null | cut -d' ' -f1)"
  f="${ZENSU_PROJECT_DIR:-.}/.zensu/state/preinv-${sid}.txt"
  mkdir -p "$(dirname "$f")" 2>/dev/null || return 0
  stored="$(sed -n '1p' "$f" 2>/dev/null || true)"
  if [ "$stored" != "turn:$turn" ]; then
    printf 'turn:%s\n%s\n' "$turn" "$sig" > "$f" 2>/dev/null || return 0
    return 0
  fi
  grep -qxF "$sig" "$f" 2>/dev/null && return 1
  printf '%s\n' "$sig" >> "$f" 2>/dev/null
  return 0
}

case "$KIND" in
  deny)
    emit deny "$TEXT"; echo
    [ "${ZENSU_AG_HOOK_CONTRACT:-superset}" = "exit" ] && exit 2
    exit 0
    ;;
  block)
    emit block "$TEXT"; echo
    exit 0
    ;;
  context)
    if shim_context_first_this_turn "$SCRIPT_NAME" "$TEXT"; then
      emit context "$TEXT"; echo
    fi
    exit 0
    ;;
  *)
    # RAW fail-open: pass output through but NEVER surface the wrapped script's
    # exit code (a crashed hook must not become an accidental deny).
    [ -n "$OUT" ] && printf '%s\n' "$OUT"
    [ -n "$ERR" ] && printf '%s\n' "$ERR" >&2
    exit 0
    ;;
esac
