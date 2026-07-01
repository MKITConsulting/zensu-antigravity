#!/usr/bin/env bash
# README "### Hooks (N)" sync (BK10). A naive `/hooks\/([\w.-]+\.sh)/` regex would
# match `antigravity-shim.sh` on EVERY command line and collapse the count to 1,
# so this is written for the shim wiring: parse the WRAPPED-script token (the
# argument AFTER `antigravity-shim.sh `), count the DISTINCT wrapped scripts in
# hooks.json.template, and assert that count == the README `### Hooks (N)` header
# == every `Hooks (N)` / `#hooks-N` reference in the doc. (N is expected to be 7.)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
README="$ROOT/README.md"
TPL="$ROOT/hooks.json.template"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$TPL" ] || { bad "hooks.json.template missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

# Distinct wrapped scripts = the tokens after `antigravity-shim.sh `.
REG_N="$(node -e '
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
  process.stdout.write(String(set.size));
' "$TPL" 2>/dev/null)"
[ -n "$REG_N" ] && [ "$REG_N" -gt 0 ] && ok "template declares $REG_N distinct wrapped hook scripts" || bad "could not count wrapped scripts (got '$REG_N')"

if [ ! -f "$README" ]; then
  bad "README.md missing (another agent authors it — expected until then)"
  printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi

HDR_N="$(grep -oE '^#+ +Hooks \([0-9]+\)' "$README" | grep -oE '[0-9]+' | head -1)"
[ -n "$HDR_N" ] && ok "README has a 'Hooks (N)' header (N=$HDR_N)" || bad "README lacks a '### Hooks (N)' header"

if [ -n "$HDR_N" ] && [ -n "$REG_N" ]; then
  [ "$HDR_N" = "$REG_N" ] && ok "README header count ($HDR_N) == distinct wrapped scripts ($REG_N)" \
    || bad "README header ($HDR_N) != distinct wrapped scripts ($REG_N)"
fi

# Every 'Hooks (N)' / '#hooks-N' reference uses the header's N.
if [ -n "$HDR_N" ]; then
  BAD="$(grep -oE 'Hooks \([0-9]+\)|#hooks-[0-9]+' "$README" | grep -oE '[0-9]+' | sort -u | grep -vx "$HDR_N" | tr '\n' ' ')"
  [ -z "$BAD" ] && ok "all 'Hooks (N)'/'#hooks-N' refs use N=$HDR_N" || bad "inconsistent hook-count refs (stray: $BAD vs header $HDR_N)"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
