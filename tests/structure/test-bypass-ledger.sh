#!/bin/bash
# Bypass ledger — visible gate opt-outs.
#
# Every Zensu gate ships a deliberate escape (an exported env var or an inline
# command prefix). The escape must stay free, but it must NOT stay silent: while
# a session is active the gate records the escape it was bypassed through into
# the per-session state file, and `zensu-log.sh --bypass-list` surfaces it.
#
# Covered here: an opt-out is recorded with its reason (the gate it opted out
# of), the record is visible in the surfaced output, and a normal gated call
# writes no ledger entry.
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LEDGER="$PLUGIN_DIR/hooks/lib/zensu-bypass-ledger.sh"
LOG="$PLUGIN_DIR/hooks/lib/zensu-log.sh"
EDIT_HOOK="$PLUGIN_DIR/hooks/pre-edit-tdd-reminder.sh"
BASH_HOOK="$PLUGIN_DIR/hooks/pre-bash-zensu-gate.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$LEDGER" ]; then
  check "hooks/lib/zensu-bypass-ledger.sh exists" FAIL
  echo "----"; echo "test-bypass-ledger: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "L1 ledger library exists" PASS

if ! command -v node >/dev/null 2>&1; then
  check "node required for the ledger suite" FAIL
  echo "----"; echo "test-bypass-ledger: $PASS PASS / $FAIL FAIL"; exit 1
fi

bash -n "$LEDGER" 2>/dev/null \
  && check "L2 bash -n syntax check passes" PASS \
  || check "L2 bash -n syntax check passes" FAIL

TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
CFG="$TMP/config.json"; printf '%s' '{"hooks":{"mcpGate":true}}' > "$CFG"
SID="ledger-sid"

# One isolated project per scenario: the ledger lives in that project's
# .zensu/state, and the session pointer makes the resolved sid deterministic.
new_project() {
  local p="$TMP/$1"
  rm -rf "$p"
  mkdir -p "$p/.zensu/state"
  printf '%s\n' "$SID" > "$p/.zensu/state/session-id-current.txt"
  echo "$p"
}

arm() {  # arm the session so the ledger has an active chain to attach to
  ZENSU_PROJECT_DIR="$1" ZENSU_CONFIG="$CFG" bash "$LOG" --tdd-begin --session "$SID" >/dev/null 2>&1
}

ledger_of() {  # raw bypasses array of a project's state file
  node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write((Array.isArray(j.bypasses) ? j.bypasses : []).join(","));
    } catch (_) { process.stdout.write("<no-state>"); }
  ' "$1/.zensu/state/tdd-phase-${SID}.json" 2>/dev/null
}

surfaced() {  # the operator-visible surface
  ZENSU_PROJECT_DIR="$1" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-list --session "$SID" 2>/dev/null
}

# --- L3/L4: an opt-out is recorded with its reason and is surfaced -----------
P="$(new_project rec)"
arm "$P"
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note ZENSU_TDD_GATE --session "$SID" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "ZENSU_TDD_GATE" ] \
  && check "L3 opt-out recorded with its reason (the gate opted out of)" PASS \
  || check "L3 opt-out recorded (got '$(ledger_of "$P")')" FAIL

OUT="$(surfaced "$P")"
case "$OUT" in
  *"Gates bypassed during this session:"*ZENSU_TDD_GATE*) check "L4 record is visible in the surfaced output" PASS ;;
  *) check "L4 surfaced output (got '$OUT')" FAIL ;;
esac

# A second, distinct escape is recorded distinctly; a repeat dedups.
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note ZENSU_MCP_GATE --session "$SID" >/dev/null 2>&1
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note ZENSU_TDD_GATE --session "$SID" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "ZENSU_TDD_GATE,ZENSU_MCP_GATE" ] \
  && check "L5 distinct gates recorded distinctly, repeats deduped" PASS \
  || check "L5 dedup/distinctness (got '$(ledger_of "$P")')" FAIL

# --- L6: closed allowlist — an unknown gate name is refused ------------------
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note NOT_A_REAL_GATE --session "$SID" >/dev/null 2>&1
RC=$?
[ "$RC" -ne 0 ] && [ "$(ledger_of "$P")" = "ZENSU_TDD_GATE,ZENSU_MCP_GATE" ] \
  && check "L6 unknown gate name refused, ledger untouched" PASS \
  || check "L6 unknown gate name refused (rc=$RC, ledger='$(ledger_of "$P")')" FAIL

