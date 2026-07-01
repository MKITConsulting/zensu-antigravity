#!/usr/bin/env bash
# CHANGELOG structure (the release publish job greps this): the newest version
# section heading matches `## [X.Y.Z] - YYYY-MM-DD`, an `## [Unreleased]` anchor
# exists (the release pipeline splices new sections under it), and the awk
# extraction the publish job uses bounds the newest section to the next heading.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CL="$ROOT/CHANGELOG.md"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

[ -f "$CL" ] || { bad "CHANGELOG.md missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

grep -qE '^## \[Unreleased\]' "$CL" && ok "has an [Unreleased] anchor (release splice point)" || bad "no [Unreleased] anchor"

# Newest dated version heading is well-formed.
HEAD="$(grep -m1 -E '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' "$CL")"
[ -n "$HEAD" ] && ok "has a versioned section ($HEAD)" || bad "no versioned section heading"
printf '%s' "$HEAD" | grep -qE '^## \[[0-9]+\.[0-9]+\.[0-9]+\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$' \
  && ok "newest version heading matches '## [X.Y.Z] - YYYY-MM-DD'" || bad "newest heading malformed: '$HEAD'"

# The publish-job awk extraction bounds the section to the next heading.
VER="$(printf '%s' "$HEAD" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ -n "$VER" ]; then
  BODY="$(awk -v ver="$VER" '
    $0 ~ "^## \\[" ver "\\]" { f = 1; next }
    f && /^## \[/ { f = 0 }
    f { print }
  ' "$CL")"
  [ -n "$BODY" ] && ok "newest section has extractable body (release notes)" || bad "newest section body empty"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
