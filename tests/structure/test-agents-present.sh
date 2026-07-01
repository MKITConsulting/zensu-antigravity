#!/usr/bin/env bash
# agents/ representation (D5/MJ6/C12). The 3 subagents exist as markdown with
# frontmatter, are listed in plugin.json .agents[], and the two REVIEWER agents
# declare a non-empty, WRITE-FREE tools list:
#   zensu-code-reviewer  -> tools: read, run_command, grep, glob   (no write/edit)
#   zensu-review-aspect  -> tools: read, grep, glob                (no run_command)
# The CC-specific TaskCreate/TaskUpdate must be dropped.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

PLM="$ROOT/agents/zensu-plm.md"
REVIEWER="$ROOT/agents/zensu-code-reviewer.md"
ASPECT="$ROOT/agents/zensu-review-aspect.md"

for f in "$PLM" "$REVIEWER" "$ASPECT"; do
  [ -f "$f" ] && ok "agent present: agents/$(basename "$f")" || bad "agent MISSING: agents/$(basename "$f")"
done

# Listed in plugin.json .agents[]
if [ -f "$ROOT/plugin.json" ]; then
  for a in zensu-plm zensu-code-reviewer zensu-review-aspect; do
    node -e '
      const p = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const arr = p.agents || [];
      process.exit(arr.some(x => String(x).includes("/'"$a"'.md")) ? 0 : 1);
    ' "$ROOT/plugin.json" 2>/dev/null \
      && ok "plugin.json .agents[] lists $a" || bad "plugin.json .agents[] missing $a"
  done
fi

# frontmatter name: matches the file (best-effort: name: <basename-without-ext>)
fm_field() { # $1=file $2=key -> value (first occurrence inside first --- block)
  awk -v k="$2" '
    /^---[[:space:]]*$/ { c++; next }
    c==1 && $0 ~ "^"k":" { sub("^"k":[[:space:]]*",""); print; exit }
  ' "$1"
}

# extract the reviewer tools line (allow `tools:` yaml scalar) lowercased
tools_of() { fm_field "$1" tools | tr 'A-Z' 'a-z'; }

if [ -f "$REVIEWER" ]; then
  T="$(tools_of "$REVIEWER")"
  [ -n "$T" ] && ok "zensu-code-reviewer declares a non-empty tools list" || bad "zensu-code-reviewer has no tools: frontmatter"
  # write-free: no write/edit/create tool names
  if printf '%s' "$T" | grep -qE 'write_to_file|replace_file_content|multi_replace_file_content|\bwrite\b|\bedit\b|create_file|apply_patch'; then
    bad "zensu-code-reviewer tools list includes a WRITE tool: '$T'"
  else
    ok "zensu-code-reviewer tools list is WRITE-FREE"
  fi
  # may run commands (read, run_command, grep, glob)
  printf '%s' "$T" | grep -q 'run_command' && ok "zensu-code-reviewer may run_command (read-only verification)" || bad "zensu-code-reviewer lacks run_command"
  # no leftover CC task tools
  printf '%s' "$T" | grep -qiE 'taskcreate|taskupdate' && bad "zensu-code-reviewer still lists TaskCreate/TaskUpdate (CC-only)" || ok "zensu-code-reviewer dropped TaskCreate/TaskUpdate"
fi

if [ -f "$ASPECT" ]; then
  T="$(tools_of "$ASPECT")"
  [ -n "$T" ] && ok "zensu-review-aspect declares a non-empty tools list" || bad "zensu-review-aspect has no tools: frontmatter"
  if printf '%s' "$T" | grep -qE 'write_to_file|replace_file_content|multi_replace_file_content|\bwrite\b|\bedit\b|create_file|apply_patch'; then
    bad "zensu-review-aspect tools list includes a WRITE tool: '$T'"
  else
    ok "zensu-review-aspect tools list is WRITE-FREE"
  fi
  # aspect runs ZERO build/test commands -> must NOT carry run_command
  printf '%s' "$T" | grep -q 'run_command' && bad "zensu-review-aspect must NOT have run_command (zero build/test)" || ok "zensu-review-aspect has no run_command (zero build/test)"
  printf '%s' "$T" | grep -qiE 'taskcreate|taskupdate' && bad "zensu-review-aspect still lists TaskCreate/TaskUpdate (CC-only)" || ok "zensu-review-aspect dropped TaskCreate/TaskUpdate"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
