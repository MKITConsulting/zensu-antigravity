#!/usr/bin/env bash
# plugin.json manifest sanity. Parses; carries name/version/description; the
# skills / rules / agents / workflows arrays reference paths that EXIST on disk;
# the `hooks` ref points at ./hooks.json (the install-generated file); declares
# NO mcpServers key (CLI-driven, D6); keywords include "antigravity".
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M="$ROOT/plugin.json"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$M" ] || { bad "plugin.json missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$M" 2>/dev/null \
  && ok "plugin.json parses" || { bad "plugin.json invalid JSON"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

get() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=p[process.argv[2]];process.stdout.write(v===undefined?"":(typeof v==="object"?JSON.stringify(v):String(v)))' "$M" "$1"; }

[ -n "$(get name)" ] && ok "has name ($(get name))" || bad "missing name"
[ -n "$(get version)" ] && ok "has version ($(get version))" || bad "missing version"
[ -n "$(get description)" ] && ok "has description" || bad "missing description"

# skills/rules/agents/workflows arrays reference existing paths.
check_array() { # $1=key
  local key="$1" missing=""
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    # SKILL paths are dirs; rules/agents/workflows are files
    if [ -e "$ROOT/$rel" ] || [ -e "$ROOT/$rel/SKILL.md" ]; then :; else missing="$missing $rel"; fi
  done < <(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const x of (p[process.argv[2]]||[]))console.log(String(x).replace(/^\.\//,""))' "$M" "$key")
  [ -z "$missing" ] && ok ".$key[] all reference existing paths" || bad ".$key[] missing on disk:$missing"
}
check_array skills
check_array rules
check_array agents
check_array workflows

# array cardinalities
SK="$(node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).skills||[]).length)' "$M")"
WF="$(node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workflows||[]).length)' "$M")"
AG="$(node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).agents||[]).length)' "$M")"
RU="$(node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).rules||[]).length)' "$M")"
# Expected cardinalities come from the filesystem, not from frozen literals:
# what matters is that the manifest declares exactly what ships, so a new skill
# that nobody registered fails here instead of silently never loading.
SK_DISK="$(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
WF_DISK="$(find "$ROOT/workflows" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
AG_DISK="$(find "$ROOT/agents" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
RU_DISK="$(find "$ROOT/rules" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "$SK" = "$SK_DISK" ] && ok "$SK skills declared, matching skills/ on disk" || bad "skills count = $SK (skills/ has $SK_DISK)"
[ "$WF" = "$WF_DISK" ] && ok "$WF workflows declared, matching workflows/ on disk" || bad "workflows count = $WF (workflows/ has $WF_DISK)"
[ "$AG" = "$AG_DISK" ] && ok "$AG agents declared, matching agents/ on disk" || bad "agents count = $AG (agents/ has $AG_DISK)"
[ "$RU" = "$RU_DISK" ] && ok "$RU rules declared, matching rules/ on disk" || bad "rules count = $RU (rules/ has $RU_DISK)"

# hooks ref points at ./hooks.json (string)
HK="$(get hooks)"
case "$HK" in *hooks.json*) ok "hooks ref points at hooks.json ($HK)" ;; *) bad "hooks ref wrong: $HK" ;; esac

# NO mcpServers / mcp key (CLI-driven, D6)
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit((p.mcpServers||p.mcp)?1:0)' "$M" 2>/dev/null \
  && ok "no mcpServers / mcp key (CLI-driven, D6)" || bad "plugin.json declares mcpServers/mcp (should be CLI-driven)"

# keywords include antigravity
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit((p.keywords||[]).includes("antigravity")?0:1)' "$M" 2>/dev/null \
  && ok 'keywords include "antigravity"' || bad 'keywords missing "antigravity"'

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
