#!/usr/bin/env bash
# Skill frontmatter compliance for all 32 zensu skills. Each skills/<verb>/
# SKILL.md must carry YAML frontmatter whose `name` equals the folder name
# (lowercase letters, digits, hyphens; max 64 chars) and a non-empty
# `description` (max 1024 chars) that opens with the `[Zensu] ` marker so the
# host's skill picker attributes it to this plugin. No skill body may reference
# the `/zensu:x` colon-form invocation (Antigravity invokes via the `/<name>`
# command shims, D4).
#
# The description extractor understands BOTH shapes in use: a single-line
# scalar (plain, single- or double-quoted) and a YAML folded/literal block.
# Reading only the header line would yield ">" for every folded description,
# which silently skips the length and prefix checks — the exact gap that let
# three over-long descriptions through before.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

EXPECTED="adopt-session autopilot autopilot-adopt autopilot-release bootstrap converge cover delivery-route docs doctor full-suite gauntlet-loop ghost-scan implement pilot plan-review pr-fix-findings pr-team-review pulse recover-chain reset-review-limit security-review self-review session-trail setup tdd tdd-mode verify-feature wargame work zen-mode zensu-help"

read_description() { # $1=SKILL.md path
  awk '
    /^---$/ { fence++; if (fence == 2) exit; next }
    fence != 1 { next }
    !seen && /^description:/ {
      seen = 1
      value = $0
      sub(/^description:[[:space:]]*/, "", value)
      if (value ~ /^[>|][-+]?[0-9]*$/) { folded = 1; next }
      printf "%s", value
      exit
    }
    folded {
      if ($0 ~ /^[[:space:]]*$/) next
      if ($0 !~ /^[[:space:]]/) exit
      line = $0
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      printf "%s%s", (started ? " " : ""), line
      started = 1
    }
  ' "$1"
}

strip_quotes() { # $1=raw scalar
  local v="$1"
  case "$v" in
    \'*\') v="${v#\'}"; v="${v%\'}"; v="$(printf '%s' "$v" | sed "s/''/'/g")" ;;
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
  esac
  printf '%s' "$v"
}

for name in $EXPECTED; do
  F="$ROOT/skills/$name/SKILL.md"
  if [ ! -f "$F" ]; then bad "$name: SKILL.md missing"; continue; fi

  FM_NAME="$(awk '/^---$/{c++; next} c==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$F")"
  [ "$FM_NAME" = "$name" ] && ok "$name: frontmatter name matches folder" || bad "$name: frontmatter name '$FM_NAME' != folder"

  printf '%s' "$FM_NAME" | grep -qE '^[a-z0-9-]{1,64}$' && ok "$name: name charset/length valid" || bad "$name: name violates ^[a-z0-9-]{1,64}\$"

  DESC="$(strip_quotes "$(read_description "$F")")"
  [ -n "$DESC" ] && ok "$name: description present" || bad "$name: description missing"
  [ "${#DESC}" -le 1024 ] && ok "$name: description <= 1024 chars (${#DESC})" || bad "$name: description too long (${#DESC})"
  case "$DESC" in
    "[Zensu] "*) ok "$name: description carries the [Zensu] prefix" ;;
    *) bad "$name: description must start with '[Zensu] ' (got '$(printf '%s' "$DESC" | cut -c1-40)')" ;;
  esac
done

# Every skill directory on disk must appear in EXPECTED — a skill added without
# updating this roster would otherwise never be checked at all.
for d in "$ROOT"/skills/*/; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"
  case " $EXPECTED " in
    *" $n "*) ;;
    *) bad "$n: skill dir on disk is absent from the EXPECTED roster" ;;
  esac
done
ok "roster covers every skill dir on disk"

# No `/zensu:` colon-form invocation anywhere in skill bodies.
if [ -d "$ROOT/skills" ]; then
  HITS="$(grep -rn "/zensu:" "$ROOT/skills" 2>/dev/null | grep -v '<!-- /zensu:' || true)"
  [ -z "$HITS" ] && ok "no /zensu: colon-form in skills/" || { bad "colon-form found:"; printf '%s\n' "$HITS" | head -5; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
