#!/bin/bash
# Durable orchestration state for /zensu-autopilot.
#
# An autopilot run is long: plan -> implement -> gates -> PR -> team review ->
# fix findings -> validate. That easily outlives one session (a context
# compaction, a crash, a user who closes the IDE). Without durable state the run
# restarts from zero and re-does irreversible-ish work (a second PR, a second
# team review). This file is the run's memory: a single project-local JSON
# document holding the stage, the run identity, the artifacts produced so far,
# and an append-only event trail.
#
# Design rules:
#   - ONE state document per session, under the same state dir as the TDD chain
#     state, so a project's zensu runtime state stays in one place.
#   - Every mutation is serialized through the shared state lock and lands via
#     mktemp + atomic rename, so concurrent writers never interleave and a
#     reader never observes a half-written document.
#   - FAIL OPEN. Durable state is an accelerator for resuming a run, never a
#     gate on it. A missing, unreadable, or corrupt document reports "no durable
#     run" (rc 1, no output) instead of aborting; the skill then re-plans. A
#     corrupt document is quarantined rather than silently overwritten so the
#     evidence survives.
#
# Usable two ways:
#   source .../zensu-autopilot-state.sh   -> autopilot_* shell functions
#   bash   .../zensu-autopilot-state.sh <verb> [flags]  -> CLI for skills

set -u

: "${ZENSU_PLUGIN_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Reuse the hardened lock + state-dir resolution from the TDD chain state.
# shellcheck source=hooks/lib/zensu-tdd-phase.sh
# shellcheck disable=SC1091
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh"

# Ordered lifecycle. A run advances forward through these; BLOCKED and
# CANCELLED are terminal side exits reachable from any stage.
AUTOPILOT_STAGES="PLANNING IMPLEMENTING GATES PR_OPEN TEAM_REVIEW FIX_FINDINGS VALIDATE DONE BLOCKED CANCELLED"

autopilot_state_dir() {
  echo "${ZENSU_AUTOPILOT_STATE_DIR:-${TDD_STATE_DIR:-${ZENSU_PROJECT_DIR:-.}/.zensu/state}}"
}

autopilot_state_file() {
  local session_id="${1:-}"
  local sanitized="${session_id//[^A-Za-z0-9_-]/_}"
  if [ -z "$sanitized" ]; then
    if [ -f "${ZENSU_PLUGIN_ROOT:-}/hooks/lib/zensu-session.sh" ]; then
      # shellcheck source=hooks/lib/zensu-session.sh
      # shellcheck disable=SC1091
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      sanitized="fallback_$(zensu_session_key)"
    else
      sanitized="fallback_${PPID}"
    fi
  fi
  echo "$(autopilot_state_dir)/autopilot-${sanitized}.json"
}

autopilot_valid_stage() {
  local stage="${1:-}" known
  [ -n "$stage" ] || return 1
  for known in $AUTOPILOT_STAGES; do
    [ "$stage" = "$known" ] && return 0
  done
  return 1
}

# --- read -------------------------------------------------------------------

# Print the validated state document. rc 1 + no output when the run is absent,
# unreadable, or corrupt — the caller treats that as "no durable run".
autopilot_read_state() {
  local session_id="${1:-}" state_file
  state_file="$(autopilot_state_file "$session_id")"
  [ -f "$state_file" ] || return 1
  [ -L "$state_file" ] && return 1
  command -v node >/dev/null 2>&1 || return 1
  STAGES="$AUTOPILOT_STAGES" node -e '
    const fs = require("fs");
    let s;
    try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (_) { process.exit(1); }
    if (!s || typeof s !== "object" || Array.isArray(s)) process.exit(1);
    const stages = (process.env.STAGES || "").split(" ").filter(Boolean);
    if (typeof s.runId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(s.runId)) process.exit(1);
    if (typeof s.stage !== "string" || stages.indexOf(s.stage) === -1) process.exit(1);
    if (typeof s.ownerSessionId !== "string") process.exit(1);
    if (!Array.isArray(s.events)) process.exit(1);
    process.stdout.write(JSON.stringify(s, null, 2));
  ' "$state_file" 2>/dev/null || return 1
  return 0
}

