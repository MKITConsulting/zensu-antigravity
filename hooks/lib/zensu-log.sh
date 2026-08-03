#!/bin/bash
set -u
export ZENSU_BASH_START="${ZENSU_BASH_START:-}"
: "${ZENSU_PLUGIN_ROOT:=$(cd "$(dirname "$0")/../.." && pwd)}"
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-config.sh"

# Project-dir choke point for the state verbs.
#
# Antigravity exports ZENSU_PROJECT_DIR to HOOKS only (the shim derives it from
# the tool payload's workspace root). A state verb launched through the shell
# tool inherits nothing, so `${ZENSU_PROJECT_DIR:-.}` used to resolve to the
# terminal's cwd — and from a subdirectory or a worktree that anchored the chain
# state to the WRONG directory, leaving the Stop-hook enforcer waiting on a flag
# written somewhere else. Recover it once, here, before any session id or state
# path is derived. No-op when the variable is already set.
case "${1:-}" in
  --*)
    if [ -z "${ZENSU_PROJECT_DIR:-}" ]; then
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      _zensu_pd="$(zensu_resolve_project_dir 2>/dev/null || true)"
      if [ -n "${_zensu_pd:-}" ] && [ -d "$_zensu_pd" ]; then
        export ZENSU_PROJECT_DIR="$_zensu_pd"
      fi
      unset _zensu_pd
    fi
    ;;
esac

