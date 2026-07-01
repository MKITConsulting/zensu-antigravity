#!/bin/bash
set -u

# The redirection/sed-i/tee/heredoc/worktree-escape parser is engine-neutral:
# pre-bash-source-write-gate.sh reads the flat payload (tool_input.command + cwd)
# the shim produces, so the behavioral cases apply directly. The W4 wiring
# assertion checks the shim-wrapped run_command form in hooks.json.template. BK6:
# rule-B (cross-worktree escape) needs ZENSU_PROJECT_DIR (workspace root) !=
# cwd (command cwd), which the shim wires from workspacePaths[0] vs args.Cwd.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/pre-bash-source-write-gate.sh"
PARSER="$PLUGIN_DIR/hooks/lib/bash-source-write-parse.js"
TPL="$PLUGIN_DIR/hooks.json.template"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$HOOK" ]; then
  check "hooks/pre-bash-source-write-gate.sh exists" FAIL
  echo "----"; echo "test-bash-source-write-gate: $PASS PASS / $FAIL FAIL"; exit 1
fi

check "W1 hook exists" PASS
bash -n "$HOOK" 2>/dev/null && check "W2 hook bash -n syntax" PASS || check "W2 hook bash -n syntax" FAIL
{ [ -f "$PARSER" ] && node --check "$PARSER" 2>/dev/null; } && check "W3 parser exists + node --check" PASS || check "W3 parser exists + node --check" FAIL

# W4 (Antigravity wiring): shim-wrapped under a run_command matcher.
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let hit = false;
  for (const group of Object.values(t)) for (const [ev, arr] of Object.entries(group||{})) {
    if (ev !== "PreToolUse") continue;
    for (const e of (arr||[])) {
      if ((e.matcher||"") !== "run_command") continue;
      for (const h of (e.hooks||[])) if (/antigravity-shim\.sh pre-bash-source-write-gate\.sh/.test(h.command||"")) hit = true;
    }
  }
  process.exit(hit ? 0 : 1);
' "$TPL" 2>/dev/null \
  && check "W4 wired as PreToolUse run_command, shim-wrapped (Antigravity form)" PASS || check "W4 wired as PreToolUse run_command" FAIL

grep -qF 'zensu_hook_enabled bashWriteGate' "$HOOK" \
  && check "W5 config-gated via zensu_hook_enabled bashWriteGate (default-on)" PASS \
  || check "W5 config-gated via zensu_hook_enabled bashWriteGate (default-on)" FAIL

# ── Behavioral harness (real git project + sibling checkout) ──────────
WORKROOT="$PLUGIN_DIR/tests/.bswgate-tmp.$$"
trap 'rm -rf "$WORKROOT"' EXIT
PROJ="$WORKROOT/proj"; SIB="$WORKROOT/sibling"; FAKETMP="$WORKROOT/faketmp"
mkdir -p "$PROJ/src" "$PROJ/build" "$SIB/src" "$FAKETMP"
(
  cd "$PROJ" && git init -q && git config user.email t@t && git config user.name t \
    && printf 'fn main(){}\n' > src/app.rs && printf 'build/\n' > .gitignore \
    && git add src/app.rs .gitignore && git commit -qm init && printf 'gen\n' > build/gen.rs
) >/dev/null 2>&1
(
  cd "$SIB" && git init -q && git config user.email t@t && git config user.name t \
    && printf 'pub fn x(){}\n' > src/lib.rs && git add src/lib.rs && git commit -qm init
) >/dev/null 2>&1

CFG_DEF="$(mktemp -t bswgate-def-XXXXXX)";  printf '%s' '{"hooks":{}}'                       > "$CFG_DEF"
CFG_OFF="$(mktemp -t bswgate-off-XXXXXX)";   printf '%s' '{"hooks":{"bashWriteGate":false}}' > "$CFG_OFF"

payload() {
  CMD="$1" CWD="${2:-$PROJ}" node -e '
    const o={hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:process.env.CMD},cwd:process.env.CWD,session_id:"bswgate-test"};
    process.stdout.write(JSON.stringify(o));
  '
}
classify() {
  node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      s=s.trim();
      if(!s){process.stdout.write("ALLOW");return;}
      try{const j=JSON.parse(s);const d=j.hookSpecificOutput&&j.hookSpecificOutput.permissionDecision;process.stdout.write(d==="deny"?"DENY":(d||"OTHER"));}
      catch(_){process.stdout.write("BADJSON");}
    });
  '
}
run() {
  local label="$1" cmd="$2" exp="$3" cwd="${4:-$PROJ}" cfg="${5:-$CFG_DEF}"
  local out
  out="$(payload "$cmd" "$cwd" | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$PROJ" \
        ZENSU_CONFIG="$cfg" ZENSU_BSWGATE_TEMP_DIRS="$FAKETMP" bash "$HOOK" 2>/dev/null | classify)"
  [ "$out" = "$exp" ] && check "$label -> $exp" PASS || check "$label (got '$out' want '$exp')" FAIL
}

