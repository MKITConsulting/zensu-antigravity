#!/usr/bin/env bash
# Legacy source command references stay paired with the native skills.
# Native packages exclude commands/: current agy discovers skills directly.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

# The canonical verbs (C1). Command stem = zensu-<verb> EXCEPT zensu-help, whose
# skill dir is `zensu-help` and command is `zensu-help.md` (the stem keeps the
# zensu- prefix because the command is /zensu-help, not /zensu-zensu-help).
VERBS="adopt-session autopilot autopilot-adopt autopilot-release bootstrap converge cover delivery-route docs doctor full-suite gauntlet-loop ghost-scan implement pilot plan-review pr-fix-findings pr-team-review pulse recover-chain reset-review-limit security-review self-review session-trail setup tdd tdd-mode verify-feature wargame work zen-mode zensu-help"
EXPECTED_COUNT="$(printf '%s\n' $VERBS | wc -w | tr -d ' ')"

# skill dir for a verb
skill_dir() { printf '%s' "$1"; }
# command file stem for a verb
cmd_stem() { case "$1" in zensu-help) printf 'zensu-help' ;; *) printf 'zensu-%s' "$1" ;; esac; }

SKILL_COUNT="$(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
CMD_COUNT="$(find "$ROOT/commands" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "$SKILL_COUNT" = "$EXPECTED_COUNT" ] && ok "skills/ has $EXPECTED_COUNT skill dirs" || bad "skills/ has $SKILL_COUNT dirs (expected $EXPECTED_COUNT)"
[ "$CMD_COUNT" = "$EXPECTED_COUNT" ] && ok "commands/ has $EXPECTED_COUNT command files" || bad "commands/ has $CMD_COUNT files (expected $EXPECTED_COUNT)"

# Each verb has BOTH a skill and a command, and the command references the skill.
for v in $VERBS; do
  sd="$ROOT/skills/$(skill_dir "$v")/SKILL.md"
  cmd="$ROOT/commands/$(cmd_stem "$v").md"
  [ -f "$sd" ] && ok "skill present: skills/$(skill_dir "$v")/SKILL.md" || bad "skill MISSING: skills/$(skill_dir "$v")/SKILL.md"
  [ -f "$cmd" ] && ok "command present: commands/$(cmd_stem "$v").md" || bad "command MISSING: commands/$(cmd_stem "$v").md"
  if [ -f "$cmd" ]; then
    # Require the explicit skill PATH. A bare-verb alternation is matched by the
    # shim's own `name:` frontmatter and `# /zensu-<verb>` heading, so it cannot
    # fail even when the body loads the wrong skill — or names none at all.
    if grep -qF "skills/$(skill_dir "$v")/SKILL.md" "$cmd"; then
      ok "command $(cmd_stem "$v") references its skill"
    else
      bad "command $(cmd_stem "$v").md does not reference skill '$(skill_dir "$v")'"
    fi
  fi
done

# I15: the command shims are a HOST-CONSUMED component type (the host converts
# each into a skill), so their frontmatter deserves the same scrutiny skills get.
for v in $VERBS; do
  cmd="$ROOT/commands/$(cmd_stem "$v").md"
  [ -f "$cmd" ] || continue
  FM_NAME="$(awk '/^---$/{c++; next} c==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$cmd")"
  [ "$FM_NAME" = "$(cmd_stem "$v")" ] \
    && ok "command $(cmd_stem "$v"): frontmatter name matches the file stem" \
    || bad "command $(cmd_stem "$v"): frontmatter name '$FM_NAME' != file stem"
  FM_DESC="$(awk '/^---$/{c++; next} c==1 && /^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$cmd")"
  [ -n "$FM_DESC" ] \
    && ok "command $(cmd_stem "$v"): description present" \
    || bad "command $(cmd_stem "$v"): description missing"
done

# The retired rules-presence suite swept for foreign agent-host tool names; that
# guard had no successor, so it lives here now and covers all three component
# directories rather than only the deleted rules/.
FOREIGN="$(grep -rnE 'AskUserQuestion|MultiEdit|Skill tool' "$ROOT/commands" "$ROOT/skills" "$ROOT/agents" 2>/dev/null || true)"
[ -z "$FOREIGN" ] \
  && ok "no foreign agent-host tool names in commands/, skills/ or agents/" \
  || { bad "foreign tool names found:"; printf '%s\n' "$FOREIGN" | head -3; }

# No orphan commands (every commands/*.md maps back to a known verb's stem).
ORPHAN=""
while IFS= read -r f; do
  stem="$(basename "$f" .md)"
  match=""
  for v in $VERBS; do [ "$(cmd_stem "$v")" = "$stem" ] && match=1 && break; done
  [ -z "$match" ] && ORPHAN="$ORPHAN $stem"
done < <(find "$ROOT/commands" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
[ -z "$ORPHAN" ] && ok "no orphan commands (every command maps to a verb)" || bad "orphan command(s):$ORPHAN"

# No orphan skills (every skills/*/ maps to a known verb).
ORPHAN=""
while IFS= read -r d; do
  base="$(basename "$d")"
  match=""
  for v in $VERBS; do [ "$(skill_dir "$v")" = "$base" ] && match=1 && break; done
  [ -z "$match" ] && ORPHAN="$ORPHAN $base"
done < <(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
[ -z "$ORPHAN" ] && ok "no orphan skills (every skill maps to a verb)" || bad "orphan skill(s):$ORPHAN"

# Native plugins do not load commands/ or a commands manifest field.
node -e 'const m=require(process.argv[1]);process.exit(Object.hasOwn(m,"commands")||Object.hasOwn(m,"workflows")?1:0)' "$ROOT/plugin.json" \
  && ok "manifest omits ignored commands and workflows fields" || bad "ignored manifest fields remain"

# No `/zensu:` colon-form invocation in any command body.
if [ -d "$ROOT/commands" ]; then
  HITS="$(grep -rnE '/zensu:[a-z]' "$ROOT/commands" 2>/dev/null || true)"
  [ -z "$HITS" ] && ok "no '/zensu:' colon-form in commands/" || { bad "colon-form in commands:"; printf '%s\n' "$HITS" | head -3; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
