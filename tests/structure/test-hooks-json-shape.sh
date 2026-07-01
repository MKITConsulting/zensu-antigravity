#!/usr/bin/env bash
# hooks.json.template shape (the TRACKED artifact install.sh renders into the
# real, gitignored hooks.json). Pins the canonical Antigravity wiring:
#   - every hook command is shim-wrapped: `bash __ZENSU_HOME__/hooks/antigravity/
#     antigravity-shim.sh <bare-script>.sh` (BK1)
#   - the wrapped `$1` token is a BARE name — contains NO `/` (BK1; the shim
#     resolves SCRIPT="$ROOT/hooks/$1", so a slash here would be a mis-render)
#   - the only `__ZENSU_HOME__` occurrences are inside command strings (install
#     renders them to one absolute root)
#   - event keys come from the Antigravity set {PreToolUse, PreInvocation,
#     PostToolUse, Stop} (C10)
#   - the edit matcher is exactly `write_to_file|replace_file_content|
#     multi_replace_file_content` (BK4 — never drop multi_*, never add CC's
#     Edit|Write|MultiEdit), the shell matcher is `run_command` (C3)
#   - the wrapped scripts wired per event match C10 exactly
#   - every wrapped script resolves to a file under hooks/ on disk
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/hooks.json.template"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

