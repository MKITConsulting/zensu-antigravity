#!/usr/bin/env bash
# End-to-end engine-payload-shape test (kiro's test-gate-kiro-payloads analog):
# feed the shim REAL Antigravity-shaped payloads (toolCall.name / args.CommandLine
# envelope, run_command tool) and assert the CLI write-gate denies free-standing
# mutations and allows reads, THROUGH the shim's normalize -> wrapped gate ->
# verdict pipeline. This is the proof the AG stdin envelope reaches the gate and
# the verdict reaches the host. (The shim self-resolves its root, so run it from
# a sandbox copy with all libs present.)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
WS="$TMP/ws"; mkdir -p "$WS"

SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/antigravity/"*.js "$SBX/hooks/antigravity/" 2>/dev/null
cp "$ROOT/hooks/"*.sh "$SBX/hooks/" 2>/dev/null
cp "$ROOT/hooks/lib/"* "$SBX/hooks/lib/" 2>/dev/null
SBSHIM="$SBX/hooks/antigravity/antigravity-shim.sh"
chmod +x "$SBSHIM" "$SBX/hooks/"*.sh 2>/dev/null

# An Antigravity run_command payload: toolCall.name + args.CommandLine + a
# workspace root (the shim exports it as CLAUDE_PROJECT_DIR).
ag_payload() { # $1=command
  printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"%s","Cwd":"%s"}},"workspacePaths":["%s"],"session_id":"agpay"}' "$1" "$WS" "$WS"
}
# Run a command through the pre-bash gate via the shim; classify the verdict.
gate() { # $1=command -> echoes DENY|ALLOW
  printf '%s' "$(ag_payload "$1")" \
    | env ZENSU_AG_HOOK_CONTRACT=superset bash "$SBSHIM" pre-bash-zensu-gate.sh 2>/dev/null \
    | node -e '
        let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
          s=s.trim(); if(!s){process.stdout.write("ALLOW");return;}
          try{const j=JSON.parse(s);
            const denied = j.allow_tool===false || j.decision==="deny";
            process.stdout.write(denied?"DENY":"ALLOW");
          }catch(_){process.stdout.write("ALLOW");}});'
}
run() { # $1=label $2=cmd $3=expected
  local out; out="$(gate "$2")"
  [ "$out" = "$3" ] && ok "$1 -> $3" || bad "$1 (got '$out' want '$3')"
}

# Reads pass ungated through the AG envelope.
run "AG read: features get"        "zensu features get f1"                                  ALLOW
run "AG read: roadmap list"        "zensu roadmap list --product p"                         ALLOW
run "AG read: security posture"    "zensu security posture --product p"                     ALLOW
run "AG telemetry: pulse summary"  "zensu pulse summary s1"                                 ALLOW
run "AG non-zensu command"         "git status"                                             ALLOW

# Free-standing mutations are denied through the AG envelope.
run "AG mutation: security classify" "zensu security classify f1 --classification confidential" DENY
run "AG mutation: features create"   "zensu features create --product p --component c --title T"  DENY
run "AG mutation: link test"         "zensu link test f1 --test-type unit --file a.go"        DENY
run "AG mutation: ghost apply"       "zensu ghost apply s1"                                   DENY
run "AG alias mutation: sec classify" "zensu sec classify f1 --classification confidential"   DENY

# Escape hatches still work through the AG envelope.
run "AG inline ZENSU_MCP_GATE=off"  "ZENSU_MCP_GATE=off zensu security classify f1"           ALLOW
run "AG localhost --api-url"        "zensu --api-url http://localhost:8090 security classify f1" ALLOW

# The deny verdict carries a reason (plain text) through the shim.
OUT="$(printf '%s' "$(ag_payload 'zensu security classify f1')" | env ZENSU_AG_HOOK_CONTRACT=superset bash "$SBSHIM" pre-bash-zensu-gate.sh 2>/dev/null)"
printf '%s' "$OUT" | grep -qiE 'state-mutating|workflow|gate' && ok "AG deny verdict carries a human reason" || bad "AG deny verdict lacks a reason: '$OUT'"
printf '%s' "$OUT" | grep -q 'permissionDecision' && bad "AG deny leaks raw permissionDecision" || ok "AG deny reason is plain (no schema leakage)"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
