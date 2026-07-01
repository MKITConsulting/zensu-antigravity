#!/usr/bin/env bash
# Skill frontmatter compliance for all 13 zensu skills. Each skills/<verb>/
# SKILL.md must carry YAML frontmatter whose `name` equals the folder name
# (lowercase letters, digits, hyphens; max 64 chars) and a non-empty
# `description` (max 1024 chars). No skill body may reference the
# `/zensu:x` colon-form invocation (Antigravity invokes via the `/<name>`
# workflow shims, D4).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

EXPECTED="autopilot bootstrap ghost-scan implement plan-review pr-fix-findings pr-team-review pulse reset-review-limit security-review self-review tdd zensu-help"

for name in $EXPECTED; do
  F="$ROOT/skills/$name/SKILL.md"
  if [ ! -f "$F" ]; then bad "$name: SKILL.md missing"; continue; fi

  FM_NAME="$(awk '/^---$/{c++; next} c==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$F")"
  [ "$FM_NAME" = "$name" ] && ok "$name: frontmatter name matches folder" || bad "$name: frontmatter name '$FM_NAME' != folder"

  printf '%s' "$FM_NAME" | grep -qE '^[a-z0-9-]{1,64}$' && ok "$name: name charset/length valid" || bad "$name: name violates ^[a-z0-9-]{1,64}\$"

  DESC="$(awk '/^---$/{c++; next} c==1 && /^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$F")"
  [ -n "$DESC" ] && ok "$name: description present" || bad "$name: description missing"
  [ "${#DESC}" -le 1024 ] && ok "$name: description <= 1024 chars (${#DESC})" || bad "$name: description too long (${#DESC})"
done

# No `/zensu:` colon-form invocation anywhere in skill bodies.
if [ -d "$ROOT/skills" ]; then
  HITS="$(grep -rn "/zensu:" "$ROOT/skills" 2>/dev/null || true)"
  [ -z "$HITS" ] && ok "no /zensu: colon-form in skills/" || { bad "colon-form found:"; printf '%s\n' "$HITS" | head -5; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
