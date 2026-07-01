#!/bin/bash
set -u

# Ported from CC. post-bash-witness.sh logs cmd+exit+tail to witness-<sid>.log
# only when a TDD session is active. Engine-neutral: it reads the flat CC payload
# the shim's normalize-payload.js produces (tool_input.command +
# tool_response.{exit_code,stdout,interrupted}, BK7), so the scenarios port
# verbatim. The 5-field newline-delimited format is bash-3.2 safe.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/post-bash-witness.sh"
LOG="$PLUGIN_DIR/hooks/lib/zensu-log.sh"
TPL="$PLUGIN_DIR/hooks.json.template"

ZENSU_CONFIG="$PLUGIN_DIR/.no-such-config-$$.json"; export ZENSU_CONFIG

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$HOOK" ]; then
  check "hooks/post-bash-witness.sh exists" FAIL
  echo "----"; echo "test-post-bash-witness: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "P12-H0 hook exists" PASS
bash -n "$HOOK" 2>/dev/null && check "P12-H1 bash -n syntax check passes" PASS || check "P12-H1 bash -n syntax check passes" FAIL

# Wiring (Antigravity): shim-wrapped under a PostToolUse run_command matcher.
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let hit=false;
  for (const group of Object.values(t)) for (const [ev,arr] of Object.entries(group||{})) {
    if (ev!=="PostToolUse") continue;
    for (const e of (arr||[])) { if ((e.matcher||"")!=="run_command") continue;
      for (const h of (e.hooks||[])) if (/antigravity-shim\.sh post-bash-witness\.sh/.test(h.command||"")) hit=true; }
  }
  process.exit(hit?0:1);
' "$TPL" 2>/dev/null \
  && check "P12-W wired as PostToolUse run_command, shim-wrapped" PASS || check "P12-W wired as PostToolUse run_command" FAIL

activate() {
  env ZENSU_PROJECT_DIR="$1" TDD_STATE_DIR="$1/.zensu/state" \
    bash "$LOG" --tdd-begin --session "$2" >/dev/null 2>&1
}

make_payload() {
  local cmd="$1" exit_code="$2" stdout="$3" session_id="$4" interrupted="${5:-false}"
  local cmd_json stdout_json session_json exit_json
  cmd_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")"
  stdout_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$stdout")"
  session_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$session_id")"
  if [ "$exit_code" = "null" ]; then exit_json="null"; else exit_json="$exit_code"; fi
  printf '{"tool_input":{"command":%s},"tool_response":{"exit_code":%s,"stdout":%s,"interrupted":%s},"session_id":%s}' \
    "$cmd_json" "$exit_json" "$stdout_json" "$interrupted" "$session_json"
}

# H2: active session + distinct commands -> witness entries (no pattern filter)
PROJECT_TMP="$(mktemp -d -t "witness-proj-XXXXXX")"
SESSION="sess-h2-$$"
activate "$PROJECT_TMP" "$SESSION"
for P in "$(make_payload "npm test" 0 "PASS root/test.js" "$SESSION")" \
         "$(make_payload "pytest -v" 0 "1 passed" "$SESSION")" \
         "$(make_payload "go test ./..." 0 "ok pkg/foo" "$SESSION")"; do
  echo "$P" | env ZENSU_PROJECT_DIR="$PROJECT_TMP" TDD_STATE_DIR="$PROJECT_TMP/.zensu/state" bash "$HOOK" >/dev/null 2>&1
done
WITNESS="$PROJECT_TMP/.zensu/logs/witness-${SESSION}.log"
CN=$(grep -cF 'cmd="npm test"' "$WITNESS" 2>/dev/null || echo 0)
CP=$(grep -cF 'cmd="pytest -v"' "$WITNESS" 2>/dev/null || echo 0)
CG=$(grep -cF 'cmd="go test ./..."' "$WITNESS" 2>/dev/null || echo 0)
{ [ "$CN" = "1" ] && [ "$CP" = "1" ] && [ "$CG" = "1" ]; } \
  && check "P12-H2 active session + 3 distinct commands -> 3 witness entries" PASS \
  || check "P12-H2 entries (npm=$CN pyt=$CP go=$CG)" FAIL
rm -rf "$PROJECT_TMP"

# H3: session NOT activated -> no witness log (scope guard)
PT3="$(mktemp -d -t "witness-proj-XXXXXX")"; S3="sess-h3-$$"
echo "$(make_payload "npm test" 0 "PASS" "$S3")" | env ZENSU_PROJECT_DIR="$PT3" TDD_STATE_DIR="$PT3/.zensu/state" bash "$HOOK" >/dev/null 2>&1
[ ! -f "$PT3/.zensu/logs/witness-${S3}.log" ] && check "P12-H3 inactive session -> no witness log" PASS || check "P12-H3 inactive leaked a witness log" FAIL
rm -rf "$PT3"

