#!/bin/bash

zensu_session_key() {
  local proc_start proc_hash
  proc_start="$(ps -o lstart= -p "$PPID" 2>/dev/null)"
  if [ -n "$proc_start" ]; then
    proc_hash="$(printf '%s' "$proc_start" | cksum 2>/dev/null | cut -d' ' -f1)"
  fi
  if [ -n "${proc_hash:-}" ]; then
    echo "${PPID}_${proc_hash}"
  else
    echo "${PPID}"
  fi
}

# Cwd-independent project-dir recovery, reusing the same project-scoped pointer
# (`.zensu/state/session-id-current.txt`) that zensu_resolve_session_id consults.
# Antigravity exports the project dir to HOOKS only, so a state writer launched
# through the shell tool has to recover it or it anchors chain state to the
# caller's cwd — the wrong directory whenever the shell sits in a subdirectory or
# a worktree. Echoes ZENSU_PROJECT_DIR unchanged when it is already set, so
# hook-side callers keep their exact current behavior.
zensu_resolve_project_dir() {
  local start="${1:-$PWD}"
  if [ -n "${ZENSU_PROJECT_DIR:-}" ]; then
    echo "$ZENSU_PROJECT_DIR"
    return 0
  fi

  local helper_root="${ZENSU_PLUGIN_ROOT:-}"
  if [ -z "$helper_root" ]; then
    helper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
  fi
  local helper="${helper_root}/hooks/lib/resolve-project-dir.js"
  if [ -f "$helper" ] && command -v node >/dev/null 2>&1; then
    local out
    out="$(node "$helper" "$start" 2>/dev/null)"
    out="${out//$'\n'/}"
    out="${out//$'\r'/}"
    if [ -n "$out" ] && [ -d "$out" ]; then
      echo "$out"
      return 0
    fi
  fi

  # Node-free fallback: the same nearest-ancestor pointer walk in pure shell, so
  # a missing node degrades to the identical answer instead of the wrong dir.
  local dir depth=0
  dir="$(cd "$start" 2>/dev/null && pwd)" || dir="$start"
  while [ "$depth" -lt 64 ]; do
    if [ -f "${dir}/.zensu/state/session-id-current.txt" ]; then
      echo "$dir"
      return 0
    fi
    case "$dir" in
      /|'') break ;;
    esac
    dir="$(dirname "$dir")"
    depth=$((depth + 1))
  done

  dir="$(cd "$start" 2>/dev/null && pwd)" || dir="$start"
  depth=0
  while [ "$depth" -lt 64 ]; do
    if [ -d "${dir}/.zensu/state" ]; then
      echo "$dir"
      return 0
    fi
    case "$dir" in
      /|'') break ;;
    esac
    dir="$(dirname "$dir")"
    depth=$((depth + 1))
  done

  cd "$start" 2>/dev/null && pwd && return 0
  echo "$start"
}

zensu_resolve_session_via_helper() {
  local helper_root="${ZENSU_PLUGIN_ROOT:-}"
  if [ -z "$helper_root" ]; then
    helper_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
  fi
  local helper="${helper_root}/hooks/lib/resolve-session-id.js"
  [ -f "$helper" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  local out
  out="$(node "$helper" "${ZENSU_BASH_START:-}" 2>/dev/null)"
  out="${out//$'\n'/}"
  out="${out//$'\r'/}"
  if [ -n "$out" ]; then
    local sanitized="${out//[^A-Za-z0-9_-]/_}"
    if [ -n "$sanitized" ]; then
      echo "$sanitized"
      return 0
    fi
  fi
  return 1
}

zensu_resolve_session_id() {
  local from_json="${1:-}"
  local sanitized key cache cached helper_out
  if [ -n "$from_json" ]; then
    sanitized="${from_json//[^A-Za-z0-9_-]/_}"
    if [ -n "$sanitized" ]; then
      echo "$sanitized"
      return 0
    fi
  fi
  # The project-scoped current-session file — written by the lazy-init
  # capture hook — outranks the transcript helper. The helper would otherwise
  # return the (possibly live-changing) newest transcript id and detach the
  # armed session state mid-session. Explicit ids keep absolute precedence
  # above.
  cache="${ZENSU_PROJECT_DIR:-.}/.zensu/state/session-id-current.txt"
  if [ -f "$cache" ]; then
    cached="$(cat "$cache" 2>/dev/null)"
    cached="${cached//$'\n'/}"
    cached="${cached//$'\r'/}"
    sanitized="${cached//[^A-Za-z0-9_-]/_}"
    if [ -n "$sanitized" ]; then
      echo "$sanitized"
      return 0
    fi
  fi
  if helper_out="$(zensu_resolve_session_via_helper)"; then
    if [ -n "$helper_out" ]; then
      echo "$helper_out"
      return 0
    fi
  fi
  key="$(zensu_session_key)"
  cache="${ZENSU_PROJECT_DIR:-.}/.zensu/state/session-id-${key}.txt"
  if [ -f "$cache" ]; then
    cached="$(cat "$cache" 2>/dev/null)"
    cached="${cached//$'\n'/}"
    cached="${cached//$'\r'/}"
    sanitized="${cached//[^A-Za-z0-9_-]/_}"
    if [ -n "$sanitized" ]; then
      echo "$sanitized"
      return 0
    fi
  fi
  echo "fallback_${key}"
}

export -f zensu_session_key zensu_resolve_project_dir zensu_resolve_session_via_helper zensu_resolve_session_id 2>/dev/null || true
