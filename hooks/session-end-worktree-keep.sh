#!/bin/bash
set -u

_ZENSU_EXECUTED_PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 2
if [ -n "${ZENSU_PLUGIN_ROOT:-}" ]; then
  _ZENSU_DECLARED_PLUGIN_ROOT="$(cd -P -- "$ZENSU_PLUGIN_ROOT" 2>/dev/null && pwd -P)" || {
    echo "zensu- inherited ZENSU_PLUGIN_ROOT does not match the executing plugin" >&2
    exit 2
  }
  if [ "$_ZENSU_DECLARED_PLUGIN_ROOT" != "$_ZENSU_EXECUTED_PLUGIN_ROOT" ]; then
    echo "zensu- inherited ZENSU_PLUGIN_ROOT does not match the executing plugin" >&2
    exit 2
  fi
fi
ZENSU_PLUGIN_ROOT="$_ZENSU_EXECUTED_PLUGIN_ROOT"
unset _ZENSU_EXECUTED_PLUGIN_ROOT _ZENSU_DECLARED_PLUGIN_ROOT
{ INPUT="$(cat)"; } 2>/dev/null
case "$INPUT" in *'.zensu/worktrees'*|*'.zensu\\worktrees'*) ;; *) exit 0 ;; esac
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-agent-context.sh"
zensu_hook_is_main_principal "$INPUT" SessionEnd || exit 0
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-config.sh"
VERB="session-end"
zensu_hook_enabled worktreeKeep || VERB="release"
command -v node >/dev/null 2>&1 || exit 0
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-msys-env.sh"
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-bounded-run.sh"
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-worktree-keep.sh"

zensu_worktree_keep_anchor "$INPUT" || exit 0
ROOT="$ZENSU_WK_ROOT"
SESSION_KEY="$ZENSU_WK_SESSION_KEY"
IDLE_HOURS="$(zensu_worktree_keep_idle_hours 2>/dev/null)" || IDLE_HOURS=72
MSYS_EXCL="$(zensu_msys_env_exclusions WK_CWD 2>/dev/null)" || MSYS_EXCL=""

(
  cd -P -- "${ZENSU_PLUGIN_ROOT}/hooks/lib" 2>/dev/null || exit 0
  export WK_CWD="$ROOT" WK_SESSION_KEY="$SESSION_KEY" WK_IDLE_HOURS="$IDLE_HOURS" WK_EMIT="runtime-hook"
  if [ -n "$MSYS_EXCL" ]; then export MSYS2_ENV_CONV_EXCL="$MSYS_EXCL"; fi
  zensu_run_bounded node ./worktree-keep-v1.js "$VERB" </dev/null
) || true
exit 0
