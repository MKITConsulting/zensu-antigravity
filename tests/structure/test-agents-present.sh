#!/usr/bin/env bash
# Native role representation. The core 3 roles exist as markdown with
# frontmatter, are discovered from agents/, and all seven role assets
# declare a non-empty, WRITE-FREE tools list:
#   zensu-code-reviewer  -> native file-reading tools only
#   zensu-review-aspect  -> tools: read, grep, glob                (no run_command)
# TaskCreate/TaskUpdate are not Antigravity tools and must be absent.
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

# frontmatter name: matches the file (best-effort: name: <basename-without-ext>)
fm_field() { # $1=file $2=key -> value (first occurrence inside first --- block)
  awk -v k="$2" '
    /^---[[:space:]]*$/ { c++; next }
    c==1 && $0 ~ "^"k":" { sub("^"k":[[:space:]]*",""); print; exit }
  ' "$1"
}

# Extract the canonical JSON-compatible YAML flow sequence, never a scalar.
tools_of() { node "$ROOT/tests/structure/lib-agent-frontmatter.js" "$1"; }

if node - "$ROOT" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.argv[2];
const { parse } = require(path.join(root, 'tests/structure/lib-agent-frontmatter.js'));
const expected = ['view_file', 'grep_search', 'find_by_name'];
const files = fs.readdirSync(path.join(root, 'agents')).filter(file => file.endsWith('.md'));
assert.equal(files.length, 7);
for (const file of files) {
  const metadata = parse(fs.readFileSync(path.join(root, 'agents', file), 'utf8'));
  assert.equal(metadata.name, file.slice(0, -3));
  assert.deepEqual(metadata.tools, expected, file);
}
// This is the exact installer regression: commas in a scalar do not make an array.
for (const tools of ['view_file, grep_search, find_by_name', '"view_file, grep_search"', '[]', '["view_file", 3]', '["view_file", "view_file"]']) {
  assert.throws(() => parse(`---\nname: test\ntools: ${tools}\n---\nBody`));
}
assert.deepEqual(parse('---\nname: test\ntools: ["view_file", "grep_search"]\n---\nBody').tools, ['view_file', 'grep_search']);
NODE
then
  ok "all seven agents parse tools as nonempty string arrays; scalar regression rejected"
else
  bad "agent tools frontmatter violates the native array schema"
fi

if [ -f "$REVIEWER" ]; then
  T="$(tools_of "$REVIEWER")"
  [ -n "$T" ] && ok "zensu-code-reviewer declares a non-empty tools list" || bad "zensu-code-reviewer has no tools: frontmatter"
  # write-free: no write/edit/create tool names
  if printf '%s' "$T" | grep -qE 'write_to_file|replace_file_content|multi_replace_file_content|\bwrite\b|\bedit\b|create_file|apply_patch'; then
    bad "zensu-code-reviewer tools list includes a WRITE tool: '$T'"
  else
    ok "zensu-code-reviewer tools list is WRITE-FREE"
  fi
  # The current canonical synthesis role runs no commands; the main thread owns evidence.
  printf '%s' "$T" | grep -q 'run_command' && bad "review role must not execute commands" || ok "review role has no run_command; main thread owns verification"
  # no leftover task-tracking tools
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


# Profiles must describe actual native execution and forbid fabricated completion.
for f in "$ROOT"/agents/*.md; do
  if [ "$(basename "$f")" = zensu-gauntlet-critic.md ]; then
    grep -qF 'fresh native child conversation' "$f" && ok "$(basename "$f"): native child boundary present" || bad "$(basename "$f"): native child boundary missing"
    grep -qF 'ordinary final response' "$f" && grep -qF 'never a pass' "$f" && ok "$(basename "$f"): final response and evidence gap contract present" || bad "$(basename "$f"): completion contract missing"
  else
    grep -qF 'Native reviewer profile' "$f" && grep -qF 'through `invoke_subagent`' "$f" && ok "$(basename "$f"): registered native child boundary present" || bad "$(basename "$f"): native role boundary missing"
    grep -qF 'missing private binding is a blocker' "$f" && grep -qF 'fabricate completion metadata' "$f" && ok "$(basename "$f"): private binding and real completion required" || bad "$(basename "$f"): binding or completion contract missing"
  fi
done

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