# One tab-separated line: runId, stage, ownerSessionId, feature, prUrl.
autopilot_status() {
  local session_id="${1:-}" json
  json="$(autopilot_read_state "$session_id")" || return 1
  printf '%s' "$json" | node -e '
    let s = ""; process.stdin.on("data", c => s += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        process.stdout.write([j.runId, j.stage, j.ownerSessionId,
          j.feature || "", (j.artifacts && j.artifacts.prUrl) || ""].join("\t") + "\n");
      } catch (_) { process.exit(1); }
    });
  ' 2>/dev/null || return 1
  return 0
}

autopilot_stage() {
  local line
  line="$(autopilot_status "${1:-}")" || return 1
  printf '%s' "$line" | cut -f2
}

# --- write ------------------------------------------------------------------

# Serialization. `flock` is absent on stock macOS, so the lock is a directory:
# `mkdir` is the atomic test-and-set. The subtle part is REAPING. Reaping on a
# dead owner pid alone is unsafe — a waiter can read the owner of a lock that
# was just released, find that process gone, and delete the SUCCESSOR's lock,
# after which two writers run concurrently and one write is lost. So staleness
# requires BOTH an untouched-for-a-while directory AND a dead (or unrecorded)
# owner, which also makes the window between `mkdir` and writing `owner`
# harmless. The wait budget is generous because losing a durable-state write
# costs far more than waiting.
_AUTOPILOT_LOCK_TIMEOUT_STEPS=1200
_AUTOPILOT_LOCK_STALE_SECONDS=30
# Hard ceiling for a lock whose owner still looks alive. It exists only for the
# pathological case where `$$` names a long-lived parent rather than the holder
# itself (the lib sourced, then called from a background subshell), so a crashed
# holder cannot wedge the run forever. It must stay far above any legitimate
# hold.
_AUTOPILOT_LOCK_ABANDON_SECONDS=600

_autopilot_sleep_tick() {
  sleep 0.02 2>/dev/null || sleep 1
}

# Reaping needs BOTH conditions, per the design note above: an untouched-for-a-
# while directory AND an owner that is dead or unrecorded. Dropping either one
# is unsafe — age alone deletes a lock whose owner is legitimately still working,
# and a dead pid alone deletes the SUCCESSOR's lock when a waiter happens to read
# an owner file from a lock that was just released.
#
# The one case both conditions still miss is an owner that reads as alive
# forever: `$$` names the sourcing shell rather than the holder when the lib is
# sourced and then driven from a background subshell, so a crashed holder would
# wedge the run. The abandon ceiling bounds that, far above any legitimate hold.
_autopilot_lock_stale() {
  local lock_dir="$1" owner_pid mtime now age
  mtime="$(stat -c %Y "$lock_dir" 2>/dev/null || stat -f %m "$lock_dir" 2>/dev/null || echo "")"
  [ -n "$mtime" ] || return 1
  now="$(date +%s 2>/dev/null || echo "")"
  [ -n "$now" ] || return 1
  age="$((now - mtime))"

  # The whole redirection is silenced, not just `tr`: the lock can be released
  # between the stat above and this read, and a bare `< file` failure is the
  # SHELL's error, which `tr 2>/dev/null` would not suppress. Left unsilenced it
  # prints on every contended acquire and pollutes hook stderr.
  owner_pid="$( { tr -d '[:space:]' < "$lock_dir/owner"; } 2>/dev/null )"
  if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then
    # Owner alive: never stale on age alone, only past the abandon ceiling.
    [ "$age" -gt "$_AUTOPILOT_LOCK_ABANDON_SECONDS" ] && return 0
    return 1
  fi

  # Owner dead or not yet recorded: reclaim only once the lock has also sat
  # untouched past the stale threshold.
  [ "$age" -gt "$_AUTOPILOT_LOCK_STALE_SECONDS" ] || return 1
  return 0
}