# H5: ZENSU_TEST_WITNESS=off + active -> no log
PT5="$(mktemp -d -t "witness-proj-XXXXXX")"; S5="sess-h5-$$"
activate "$PT5" "$S5"
echo "$(make_payload "npm test" 0 "PASS" "$S5")" | env ZENSU_TEST_WITNESS=off ZENSU_PROJECT_DIR="$PT5" TDD_STATE_DIR="$PT5/.zensu/state" bash "$HOOK" >/dev/null 2>&1
[ ! -f "$PT5/.zensu/logs/witness-${S5}.log" ] && check "P12-H5 ZENSU_TEST_WITNESS=off -> no witness log" PASS || check "P12-H5 opt-out leaked a log" FAIL
rm -rf "$PT5"

# H7: quote-safe JSON-escape round-trip for cmd=
PT7="$(mktemp -d -t "witness-proj-XXXXXX")"; S7="sess-h7-$$"
activate "$PT7" "$S7"
TRICKY='echo "hello \"world\"" && printf "a\nb"'
printf '%s\n' "$(make_payload "$TRICKY" 0 "ok" "$S7")" | env ZENSU_PROJECT_DIR="$PT7" TDD_STATE_DIR="$PT7/.zensu/state" bash "$HOOK" >/dev/null 2>&1
W7="$PT7/.zensu/logs/witness-${S7}.log"
EX=$(node -e 'const fs=require("fs");const raw=fs.readFileSync(process.argv[1],"utf8").split("\n")[0];const m=raw.match(/cmd=(".*?(?<!\\)") exit=/);if(m)process.stdout.write(JSON.parse(m[1]));else process.stdout.write("UNPARSEABLE");' "$W7" 2>/dev/null)
[ "$EX" = "$TRICKY" ] && check "P12-H7 quote-safe JSON-escape: cmd round-trips" PASS || check "P12-H7 round-trip (got='$EX')" FAIL
rm -rf "$PT7"

# H11: witness line carries tail= (stdout) + interrupted=
PT11="$(mktemp -d -t "witness-proj-XXXXXX")"; S11="sess-h11-$$"
activate "$PT11" "$S11"
echo "$(make_payload "npm test" 0 "PASS root/test.js" "$S11")" | env ZENSU_PROJECT_DIR="$PT11" TDD_STATE_DIR="$PT11/.zensu/state" bash "$HOOK" >/dev/null 2>&1
L11="$(head -n1 "$PT11/.zensu/logs/witness-${S11}.log" 2>/dev/null)"
{ printf '%s' "$L11" | grep -qF 'cmd="npm test"' && printf '%s' "$L11" | grep -qE 'exit=0' \
  && printf '%s' "$L11" | grep -qF 'tail="PASS root/test.js"' && printf '%s' "$L11" | grep -qF 'interrupted=false'; } \
  && check "P12-H11 witness line carries tail= (stdout) + interrupted= [BK7]" PASS || check "P12-H11 tail+interrupted (line='$L11')" FAIL
rm -rf "$PT11"

# H12: production-shaped payload (NO exit_code) -> exit=? AND tail= captured (BK7)
PT12="$(mktemp -d -t "witness-proj-XXXXXX")"; S12="sess-h12-$$"
activate "$PT12" "$S12"
P12="$(node -e 'process.stdout.write(JSON.stringify({tool_input:{command:"node --test"},tool_response:{stdout:"tests 1\npass 1\nfail 0",stderr:"",interrupted:false,isImage:false},session_id:process.argv[1]}))' "$S12")"
printf '%s\n' "$P12" | env ZENSU_PROJECT_DIR="$PT12" TDD_STATE_DIR="$PT12/.zensu/state" bash "$HOOK" >/dev/null 2>&1
L12="$(head -n1 "$PT12/.zensu/logs/witness-${S12}.log" 2>/dev/null)"
{ printf '%s' "$L12" | grep -qF 'cmd="node --test"' && printf '%s' "$L12" | grep -qF 'exit=?' \
  && printf '%s' "$L12" | grep -qF 'pass 1'; } \
  && check "P12-H12 production payload (no exit_code) -> exit=? AND tail= from real stdout [BK7]" PASS || check "P12-H12 production-shape tail (line='$L12')" FAIL
rm -rf "$PT12"

# H14: interrupted=true -> recorded
PT14="$(mktemp -d -t "witness-proj-XXXXXX")"; S14="sess-h14-$$"
activate "$PT14" "$S14"
printf '%s\n' "$(make_payload "cmd-int" 0 "out" "$S14" true)" | env ZENSU_PROJECT_DIR="$PT14" TDD_STATE_DIR="$PT14/.zensu/state" bash "$HOOK" >/dev/null 2>&1
L14="$(head -n1 "$PT14/.zensu/logs/witness-${S14}.log" 2>/dev/null)"
printf '%s' "$L14" | grep -qF 'interrupted=true' && check "P12-H14 interrupted=true recorded" PASS || check "P12-H14 interrupted=true (line='$L14')" FAIL
rm -rf "$PT14"

echo "----"
echo "test-post-bash-witness: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
