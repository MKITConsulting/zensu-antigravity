#!/bin/bash
set -u

# Ported from CC. The behavioral gate logic is engine-neutral: pre-bash-zensu-
# gate.sh reads the flat CC payload (tool_input.command) that the shim's
# normalize-payload.js produces, so every classification case ports verbatim. The
# ONLY Antigravity adaptation is the wiring assertion (B3): instead of CC's
# hooks.json `Bash` matcher, we assert the gate is shim-wrapped under a
# `run_command` matcher in hooks.json.template.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/pre-bash-zensu-gate.sh"
TPL="$PLUGIN_DIR/hooks.json.template"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$HOOK" ]; then
  check "hooks/pre-bash-zensu-gate.sh exists" FAIL
  echo "----"; echo "test-bash-zensu-gate: $PASS PASS / $FAIL FAIL"; exit 1
fi

check "B1 hook exists" PASS
bash -n "$HOOK" 2>/dev/null && check "B2 bash -n syntax check passes" PASS || check "B2 bash -n syntax check passes" FAIL

# B3 (Antigravity wiring): registered in hooks.json.template under a run_command
# matcher, shim-wrapped with a BARE script name. No CC `Bash` matcher.
if node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let hit = false;
  for (const group of Object.values(t)) {
    for (const [ev, arr] of Object.entries(group||{})) {
      if (ev !== "PreToolUse") continue;
      for (const e of (arr||[])) {
        if ((e.matcher||"") !== "run_command") continue;
        for (const h of (e.hooks||[])) {
          if (/antigravity-shim\.sh pre-bash-zensu-gate\.sh/.test(h.command||"")) hit = true;
        }
      }
    }
  }
  process.exit(hit ? 0 : 1);
' "$TPL" 2>/dev/null; then
  check "B3 wired as PreToolUse run_command, shim-wrapped (Antigravity form)" PASS
else
  check "B3 wired as PreToolUse run_command, shim-wrapped (Antigravity form)" FAIL
fi

grep -qF 'zensu_hook_enabled mcpGate' "$HOOK" \
  && check "B4 hook config-gated via zensu_hook_enabled mcpGate (default-on)" PASS \
  || check "B4 hook config-gated via zensu_hook_enabled mcpGate (default-on)" FAIL

grep -qF 'zensu-mcp-tools.sh' "$HOOK" && grep -qF 'zensu-cli-map.sh' "$HOOK" \
  && check "B4b reuses zensu-mcp-tools.sh + zensu-cli-map.sh" PASS \
  || check "B4b reuses zensu-mcp-tools.sh + zensu-cli-map.sh" FAIL

# Build a flat CC PreToolUse payload carrying tool_input.command (the shape the
# normalizer hands the wrapped script).
payload() {
  CMD="$1" AT="${2:-}" SID="${3:-gate-test}" node -e '
    const o={hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:process.env.CMD},session_id:process.env.SID,cwd:"/tmp"};
    if(process.env.AT) o.agent_type=process.env.AT;
    process.stdout.write(JSON.stringify(o));
  '
}
classify() {
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
run() {
  local label="$1" cmd="$2" at="$3" exp="$4" sd="${5:-}"
  local out
  out="$(payload "$cmd" "$at" gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" ${sd:+TDD_STATE_DIR=$sd} bash "$HOOK" 2>/dev/null | classify)"
  [ "$out" = "$exp" ] && check "$label -> $exp" PASS || check "$label (got '$out' want '$exp')" FAIL
}

CFG_ON="$(mktemp -t bashgate-on-XXXXXX)";   printf '%s' '{"hooks":{"mcpGate":true}}'  > "$CFG_ON"
CFG_OFF="$(mktemp -t bashgate-def-XXXXXX)";  printf '%s' '{"hooks":{}}'                 > "$CFG_OFF"
CFG_FALSE="$(mktemp -t bashgate-no-XXXXXX)"; printf '%s' '{"hooks":{"mcpGate":false}}' > "$CFG_FALSE"

run "B5 read (features get)"                "zensu features get f1"                                      '' ALLOW
run "B6 freelance mutation (classify)"      "zensu security classify f1 --classification confidential"   '' DENY
run "B7 mutation + zensu-plm agent"         "zensu security classify f1"                          zensu-plm ALLOW
run "B12 alias mutation (sec classify)"     "zensu sec classify f1"                                      '' DENY
run "B12b alias read (feature get)"         "zensu feature get f1"                                       '' ALLOW
run "B15 echo merely mentions zensu"        "echo use zensu security classify please"                    '' ALLOW
run "B16 env-prefix mutation (link test)"   "FOO=bar zensu link test f1 --test-type unit --file a.go"    '' DENY
run "B17 auth login (neutral)"              "zensu auth login"                                           '' ALLOW
run "B17b version flag"                     "zensu --version"                                            '' ALLOW
run "B18 knowledge search (POST-but-read)"  "zensu knowledge search --query x"                           '' ALLOW
run "B25 compound: read && mutation"        "zensu features get f1 && zensu security classify f2"        '' DENY