_autopilot_lock_acquire() {
  local lock_dir="$1" attempts=0
  while : ; do
    if mkdir "$lock_dir" 2>/dev/null; then
      printf '%s\n' "$$" > "$lock_dir/owner" 2>/dev/null || true
      return 0
    fi
    if _autopilot_lock_stale "$lock_dir"; then
      rm -rf "$lock_dir" 2>/dev/null
      continue
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$_AUTOPILOT_LOCK_TIMEOUT_STEPS" ]; then
      echo "[zensu-autopilot-state] lock acquisition timed out for $lock_dir" >&2
      return 1
    fi
    _autopilot_sleep_tick
  done
}

_autopilot_locked_run() {
  local state_file="$1"; shift
  local lock_dir="${state_file}.lockd"
  mkdir -p "$(dirname "$state_file")" 2>/dev/null || true
  _autopilot_lock_acquire "$lock_dir" || return 1
  "$@"
  local rc=$?
  rm -rf "$lock_dir" 2>/dev/null || true
  return $rc
}

# Bounded retry around a locked critical section.
#
# A failed critical section is indistinguishable at this level from a policy
# refusal (terminal stage, corrupt document) and from a transient one (lock
# contention, a read that lost a race). Losing a durable-state write silently is
# the expensive outcome — a repeated irreversible pipeline step — while retrying
# a genuine refusal costs a few milliseconds and still ends in the same rc 1.
# So: retry a few times, then give up and let the caller fail open.
_AUTOPILOT_WRITE_ATTEMPTS=5

_autopilot_retry_run() {
  local state_file="$1"; shift
  local attempt=1 rc=1
  while [ "$attempt" -le "$_AUTOPILOT_WRITE_ATTEMPTS" ]; do
    _autopilot_locked_run "$state_file" "$@"
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    attempt=$((attempt + 1))
    [ "$attempt" -le "$_AUTOPILOT_WRITE_ATTEMPTS" ] && _autopilot_sleep_tick
  done
  return "$rc"
}

_autopilot_write_json() {
  # $1 state_file, $2 node program, rest -> argv of the node program (after tmp)
  local state_file="$1"; shift
  local program="$1"; shift
  local tmp
  tmp="$(mktemp "${state_file}.XXXXXX" 2>/dev/null)" || return 1
  if ! STATE_FILE="$state_file" STAGES="$AUTOPILOT_STAGES" \
      node -e "$program" "$tmp" "$@" 2>/dev/null; then
    rm -f "$tmp" 2>/dev/null
    return 1
  fi
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp" 2>/dev/null
    return 1
  fi
  mv "$tmp" "$state_file" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
  return 0
}

_autopilot_begin_critical() {
  local state_file="$1" session_id="$2" run_id="$3" feature="$4" base="$5"
  _autopilot_write_json "$state_file" '
    const fs = require("fs");
    const now = new Date().toISOString();
    const state = {
      schema: "zensu-autopilot-state/1",
      runId: process.argv[2],
      ownerSessionId: process.argv[3],
      feature: process.argv[4],
      base: process.argv[5],
      stage: "PLANNING",
      createdAt: now,
      updatedAt: now,
      requirements: [],
      artifacts: { branch: "", prUrl: "", planPath: "" },
      events: [{ at: now, stage: "PLANNING", note: "run created" }]
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(state, null, 2));
  ' "$run_id" "$session_id" "$feature" "$base"
}