case "${1:-}" in
  --phase)
    phase_val=""
    step_val=""
    session_val=""
    reason_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --phase)   phase_val="${2:-}";   shift 2 || break ;;
        --step)    step_val="${2:-}";    shift 2 || break ;;
        --session) session_val="${2:-}"; shift 2 || break ;;
        --reason)  reason_val="${2:-}";  shift 2 || break ;;
        *) shift ;;
      esac
    done
    if [ -z "$phase_val" ]; then
      echo "zensu-log.sh --phase requires a phase value" >&2
      exit 2
    fi
    if [ -z "$session_val" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash $0 --phase $phase_val --step $step_val}"
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"
    tdd_write_phase "$session_val" "$step_val" "$phase_val" "$reason_val"
    exit $?
    ;;
  --mode)
    session_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --session) session_val="${2:-}"; shift 2 || break ;;
        *) shift ;;
      esac
    done
    if [ -z "$session_val" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash $0 --mode}"
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"
    if [ "$(tdd_vanilla_mode "$(tdd_state_file "$session_val")")" = "true" ]; then
      echo "vanilla"
    else
      echo "strict"
    fi
    exit 0
    ;;
  --bypass-note)
    # Write verb of the bypass ledger: record that a gate was deliberately opted
    # out of. Gate names only, closed allowlist, scoped to an active session.
    gate_val=""
    session_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --bypass-note) gate_val="${2:-}";    shift 2 || break ;;
        --session)     session_val="${2:-}"; shift 2 || break ;;
        *) shift ;;
      esac
    done
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-bypass-ledger.sh"
    if ! zensu_bypass_shape_ok "$gate_val"; then
      echo "zensu-log.sh --bypass-note requires a known gate name (one of: $ZENSU_BYPASS_GATE_ALLOWLIST)" >&2
      exit 2
    fi
    if [ -z "$session_val" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash $0 --bypass-note $gate_val}"
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
    zensu_bypass_record "$session_val" "$gate_val"
    exit $?
    ;;
  --bypass-list)
    # Read verb of the bypass ledger — the surface the chain-end summary renders.
    # Prints the recorded gates (comma separated) or the literal `none`.
    session_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --session) session_val="${2:-}"; shift 2 || break ;;
        *) shift ;;
      esac
    done
    if [ -z "$session_val" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash $0 --bypass-list}"
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-bypass-ledger.sh"
    bypass_list="$(zensu_bypass_list "$(tdd_state_file "$session_val")")"
    if [ -n "$bypass_list" ]; then
      echo "Gates bypassed during this session: $bypass_list"
    else
      echo "none"
    fi
    exit 0
    ;;
  --pending-review|--pending-review-done)
    verb="$1"
    files_val=""
    summary_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --files)   files_val="${2:-}";   shift 2 || break ;;
        --summary) summary_val="${2:-}"; shift 2 || break ;;
        *) shift ;;
      esac
    done
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"
    case "$verb" in
      --pending-review)      tdd_write_pending_review "$files_val" "$summary_val" ;;
      --pending-review-done) tdd_clear_pending_review ;;
    esac
    exit $?
    ;;
  --tdd-begin|--tdd-complete|--chain-done|--code-review-done|--self-review-fixed|--tdd-reset|--workflow-begin|--workflow-end)
    verb="$1"
    session_val=""
    tools_val=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --session) session_val="${2:-}"; shift 2 || break ;;
        --tools)   tools_val="${2:-}";   shift 2 || break ;;
        *) shift ;;
      esac
    done
    if [ -z "$session_val" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash $0 $verb}"
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-bypass-ledger.sh"
    case "$verb" in
      --tdd-begin)
        # The bypass ledger is per run: report anything the outgoing run opted
        # out of (so a multi-run union keeps a durable trace) and start clean.
        outgoing_bypasses="$(zensu_bypass_list "$(tdd_state_file "$session_val")" 2>/dev/null)"
        if [ -n "$outgoing_bypasses" ]; then
          echo "previous-run bypasses (cleared now): $outgoing_bypasses"
        fi
        zensu_bypass_clear "$session_val" 2>/dev/null || true
        tdd_set_flag "$session_val" active true
        tdd_begin_rc=$?
        if [ "$tdd_begin_rc" -eq 0 ]; then
          if zensu_tdd_strict_enabled; then
            if ! tdd_set_flag "$session_val" vanilla false; then
              echo "zensu-log --tdd-begin: strict flag write failed — a stale vanilla flag may remain" >&2
              tdd_begin_rc=1
            fi
          elif ! tdd_set_flag "$session_val" vanilla true; then
            echo "zensu-log --tdd-begin: vanilla flag write failed — session runs strict" >&2
            tdd_begin_rc=1
          fi
          if [ "$(tdd_vanilla_mode "$(tdd_state_file "$session_val")")" = "true" ]; then
            echo "mode: vanilla"
          else
            echo "mode: strict"
          fi
        else
          echo "zensu-log --tdd-begin: active flag write failed — session NOT activated" >&2
        fi
        rounds_state_dir="${ZENSU_PLUGIN_DATA_OVERRIDE:-${ZENSU_PROJECT_DIR:-.}/.zensu/state}"
        rounds_counter_file="${rounds_state_dir}/rounds-${session_val}.json"
        if [ -L "$rounds_counter_file" ]; then
          echo "zensu-log --tdd-begin: refusing to delete through symlink at $rounds_counter_file — rounds counter NOT reset" >&2
        elif [ -L "$rounds_state_dir" ]; then
          echo "zensu-log --tdd-begin: refusing to reset under symlinked state dir $rounds_state_dir — rounds counter NOT reset" >&2
        else
          rm -f -- "$rounds_counter_file"
        fi
        exit "$tdd_begin_rc"
        ;;
      --tdd-complete) tdd_set_flag "$session_val" implComplete true ;;
      --chain-done)   tdd_set_flag "$session_val" chainDone true ;;
      --code-review-done)  tdd_set_flag "$session_val" codeReviewDone true ;;
      --self-review-fixed) tdd_set_flag "$session_val" selfReviewFixed true ;;
      --workflow-begin)
        tdd_workflow_begin "$session_val" "$tools_val"
        ;;
      --workflow-end)   tdd_set_flag "$session_val" workflowActive false ;;
      --tdd-reset)
        tdd_clear_session "$session_val"
        tdd_reset_rc=$?
        zensu_bypass_clear "$session_val" 2>/dev/null || true
        exit "$tdd_reset_rc"
        ;;
    esac
    exit $?
    ;;
esac

cmd="${1:-timestamp}"
case "$cmd" in
  timestamp)
    start="${2:-$(date +%s)}"
    case "$start" in
      ''|*[!0-9]*) start=$(date +%s) ;;
    esac
    style=$(_zensu_log_style)
    case "$style" in
      none)
        printf ""
        ;;
      relative)
        now=$(date +%s)
        diff=$((now - 10#$start))
        [ "$diff" -lt 0 ] && diff=0
        if [ "$diff" -lt 86400 ]; then
          printf "[+%02d:%02d:%02d] " $((diff/3600)) $(((diff%3600)/60)) $((diff%60))
        else
          days=$((diff/86400))
          rem=$((diff%86400))
          printf "[+%dd %02d:%02d:%02d] " "$days" $((rem/3600)) $(((rem%3600)/60)) $((rem%60))
        fi
        ;;
      *)
        printf "[%s] " "$(date +%H:%M:%S)"
        ;;
    esac
    ;;
  style)
    _zensu_log_style
    ;;
  *)
    echo "usage: zensu-log.sh {timestamp <epoch> | style}" >&2
    exit 2
    ;;
esac
