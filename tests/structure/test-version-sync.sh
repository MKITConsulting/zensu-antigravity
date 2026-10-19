#!/usr/bin/env bash
# The version invariant: plugin.json version == README badge == newest CHANGELOG
# heading, all in the same commit. Machine-enforced here, used by
# .github/workflows/release.yml. Antigravity has no custom marketplace manifest, so the
# invariant is 3 files — there is intentionally no marketplace.json to keep in
# sync.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

MANIFEST="$ROOT/plugin.json"
V="$(node -e 'process.stdout.write(String(require(process.argv[1]).version || ""))' "$MANIFEST" 2>/dev/null)"
printf '%s' "$V" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' && ok "plugin.json version is semver ($V)" || bad "plugin.json version malformed: '$V'"

if [ -f "$ROOT/README.md" ]; then
  grep -qE "badge/version-$V-" "$ROOT/README.md" && ok "README badge carries $V" || bad "README badge does not carry $V"
else
  bad "README.md missing"
fi

if [ -f "$ROOT/CHANGELOG.md" ]; then
  CL="$(grep -m1 -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' "$ROOT/CHANGELOG.md" | tr -d '#[] ')"
  [ "$CL" = "$V" ] && ok "newest CHANGELOG heading == $V" || bad "CHANGELOG newest '$CL' != '$V'"
else
  bad "CHANGELOG.md missing"
fi

# Google's curated Marketplace does not document a repository-owned manifest.
[ -f "$ROOT/marketplace.json" ] && bad "unsupported custom marketplace.json present" || ok "no unsupported custom marketplace manifest"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
