#!/bin/bash
# Bypass ledger — visible gate opt-outs.
#
# Every Zensu gate ships a deliberate escape hatch (an exported env var or an
# inline command prefix such as `ZENSU_TDD_GATE=off`). Those escapes stay FREE —
# no gate ever blocks on one — but they are no longer SILENT: while a Zensu
# session is active (chain-state `active`), the gate that was opted out of
# records the escape it was bypassed through into the per-session state file.
# `zensu-log.sh --bypass-list` renders the ledger, so the chain-end summary can
# surface every deliberate opt-out instead of letting it pass unnoticed.
#
# Recording semantics — ONE rule for every call site: the escape is recorded
# when it short-circuits the gate's own DECISION POINT, and only on an ALLOW
# outcome. A command that ends up denied never executed, so it never mints an
# entry. A gate switched off by standing configuration (`hooks.<flag>:false`)
# has no decision point at all and is deliberately NOT ledgered.
#
# Ledger hygiene:
#   * gate names ONLY — never a command, a path, or a value, so a crafted
#     payload can never smuggle directive text into a rendered surface;
#   * entries are validated against the CLOSED allowlist below at write AND at
#     read, so pre-seeded junk is sanitized before the cap can be exhausted;
#   * dedup per gate name, hard cap of ZENSU_BYPASS_MAX_ENTRIES;
#   * every write is fail-open — a ledger failure never blocks or breaks a gate.
#
# A new gate extends ZENSU_BYPASS_GATE_ALLOWLIST in this ONE place.
set -u

: "${ZENSU_PLUGIN_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

ZENSU_BYPASS_GATE_ALLOWLIST="ZENSU_TDD_GATE ZENSU_BASH_WRITE_GATE ZENSU_MCP_GATE ZENSU_SECRET_SCAN ZENSU_CHAIN ZENSU_TEST_WITNESS"
ZENSU_BYPASS_MAX_ENTRIES=32

# The ledger lives in the SAME per-session state file as the FSM phase and the
# chain flags, so it is bound to exactly one session and cleared with it. Load
# the phase library on demand instead of at source time: gates that never record
# anything must not pay for it.
_zensu_bypass_load_phase_lib() {
  declare -F tdd_state_file >/dev/null 2>&1 && return 0
  [ -f "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh" ] || return 1
  # shellcheck disable=SC1090
  source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-tdd-phase.sh" 2>/dev/null || return 1
  declare -F tdd_state_file >/dev/null 2>&1
}

# A gate name is acceptable only when it is a single bare token from the closed
# allowlist. Anything carrying whitespace, or anything unknown, is rejected.
zensu_bypass_shape_ok() {
  local gate="${1:-}"
  [ -n "$gate" ] || return 1
  case "$gate" in
    *[[:space:]]*) return 1 ;;
  esac
  case " $ZENSU_BYPASS_GATE_ALLOWLIST " in
    *" $gate "*) return 0 ;;
  esac
  return 1
}

_zensu_bypass_write_critical() {
  local state_file="$1"
  local session_id="$2"
  local gate="$3"

  local tmp
  if ! tmp="$(mktemp "${state_file}.XXXXXX" 2>/dev/null)"; then
    return 1
  fi

  STATE_FILE="$state_file" SID="$session_id" GATE="$gate" \
    ALLOW="$ZENSU_BYPASS_GATE_ALLOWLIST" CAP="$ZENSU_BYPASS_MAX_ENTRIES" \
    node -e '
      const fs = require("fs");
      let state = {};
      try {
        const prev = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8"));
        if (prev && typeof prev === "object" && !Array.isArray(prev)) state = prev;
      } catch (_) {}
      if (!state.session_id) state.session_id = process.env.SID;
      if (typeof state.phase !== "string") state.phase = "UNINITIALIZED";
      if (!Array.isArray(state.history)) state.history = [];
      const allow = String(process.env.ALLOW || "").split(" ").filter(Boolean);
      const cap = parseInt(process.env.CAP, 10) > 0 ? parseInt(process.env.CAP, 10) : 32;
      const gate = String(process.env.GATE || "").trim();
      let list = Array.isArray(state.bypasses) ? state.bypasses : [];
      list = list.filter((x, i, a) =>
        typeof x === "string" && allow.indexOf(x) >= 0 && a.indexOf(x) === i);
      if (allow.indexOf(gate) >= 0 && list.indexOf(gate) < 0) list.push(gate);
      state.bypasses = list.slice(0, cap);
      fs.writeFileSync(process.argv[1], JSON.stringify(state, null, 2));
    ' "$tmp" 2>/dev/null

  if [ ! -s "$tmp" ]; then
    rm -f "$tmp" 2>/dev/null
    return 1
  fi

  mv "$tmp" "$state_file" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# Render the ledger of an explicit state file as a comma-separated gate list.
# Empty output means "no deliberate opt-out recorded".
zensu_bypass_list() {
  local state_file="${1:-}"
  if [ -z "$state_file" ] || [ ! -f "$state_file" ]; then
    echo ""
    return 0
  fi
  command -v node >/dev/null 2>&1 || { echo ""; return 0; }
  local out
  out="$(ALLOW="$ZENSU_BYPASS_GATE_ALLOWLIST" CAP="$ZENSU_BYPASS_MAX_ENTRIES" node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const allow = String(process.env.ALLOW || "").split(" ").filter(Boolean);
      const cap = parseInt(process.env.CAP, 10) > 0 ? parseInt(process.env.CAP, 10) : 32;
      const list = (Array.isArray(j.bypasses) ? j.bypasses : [])
        .filter((x, i, a) => typeof x === "string" && allow.indexOf(x) >= 0 && a.indexOf(x) === i)
        .slice(0, cap);
      process.stdout.write(list.join(", "));
    } catch (_) {}
  ' "$state_file" 2>/dev/null)"
  echo "$out"
}