# Create the durable run. Echoes the run id. An existing VALID run is never
# clobbered — its run id is echoed instead, so a re-invocation resumes.
autopilot_begin_run() {
  local session_id="${1:-}" feature="${2:-}" base="${3:-main}"
  local state_file run_id existing
  command -v node >/dev/null 2>&1 || return 1
  state_file="$(autopilot_state_file "$session_id")"
  mkdir -p "$(dirname "$state_file")" 2>/dev/null || true
  [ -L "$state_file" ] && return 1

  if existing="$(autopilot_status "$session_id" 2>/dev/null)"; then
    printf '%s' "$existing" | cut -f1
    return 0
  fi
  # A present-but-corrupt document is quarantined, never silently overwritten.
  if [ -f "$state_file" ]; then
    mv "$state_file" "${state_file}.corrupt.$(date +%s 2>/dev/null || echo 0)" 2>/dev/null \
      || rm -f "$state_file" 2>/dev/null || return 1
  fi

  run_id="ap-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo 0)-$$"
  _autopilot_locked_run "$state_file" \
    _autopilot_begin_critical "$state_file" "$session_id" "$run_id" "$feature" "$base" || return 1
  echo "$run_id"
  return 0
}

_autopilot_event_critical() {
  local state_file="$1" stage="$2" note="$3"
  _autopilot_write_json "$state_file" '
    const fs = require("fs");
    let s;
    try { s = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8")); } catch (_) { process.exit(1); }
    if (!s || typeof s !== "object" || Array.isArray(s) || !Array.isArray(s.events)) process.exit(1);
    const stages = (process.env.STAGES || "").split(" ").filter(Boolean);
    const stage = process.argv[2];
    if (stages.indexOf(stage) === -1) process.exit(1);
    if (s.stage === "DONE" || s.stage === "CANCELLED") process.exit(1);
    const now = new Date().toISOString();
    s.stage = stage;
    s.updatedAt = now;
    s.events.push({ at: now, stage, note: process.argv[3] || "" });
    if (s.events.length > 500) s.events = s.events.slice(-500);
    fs.writeFileSync(process.argv[1], JSON.stringify(s, null, 2));
  ' "$stage" "$note"
}

# Advance the run to <stage> and append the event. rc 1 when the run is absent,
# corrupt, terminal, or the stage is unknown — always fail open at the caller.
autopilot_apply_event() {
  local session_id="${1:-}" stage="${2:-}" note="${3:-}" state_file
  command -v node >/dev/null 2>&1 || return 1
  autopilot_valid_stage "$stage" || return 1
  state_file="$(autopilot_state_file "$session_id")"
  [ -f "$state_file" ] || return 1
  [ -L "$state_file" ] && return 1
  _autopilot_retry_run "$state_file" _autopilot_event_critical "$state_file" "$stage" "$note"
}

_autopilot_artifact_critical() {
  local state_file="$1" key="$2" value="$3"
  _autopilot_write_json "$state_file" '
    const fs = require("fs");
    let s;
    try { s = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8")); } catch (_) { process.exit(1); }
    if (!s || typeof s !== "object" || Array.isArray(s)) process.exit(1);
    const key = process.argv[2];
    if (["branch", "prUrl", "planPath"].indexOf(key) === -1) process.exit(1);
    if (!s.artifacts || typeof s.artifacts !== "object" || Array.isArray(s.artifacts)) s.artifacts = {};
    s.artifacts[key] = String(process.argv[3] || "").slice(0, 512);
    s.updatedAt = new Date().toISOString();
    fs.writeFileSync(process.argv[1], JSON.stringify(s, null, 2));
  ' "$key" "$value"
}

# Persist a produced artifact (branch / prUrl / planPath) so a resumed run finds
# the PR it already opened instead of opening a second one.
autopilot_set_artifact() {
  local session_id="${1:-}" key="${2:-}" value="${3:-}" state_file
  command -v node >/dev/null 2>&1 || return 1
  case "$key" in branch|prUrl|planPath) ;; *) return 1 ;; esac
  state_file="$(autopilot_state_file "$session_id")"
  [ -f "$state_file" ] || return 1
  [ -L "$state_file" ] && return 1
  _autopilot_retry_run "$state_file" _autopilot_artifact_critical "$state_file" "$key" "$value"
}