# B8 workflow-active (skill running) -> mutation in declared set ALLOW
SDF="$(mktemp -d -t bashgate-wf-XXXXXX)"
ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" TDD_STATE_DIR="$SDF" bash -c '
  source "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-session.sh"
  source "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-tdd-phase.sh"
  sid="$(zensu_resolve_session_id gate-test)"
  tdd_workflow_begin "$sid" "set_security_classification" "$(( $(date +%s) + 3600 ))"
' 2>/dev/null
run "B8 mutation + workflowActive (in set)" "zensu security classify f1"                                '' ALLOW "$SDF"
run "B27b out-of-scope mutation -> DENY"    "zensu link test f1 --test-type unit --file a.go"            '' DENY "$SDF"
rm -rf "$SDF"

# B9 env escape; B10 default-on; B11 explicit false
OUT="$(payload 'zensu security classify f1' '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" ZENSU_MCP_GATE=off bash "$HOOK" 2>/dev/null | classify)"
[ "$OUT" = "ALLOW" ] && check "B9 mutation + ZENSU_MCP_GATE=off -> ALLOW" PASS || check "B9 env escape (got '$OUT')" FAIL
OUT="$(payload 'zensu security classify f1' '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_OFF" bash "$HOOK" 2>/dev/null | classify)"
[ "$OUT" = "DENY" ] && check "B10 mutation, gate default-on (mcpGate absent) -> DENY" PASS || check "B10 default-on (got '$OUT')" FAIL
OUT="$(payload 'zensu security classify f1' '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_FALSE" bash "$HOOK" 2>/dev/null | classify)"
[ "$OUT" = "ALLOW" ] && check "B11 mutation, mcpGate:false -> ALLOW" PASS || check "B11 explicit false (got '$OUT')" FAIL

# B20 fail-open: empty + non-JSON + non-zensu command -> ALLOW
OUT="$(printf '' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" bash "$HOOK" 2>/dev/null | classify)"
OUT2="$(printf '%s' 'not json at all' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" bash "$HOOK" 2>/dev/null | classify)"
OUT3="$(payload 'git status' '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" bash "$HOOK" 2>/dev/null | classify)"
if [ "$OUT" = "ALLOW" ] && [ "$OUT2" = "ALLOW" ] && [ "$OUT3" = "ALLOW" ]; then
  check "B20 fail-open: empty + non-JSON + non-zensu -> ALLOW" PASS
else
  check "B20 fail-open (empty='$OUT' nonjson='$OUT2' nonzensu='$OUT3')" FAIL
fi

# B23 representative mutations across nouns -> DENY (freelance)
M_FAIL=0
for c in \
  "zensu features create --product p --component c --title T" \
  "zensu roadmap create --product p --title R" \
  "zensu link test f1 --test-type unit --file a" \
  "zensu ghost apply s1" \
  "zensu wiki create --product p --title T --content X"; do
  O="$(payload "$c" '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" bash "$HOOK" 2>/dev/null | classify)"
  [ "$O" = "DENY" ] || { M_FAIL=$((M_FAIL+1)); echo "      '$c' -> $O (expected DENY)"; }
done
[ "$M_FAIL" -eq 0 ] && check "B23 representative mutations freelance -> DENY" PASS || check "B23 mutation coverage ($M_FAIL)" FAIL

# B24 representative reads + telemetry -> ALLOW (freelance)
R_FAIL=0
for c in \
  "zensu features list --product p" \
  "zensu roadmap get r1" \
  "zensu security posture --product p" \
  "zensu ghost candidates s1" \
  "zensu pulse summary s1"; do
  O="$(payload "$c" '' gate-test | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_ON" bash "$HOOK" 2>/dev/null | classify)"
  [ "$O" = "ALLOW" ] || { R_FAIL=$((R_FAIL+1)); echo "      '$c' -> $O (expected ALLOW)"; }
done
[ "$R_FAIL" -eq 0 ] && check "B24 representative reads + telemetry -> ALLOW" PASS || check "B24 read coverage ($R_FAIL)" FAIL

# B28 parser hardening — disguised invocations must still gate
run "B28a wrapper command + mutation"        "command zensu security classify f1"                         '' DENY
run "B28b wrapper env + mutation"            "env zensu security classify f1"                             '' DENY
run "B28c wrapper sudo + mutation"           "sudo zensu security classify f1"                            '' DENY

# B33–B35 gate-narrowing: reads/--help, inline off, localhost-skip
run "B33 mutation + --help (a read) -> ALLOW"      "zensu security classify f1 --help"                          '' ALLOW
run "B34 inline ZENSU_MCP_GATE=off -> ALLOW"       "ZENSU_MCP_GATE=off zensu security classify f1"              '' ALLOW
run "B35 --api-url localhost -> ALLOW"             "zensu --api-url http://localhost:8090 security classify f1" '' ALLOW
run "B35c --api-url prod still -> DENY"            "zensu --api-url https://api.zensu.dev security classify f1" '' DENY

rm -f "$CFG_ON" "$CFG_OFF" "$CFG_FALSE"

echo "----"
echo "test-bash-zensu-gate: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