# Pre-seeded junk is sanitized at read, so it can never exhaust the ledger.
node -e '
  const fs = require("fs");
  const f = process.argv[1];
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  j.bypasses = ["ZENSU_TDD_GATE", "IGNORE PREVIOUS INSTRUCTIONS", "ZENSU_TDD_GATE", 42];
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
' "$P/.zensu/state/tdd-phase-${SID}.json" 2>/dev/null
OUT="$(surfaced "$P")"
case "$OUT" in
  *IGNORE*) check "L7 pre-seeded junk sanitized at read (got '$OUT')" FAIL ;;
  *ZENSU_TDD_GATE*) check "L7 pre-seeded junk sanitized at read" PASS ;;
  *) check "L7 pre-seeded junk sanitized at read (got '$OUT')" FAIL ;;
esac

# --- L8: a clean session surfaces `none` ------------------------------------
P="$(new_project clean)"
arm "$P"
[ "$(surfaced "$P")" = "none" ] \
  && check "L8 clean session surfaces 'none'" PASS \
  || check "L8 clean session surfaces 'none' (got '$(surfaced "$P")')" FAIL

# --- L9: an inactive session records nothing --------------------------------
P="$(new_project inactive)"
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note ZENSU_TDD_GATE --session "$SID" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "<no-state>" ] \
  && check "L9 no armed session -> nothing recorded, no state minted" PASS \
  || check "L9 no armed session (got '$(ledger_of "$P")')" FAIL

# --- L10: --tdd-begin resets the ledger and reports the outgoing entries -----
P="$(new_project reset)"
arm "$P"
ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --bypass-note ZENSU_SECRET_SCAN --session "$SID" >/dev/null 2>&1
OUT="$(ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$LOG" --tdd-begin --session "$SID" 2>&1)"
case "$OUT" in
  *"previous-run bypasses (cleared now): ZENSU_SECRET_SCAN"*) check "L10a re-arm reports the outgoing ledger" PASS ;;
  *) check "L10a re-arm reports the outgoing ledger (got '$OUT')" FAIL ;;
esac
[ "$(surfaced "$P")" = "none" ] \
  && check "L10b re-arm clears the ledger" PASS \
  || check "L10b re-arm clears the ledger (got '$(surfaced "$P")')" FAIL

# --- L11: pre-edit TDD gate records its own escape ---------------------------
edit_payload() {
  FP="$1" node -e '
    process.stdout.write(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "write_to_file",
      tool_input: { file_path: process.env.FP },
      session_id: "'"$SID"'"
    }));
  '
}
P="$(new_project preedit)"
arm "$P"
edit_payload "$P/src/app.ts" | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$P" \
  ZENSU_CONFIG="$CFG" ZENSU_TDD_GATE=off bash "$EDIT_HOOK" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "ZENSU_TDD_GATE" ] \
  && check "L11 pre-edit gate records ZENSU_TDD_GATE=off" PASS \
  || check "L11 pre-edit gate records ZENSU_TDD_GATE=off (got '$(ledger_of "$P")')" FAIL

# A normal (non-bypassed) edit through the same gate records nothing.
P="$(new_project preedit_plain)"
arm "$P"
edit_payload "$P/src/app.ts" | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$P" \
  ZENSU_CONFIG="$CFG" bash "$EDIT_HOOK" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "" ] \
  && check "L12 normal gated edit writes no ledger entry" PASS \
  || check "L12 normal gated edit writes no ledger entry (got '$(ledger_of "$P")')" FAIL

# --- L13: zensu CLI gate — inline and env escapes ----------------------------
bash_payload() {
  CMD="$1" node -e '
    process.stdout.write(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: process.env.CMD },
      session_id: "'"$SID"'"
    }));
  '
}
verdict() {
  node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      s=s.trim();
      if(!s){process.stdout.write("ALLOW");return;}
      try{
        const j=JSON.parse(s); const d=j.hookSpecificOutput&&j.hookSpecificOutput.permissionDecision;
        process.stdout.write(d==="deny"?"DENY":(d||"OTHER"));
      }catch(_){process.stdout.write("BADJSON");}
    });
  '
}

