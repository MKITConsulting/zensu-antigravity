#!/usr/bin/env bash
# rules/ presence (BK3/C14/§1F). The always-on steering lives in rules/*.md. This
# asserts the 3 rules files exist, are listed in plugin.json .rules[], mention the
# load-bearing strings (Zensu PLM, the TDD workflow, the write-gate rationale),
# and carry no foreign tool names.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

CONV="$ROOT/rules/zensu-conventions.md"
TDD="$ROOT/rules/zensu-tdd.md"
GATE="$ROOT/rules/zensu-write-gate.md"

for f in "$CONV" "$TDD" "$GATE"; do
  [ -f "$f" ] && ok "rule present: rules/$(basename "$f")" || bad "rule MISSING: rules/$(basename "$f")"
done

# Listed in plugin.json .rules[]
if [ -f "$ROOT/plugin.json" ]; then
  for r in zensu-conventions zensu-tdd zensu-write-gate; do
    node -e '
      const p = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const arr = p.rules || [];
      process.exit(arr.some(x => String(x).includes("/'"$r"'.md")) ? 0 : 1);
    ' "$ROOT/plugin.json" 2>/dev/null \
      && ok "plugin.json .rules[] lists $r" || bad "plugin.json .rules[] missing $r"
  done
fi

# Load-bearing content.
[ -f "$CONV" ] && grep -qiE 'zensu|product lifecycle|PLM|feature' "$CONV" && ok "conventions rule names Zensu/PLM/features" || bad "conventions rule lacks the Zensu/PLM steering"
[ -f "$TDD" ] && grep -qiE 'tdd' "$TDD" && ok "tdd rule mentions the TDD workflow" || bad "tdd rule does not mention TDD"
[ -f "$GATE" ] && grep -qiE 'gate|mutation|write' "$GATE" && ok "write-gate rule explains the gate rationale" || bad "write-gate rule lacks gate/mutation rationale"

# No foreign tool names / colon-form in rules bodies.
if [ -d "$ROOT/rules" ]; then
  HITS="$(grep -rnE '/zensu:[a-z]|AskUserQuestion|MultiEdit|\bSkill tool\b' "$ROOT/rules" 2>/dev/null || true)"
  [ -z "$HITS" ] && ok "rules/ free of legacy tool names + colon-form" || { bad "legacy references in rules:"; printf '%s\n' "$HITS" | head -3; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