[ -f "$TPL" ] || { bad "hooks.json.template missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TPL" 2>/dev/null \
  && ok "hooks.json.template is valid JSON" || { bad "hooks.json.template is not valid JSON"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

# Every command is shim-wrapped with a BARE script arg (no slash in $1).
SHAPE="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let total=0, wrapped=0, bareOk=0, homeOk=0;
  const re = /^bash\s+__ZENSU_HOME__\/hooks\/antigravity\/antigravity-shim\.sh\s+(\S+)\s*$/;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.command === "string") {
        total++;
        const m = o.command.match(re);
        if (m) {
          wrapped++;
          const arg = m[1];
          if (!arg.includes("/")) bareOk++;     // BK1: $1 is a BARE name
          // __ZENSU_HOME__ must appear exactly once (the shim path prefix)
          const occ = (o.command.match(/__ZENSU_HOME__/g) || []).length;
          if (occ === 1) homeOk++;
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(t);
  process.stdout.write([total, wrapped, bareOk, homeOk].join(" "));
' "$TPL" 2>/dev/null)"
read -r N_TOTAL N_WRAP N_BARE N_HOME <<EOF
$SHAPE
EOF
[ "${N_TOTAL:-0}" -gt 0 ] && ok "template declares $N_TOTAL hook commands" || bad "no hook commands found"
[ "$N_TOTAL" = "$N_WRAP" ] && ok "every command is antigravity-shim.sh-wrapped ($N_WRAP/$N_TOTAL)" || bad "un-wrapped commands ($N_WRAP/$N_TOTAL shim-wrapped)"
[ "$N_TOTAL" = "$N_BARE" ] && ok "every wrapped \$1 is a BARE script name (no '/') [BK1]" || bad "a wrapped \$1 contains '/' ($N_BARE/$N_TOTAL bare)"
[ "$N_TOTAL" = "$N_HOME" ] && ok "each command has exactly one __ZENSU_HOME__ (the shim prefix)" || bad "command with stray/missing __ZENSU_HOME__ ($N_HOME/$N_TOTAL)"

# Event keys ∈ {PreToolUse, PreInvocation, PostToolUse, Stop}.
EVENTS="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const allowed = new Set(["PreToolUse","PreInvocation","PostToolUse","Stop"]);
  const seen = new Set();
  let bad = "";
  for (const group of Object.values(t)) {
    if (group && typeof group === "object") {
      for (const ev of Object.keys(group)) {
        seen.add(ev);
        if (!allowed.has(ev)) bad += ev + " ";
      }
    }
  }
  process.stdout.write(JSON.stringify({ seen: [...seen].sort(), bad: bad.trim() }));
' "$TPL" 2>/dev/null)"
BADEV="$(printf '%s' "$EVENTS" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(s).bad)}catch(_){}})')"
[ -z "$BADEV" ] && ok "all event keys ∈ {PreToolUse,PreInvocation,PostToolUse,Stop}" || bad "unexpected event key(s): $BADEV"

# Matchers: edit matcher exact (BK4), shell matcher run_command (C3).
EDIT_OK="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const want = "write_to_file|replace_file_content|multi_replace_file_content";
  let editFound = false, runFound = false, badMatcher = "";
  const visitEntry = (ev, e) => {
    const m = e.matcher;
    if (ev === "PreToolUse") {
      const cmds = (e.hooks||[]).map(h=>h.command||"").join(" ");
      if (/pre-edit/.test(cmds)) { editFound = (m === want); if (m !== want) badMatcher = "edit:"+m; }
      if (/pre-bash/.test(cmds)) { if (m === "run_command") runFound = true; else badMatcher = "bash:"+m; }
    }
    if (ev === "PostToolUse") {
      if (m !== "run_command") badMatcher = "post:"+m;
    }
  };
  for (const group of Object.values(t)) {
    for (const [ev, arr] of Object.entries(group||{})) {
      (arr||[]).forEach(e => visitEntry(ev, e));
    }
  }
  process.stdout.write(JSON.stringify({ editFound, runFound, badMatcher }));
' "$TPL" 2>/dev/null)"
EF="$(printf '%s' "$EDIT_OK" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(String(JSON.parse(s).editFound))}catch(_){}})')"
RF="$(printf '%s' "$EDIT_OK" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(String(JSON.parse(s).runFound))}catch(_){}})')"
BM="$(printf '%s' "$EDIT_OK" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(s).badMatcher)}catch(_){}})')"
[ "$EF" = "true" ] && ok "edit matcher == write_to_file|replace_file_content|multi_replace_file_content [BK4]" || bad "edit matcher wrong (badMatcher=$BM)"
[ "$RF" = "true" ] && ok "shell (pre-bash) matcher == run_command [C3]" || bad "shell matcher wrong (badMatcher=$BM)"
[ -z "$BM" ] && ok "no unexpected matchers on Pre/PostToolUse" || bad "unexpected matcher: $BM"

# Per-event registration (C10): the expected wrapped script is wired to the
# expected event. wired <event> <script-substr>
wired() { # $1=event $2=substr
  node -e '
    const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const ev = process.argv[2], sub = process.argv[3];
    let hit = false;
    for (const group of Object.values(t)) {
      for (const [e, arr] of Object.entries(group||{})) {
        if (e !== ev) continue;
        for (const entry of (arr||[])) for (const h of (entry.hooks||[])) {
          if ((h.command||"").includes("antigravity-shim.sh "+sub)) hit = true;
        }
      }
    }
    process.exit(hit ? 0 : 1);
  ' "$TPL" "$1" "$2" 2>/dev/null
}
wired PreToolUse    pre-edit-tdd-reminder.sh        && ok "PreToolUse wires pre-edit-tdd-reminder.sh"      || bad "pre-edit-tdd-reminder.sh not on PreToolUse"
wired PreToolUse    pre-bash-zensu-gate.sh          && ok "PreToolUse wires pre-bash-zensu-gate.sh"        || bad "pre-bash-zensu-gate.sh not on PreToolUse"
wired PreToolUse    pre-bash-source-write-gate.sh   && ok "PreToolUse wires pre-bash-source-write-gate.sh" || bad "pre-bash-source-write-gate.sh not on PreToolUse"
wired PreInvocation user-prompt-intent-router.sh    && ok "PreInvocation wires user-prompt-intent-router.sh" || bad "intent-router not on PreInvocation"
wired PreInvocation user-prompt-tdd-reminder.sh     && ok "PreInvocation wires user-prompt-tdd-reminder.sh"  || bad "tdd-reminder not on PreInvocation"
wired PostToolUse   post-bash-witness.sh            && ok "PostToolUse wires post-bash-witness.sh"        || bad "witness not on PostToolUse"
wired Stop          stop-chain-enforcer.sh          && ok "Stop wires stop-chain-enforcer.sh"             || bad "stop-chain-enforcer.sh not on Stop"

# MJ5 / MN4: no PostToolUse subagent-completion delegate; context-nudge unwired.
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let bad = "";
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.command === "string") {
        if (/post-review-tdd-delegate\.sh/.test(o.command)) bad += "post-review-tdd-delegate ";
        if (/plan-approved-delegate\.sh/.test(o.command)) bad += "plan-approved-delegate ";
        if (/user-prompt-context-nudge\.sh/.test(o.command)) bad += "context-nudge ";
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(t);
  process.exit(bad ? 1 : 0);
' "$TPL" 2>/dev/null \
  && ok "no Scenario-A delegate / context-nudge wired (safe default) [MJ5/MN4]" \
  || bad "an unwired-by-default hook is wired in the template"

# Every wrapped script exists under hooks/.
MISSING=""
while IFS= read -r s; do
  [ -z "$s" ] && continue
  [ -f "$ROOT/hooks/$s" ] || MISSING="$MISSING $s"
done < <(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const set = new Set();
  const re = /antigravity-shim\.sh\s+(\S+)/;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.command === "string") { const m = o.command.match(re); if (m) set.add(m[1]); }
      Object.values(o).forEach(walk);
    }
  };
  walk(t);
  for (const s of set) console.log(s);
' "$TPL" 2>/dev/null)
[ -z "$MISSING" ] && ok "every wrapped script resolves to a file under hooks/" || bad "wrapped scripts missing on disk:$MISSING"

# No Claude colon-form names leaked into the template commands.
grep -qE 'zensu:[a-z]' "$TPL" && bad "template carries Claude colon-form (zensu:foo)" || ok "no Claude colon-form names in template"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