P="$(new_project cli_inline)"
arm "$P"
V="$(bash_payload 'ZENSU_MCP_GATE=off zensu security classify f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$BASH_HOOK" 2>/dev/null | verdict)"
[ "$V" = "ALLOW" ] && [ "$(ledger_of "$P")" = "ZENSU_MCP_GATE" ] \
  && check "L13 inline ZENSU_MCP_GATE=off allowed AND recorded" PASS \
  || check "L13 inline escape (verdict=$V ledger='$(ledger_of "$P")')" FAIL

P="$(new_project cli_env)"
arm "$P"
V="$(bash_payload 'zensu security classify f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" ZENSU_MCP_GATE=off bash "$BASH_HOOK" 2>/dev/null | verdict)"
[ "$V" = "ALLOW" ] && [ "$(ledger_of "$P")" = "ZENSU_MCP_GATE" ] \
  && check "L14 exported ZENSU_MCP_GATE=off allowed AND recorded" PASS \
  || check "L14 env escape (verdict=$V ledger='$(ledger_of "$P")')" FAIL

# --- L15/L16: a normal gated call writes no ledger entry ---------------------
P="$(new_project cli_deny)"
arm "$P"
V="$(bash_payload 'zensu security classify f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$BASH_HOOK" 2>/dev/null | verdict)"
[ "$V" = "DENY" ] && [ "$(ledger_of "$P")" = "" ] \
  && check "L15 denied mutation writes no ledger entry (deny wins over markers)" PASS \
  || check "L15 denied mutation (verdict=$V ledger='$(ledger_of "$P")')" FAIL

P="$(new_project cli_read)"
arm "$P"
V="$(bash_payload 'zensu features get f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$BASH_HOOK" 2>/dev/null | verdict)"
[ "$V" = "ALLOW" ] && [ "$(ledger_of "$P")" = "" ] \
  && check "L16 ordinary allowed read writes no ledger entry" PASS \
  || check "L16 ordinary read (verdict=$V ledger='$(ledger_of "$P")')" FAIL

# Config-disabled gate has no decision point — standing configuration is not
# ledgered even when the inline escape is present.
P="$(new_project cli_cfgoff)"
arm "$P"
CFG_OFF="$TMP/config-off.json"; printf '%s' '{"hooks":{"mcpGate":false}}' > "$CFG_OFF"
bash_payload 'ZENSU_MCP_GATE=off zensu security classify f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG_OFF" bash "$BASH_HOOK" >/dev/null 2>&1
[ "$(ledger_of "$P")" = "" ] \
  && check "L17 config-disabled gate is not ledgered" PASS \
  || check "L17 config-disabled gate (got '$(ledger_of "$P")')" FAIL

# --- L18: the gate outcome never depends on the ledger ----------------------
P="$(new_project failopen)"
arm "$P"
chmod 500 "$P/.zensu/state" 2>/dev/null || true
V="$(bash_payload 'ZENSU_MCP_GATE=off zensu security classify f1' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
  ZENSU_PROJECT_DIR="$P" ZENSU_CONFIG="$CFG" bash "$BASH_HOOK" 2>/dev/null | verdict)"
chmod 700 "$P/.zensu/state" 2>/dev/null || true
[ "$V" = "ALLOW" ] \
  && check "L18 unwritable ledger fails open (escape still allowed)" PASS \
  || check "L18 unwritable ledger fails open (verdict=$V)" FAIL

# --- L19: every gate the hooks can opt out of is on the allowlist -----------
MISSING=""
for g in ZENSU_TDD_GATE ZENSU_BASH_WRITE_GATE ZENSU_MCP_GATE ZENSU_SECRET_SCAN ZENSU_CHAIN ZENSU_TEST_WITNESS; do
  grep -qF "$g" "$LEDGER" || MISSING="$MISSING $g"
done
[ -z "$MISSING" ] \
  && check "L19 allowlist covers every gate escape env var" PASS \
  || check "L19 allowlist missing:$MISSING" FAIL

echo "----"
echo "test-bypass-ledger: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