_autopilot_requirements_critical() {
  local state_file="$1" ids="$2"
  _autopilot_write_json "$state_file" '
    const fs = require("fs");
    let s;
    try { s = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8")); } catch (_) { process.exit(1); }
    if (!s || typeof s !== "object" || Array.isArray(s)) process.exit(1);
    const ids = String(process.argv[2] || "").split(",").map(x => x.trim())
      .filter(x => /^(AC|FR)-[0-9]{3,}$/.test(x));
    const seen = Array.isArray(s.requirements) ? s.requirements.slice() : [];
    for (const id of ids) if (seen.indexOf(id) === -1) seen.push(id);
    seen.sort();
    s.requirements = seen;
    s.updatedAt = new Date().toISOString();
    fs.writeFileSync(process.argv[1], JSON.stringify(s, null, 2));
  ' "$ids"
}

# Record the run's stable requirement IDs (AC-###/FR-###). Additive and
# order-stable: IDs are never dropped or renumbered, matching the plan's
# never-recycle rule.
autopilot_add_requirements() {
  local session_id="${1:-}" ids="${2:-}" state_file
  command -v node >/dev/null 2>&1 || return 1
  [ -n "$ids" ] || return 1
  state_file="$(autopilot_state_file "$session_id")"
  [ -f "$state_file" ] || return 1
  [ -L "$state_file" ] && return 1
  _autopilot_retry_run "$state_file" _autopilot_requirements_critical "$state_file" "$ids"
}

# Retire the durable run (delivered or abandoned).
autopilot_clear_run() {
  local session_id="${1:-}" state_file
  state_file="$(autopilot_state_file "$session_id")"
  [ -L "$state_file" ] && return 1
  rm -f -- "$state_file" 2>/dev/null || true
  return 0
}

# --- CLI --------------------------------------------------------------------

_autopilot_resolve_session() {
  local session_val="${1:-}"
  if [ -z "$session_val" ]; then
    if [ -f "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh" ]; then
      export ZENSU_OWN_CMD="${ZENSU_OWN_CMD:-bash ${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-autopilot-state.sh}"
      # shellcheck source=hooks/lib/zensu-session.sh
      # shellcheck disable=SC1091
      source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh"
      session_val="$(zensu_resolve_session_id "${ZENSU_SESSION_ID:-}")"
    fi
  fi
  printf '%s' "$session_val"
}

_autopilot_main() {
  local verb="${1:-}"; shift || true
  local session_val="" feature_val="" base_val="main" stage_val="" note_val=""
  local key_val="" value_val="" ids_val=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --session) session_val="${2:-}"; shift 2 || break ;;
      --feature) feature_val="${2:-}"; shift 2 || break ;;
      --base)    base_val="${2:-main}"; shift 2 || break ;;
      --stage)   stage_val="${2:-}"; shift 2 || break ;;
      --note)    note_val="${2:-}"; shift 2 || break ;;
      --key)     key_val="${2:-}"; shift 2 || break ;;
      --value)   value_val="${2:-}"; shift 2 || break ;;
      --ids)     ids_val="${2:-}"; shift 2 || break ;;
      *) shift ;;
    esac
  done
  session_val="$(_autopilot_resolve_session "$session_val")"

  case "$verb" in
    begin)     autopilot_begin_run "$session_val" "$feature_val" "$base_val" ;;
    event)     autopilot_apply_event "$session_val" "$stage_val" "$note_val" ;;
    artifact)  autopilot_set_artifact "$session_val" "$key_val" "$value_val" ;;
    requirements) autopilot_add_requirements "$session_val" "$ids_val" ;;
    status)    autopilot_status "$session_val" ;;
    show)      autopilot_read_state "$session_val" ;;
    stage)     autopilot_stage "$session_val" ;;
    file)      autopilot_state_file "$session_val" ;;
    clear)     autopilot_clear_run "$session_val" ;;
    *)
      echo "usage: zensu-autopilot-state.sh {begin|event|artifact|requirements|status|show|stage|file|clear} [--session id] [--feature f] [--base b] [--stage S] [--note n] [--key k --value v] [--ids AC-001,FR-001]" >&2
      return 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  _autopilot_main "$@"
  exit $?
fi
