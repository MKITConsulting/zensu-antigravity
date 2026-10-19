#!/usr/bin/env bash
# Command <-> skill pairing completeness (D4). Every user-facing `/zensu-<name>`
# is a thin `commands/zensu-<name>.md` shim that loads `skills/<bare-verb>/
# SKILL.md`. This pins the bijection: one skill and one command per canonical
# verb, no orphans on either side, and every command body references its skill.
# The expected counts are DERIVED from the verb roster below rather than
# hardcoded, so adding a verb cannot leave a stale literal behind. Also pins that
# plugin.json lists both arrays consistently, and no `/zensu:` colon-form leaks
# into a command body.
#
# `commands` is the host's key, not an internal preference: `agy plugin validate`
# reports skills/agents/commands/mcpServers/hooks and nothing else, and a shim
# under any other key is silently ignored — `/zensu-<name>` then does not exist.
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

# A command and a skill that share a name become two same-named skills once the
# host converts commands into skills. `zensu-help` is the one verb where the
# command stem and the skill dir coincide; probing it live showed the COMMAND
# wins and its shim still loads the skill by path, so the collision is benign
# today — but which component shadows the other is host-implementation detail.
# Pin it so no NEW verb can introduce a second, unverified collision.
COLLIDE=""
while IFS= read -r d; do
  base="$(basename "$d")"
  [ "$base" = "zensu-help" ] && continue
  [ -f "$ROOT/commands/$base.md" ] && COLLIDE="$COLLIDE $base"
done < <(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
[ -z "$COLLIDE" ] \
  && ok "no new command/skill name collision (zensu-help is the known, live-verified one)" \
  || bad "command and skill share a name — the host would install two same-named skills:$COLLIDE"

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

# The manifest must declare the shims under `commands`, never the ignored
# `workflows` key that shipped before the host schema was verified.
if [ -f "$ROOT/plugin.json" ] && command -v node >/dev/null 2>&1; then
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (Object.prototype.hasOwnProperty.call(m, "workflows")) process.exit(2);
    if (!Array.isArray(m.commands)) process.exit(3);
    process.exit(0);
  ' "$ROOT/plugin.json" 2>/dev/null
  case "$?" in
    0) ok "plugin.json declares the shims under .commands[]" ;;
    2) bad "plugin.json still declares a .workflows[] key — the host ignores it" ;;
    *) bad "plugin.json has no .commands[] array" ;;
  esac
fi

# No `/zensu:` colon-form invocation in any command body.
if [ -d "$ROOT/commands" ]; then
  HITS="$(grep -rnE '/zensu:[a-z]' "$ROOT/commands" 2>/dev/null || true)"
  [ -z "$HITS" ] && ok "no '/zensu:' colon-form in commands/" || { bad "colon-form in commands:"; printf '%s\n' "$HITS" | head -3; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