# (A) clobber existing tracked source -> DENY
run "W6 append >> tracked .rs"              "printf 'x\n' >> src/app.rs"            DENY
run "W7 clobber > tracked .rs"              "printf 'x\n' > src/app.rs"             DENY
run "W9 tee tracked .rs"                    "echo x | tee src/app.rs"               DENY
run "W11 sed -i '' tracked .rs"            "sed -i '' 's/x/y/' src/app.rs"         DENY
run "W13 dd of= tracked .rs"              "dd if=/dev/null of=src/app.rs"         DENY
HEREDOC="$(printf 'cat > src/app.rs <<EOF\nZZZ_BROKEN\nEOF\n')"
run "W14 heredoc clobber tracked .rs"     "$HEREDOC"                              DENY

# (B) worktree / project escape -> DENY (BK6: needs ZENSU_PROJECT_DIR != cwd)
run "W15 relative escape to sibling"      "printf x >> ../sibling/src/lib.rs"     DENY
run "W16 cd-into-sibling then write"      "cd ../sibling && printf x >> src/lib.rs" DENY
run "W17 escape, brand-new file"          "printf x > ../sibling/src/brandnew.rs" DENY
run "W18 absolute escape path"            "printf x >> $SIB/src/lib.rs"           DENY

# Allow — Bash keeps normal file power
run "W19 new file inside project"         "printf x > src/newfile.rs"             ALLOW
run "W21 non-source extension (.md)"      "echo hi > notes.md"                    ALLOW
run "W22 gitignored existing .rs"         "printf x >> build/gen.rs"              ALLOW
run "W24 read, no write"                  "cat src/app.rs"                        ALLOW
run "W25 plain command, no write"         "git status"                            ALLOW

# Escape hatch + config
run "W27 inline ZENSU_BASH_WRITE_GATE=off" "ZENSU_BASH_WRITE_GATE=off printf x >> src/app.rs" ALLOW
run "W28 inline ZENSU_MCP_GATE=off"        "ZENSU_MCP_GATE=off printf x >> src/app.rs"        ALLOW
run "W29 config bashWriteGate:false"       "printf x >> src/app.rs" ALLOW "$PROJ" "$CFG_OFF"

# Fail-open: empty + non-JSON -> ALLOW
OUT="$(printf '' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_DEF" bash "$HOOK" 2>/dev/null | classify)"
OUT2="$(printf '%s' 'not json' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$CFG_DEF" bash "$HOOK" 2>/dev/null | classify)"
{ [ "$OUT" = "ALLOW" ] && [ "$OUT2" = "ALLOW" ]; } \
  && check "W31 fail-open: empty + non-JSON -> ALLOW" PASS || check "W31 fail-open (empty='$OUT' nonjson='$OUT2')" FAIL

# Deny-reason content
REASON_A="$(payload 'printf x >> src/app.rs' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$PROJ" \
          ZENSU_CONFIG="$CFG_DEF" ZENSU_BSWGATE_TEMP_DIRS="$FAKETMP" bash "$HOOK" 2>/dev/null)"
{ printf '%s' "$REASON_A" | grep -qF 'tracked' && printf '%s' "$REASON_A" | grep -qF 'ZENSU_BASH_WRITE_GATE=off'; } \
  && check "W32 clobber deny-reason: 'tracked' + escape-hatch hint" PASS || check "W32 clobber deny-reason content" FAIL

REASON_B="$(payload 'printf x >> ../sibling/src/lib.rs' | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$PROJ" \
          ZENSU_CONFIG="$CFG_DEF" ZENSU_BSWGATE_TEMP_DIRS="$FAKETMP" bash "$HOOK" 2>/dev/null)"
{ printf '%s' "$REASON_B" | grep -qiF 'worktree' && printf '%s' "$REASON_B" | grep -qF 'ZENSU_BASH_WRITE_GATE=off'; } \
  && check "W33 escape deny-reason: 'worktree' + escape-hatch hint [BK6]" PASS || check "W33 escape deny-reason content" FAIL

# Regression pins
run "W34 stderr-redirect is not a write"        "cat src/app.rs 2>&1"                       ALLOW
run "W36 quoted '>' in a message arg"           'git commit -m "refactor > faster"'         ALLOW
run "W44 redirect-all &> gated"                 "printf x &> src/app.rs"                     DENY
run "W55 env-wrapped sed -i"                    "env sed -i '' 's/x/y/' src/app.rs"         DENY
run "W56 sudo-wrapped dd of="                   "sudo dd if=/dev/null of=src/app.rs"        DENY
run "W60 >&2 fd-dup is not a file write"        "echo x >&2"                                ALLOW

rm -f "$CFG_DEF" "$CFG_OFF"

echo "----"
echo "test-bash-source-write-gate: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