# Unconditional write (allowlist + dedup still apply). Callers that must respect
# session activation use zensu_bypass_record instead.
zensu_bypass_add() {
  local session_id="${1:-}"
  local gate="${2:-}"
  zensu_bypass_shape_ok "$gate" || return 1
  _zensu_bypass_load_phase_lib || return 1
  command -v node >/dev/null 2>&1 || return 1

  local state_file
  state_file="$(tdd_state_file "$session_id")" || return 1
  [ -L "$state_file" ] && return 1
  [ -L "$(dirname "$state_file")" ] && return 1
  # No armed session file → nothing to attach the ledger to. Never create one.
  [ -f "$state_file" ] || return 1

  case ",$(zensu_bypass_list "$state_file")," in
    *", $gate,"*|*",$gate,"*) return 0 ;;
  esac

  _tdd_locked_run "$state_file" \
    _zensu_bypass_write_critical "$state_file" "$session_id" "$gate"
}

# The call every gate uses: record the escape only while a session is active,
# and never let a ledger failure change the gate's own outcome.
zensu_bypass_record() {
  local session_id="${1:-}"
  local gate="${2:-}"
  [ -n "$session_id" ] || return 0
  _zensu_bypass_load_phase_lib || return 0
  if [ "$(tdd_session_active "$(tdd_state_file "$session_id")")" = "true" ]; then
    zensu_bypass_add "$session_id" "$gate" 2>/dev/null || true
  fi
  return 0
}

# Same, for a gate that has not resolved a session id yet: pull it out of the
# hook payload and run it through the normal session resolution.
zensu_bypass_record_payload() {
  local payload="${1:-}"
  local gate="${2:-}"
  command -v node >/dev/null 2>&1 || return 0
  local sid=""
  if [ -n "$payload" ]; then
    sid="$(printf '%s' "$payload" | node -e '
      let s = "";
      process.stdin.on("data", c => s += c);
      process.stdin.on("end", () => {
        try {
          const j = JSON.parse(s || "{}");
          process.stdout.write(typeof j.session_id === "string" ? j.session_id : "");
        } catch (_) { process.stdout.write(""); }
      });
    ' 2>/dev/null)"
  fi
  if [ -f "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh" ]; then
    # shellcheck disable=SC1090
    source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-session.sh" 2>/dev/null || return 0
    sid="$(zensu_resolve_session_id "$sid")" || return 0
  fi
  zensu_bypass_record "$sid" "$gate"
}

_zensu_bypass_clear_critical() {
  local state_file="$1"
  local tmp
  if ! tmp="$(mktemp "${state_file}.XXXXXX" 2>/dev/null)"; then
    return 1
  fi
  STATE_FILE="$state_file" node -e '
    const fs = require("fs");
    let s = {};
    try {
      const prev = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8"));
      if (prev && typeof prev === "object" && !Array.isArray(prev)) s = prev;
    } catch (_) {}
    s.bypasses = [];
    fs.writeFileSync(process.argv[1], JSON.stringify(s, null, 2));
  ' "$tmp" 2>/dev/null
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp" 2>/dev/null
    return 1
  fi
  mv "$tmp" "$state_file" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# Reset the ledger. Called at every session arm (--tdd-begin) and reset
# (--tdd-reset) so one run's opt-outs never leak into the next one's summary.
zensu_bypass_clear() {
  local session_id="${1:-}"
  _zensu_bypass_load_phase_lib || return 1
  command -v node >/dev/null 2>&1 || return 1
  local state_file
  state_file="$(tdd_state_file "$session_id")" || return 1
  [ -f "$state_file" ] || return 0
  [ -L "$state_file" ] && return 1
  [ -L "$(dirname "$state_file")" ] && return 1
  _tdd_locked_run "$state_file" _zensu_bypass_clear_critical "$state_file"
}

export -f _zensu_bypass_load_phase_lib zensu_bypass_shape_ok _zensu_bypass_write_critical \
  zensu_bypass_list zensu_bypass_add zensu_bypass_record zensu_bypass_record_payload \
  _zensu_bypass_clear_critical zensu_bypass_clear 2>/dev/null || true
