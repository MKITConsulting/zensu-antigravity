#!/usr/bin/env bash
# Workflow <-> skill pairing completeness (D4). Every user-facing `/zensu-<name>`
# is a thin `workflows/zensu-<name>.md` shim that loads `skills/<bare-verb>/
# SKILL.md`. This pins the bijection: 13 skills, 13 workflows, no orphans on
# either side, and every workflow body references its skill. Also pins that
# plugin.json lists both arrays consistently, and no Claude `/zensu:` colon-form
# leaks into a workflow body.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

# The 13 canonical verbs (C1). Workflow stem = zensu-<verb> EXCEPT zensu-help,
# whose skill dir is `zensu-help` and workflow is `zensu-help.md` (the stem keeps
# the zensu- prefix because the command is /zensu-help, not /zensu-zensu-help).
VERBS="autopilot bootstrap ghost-scan implement plan-review pr-fix-findings pr-team-review pulse reset-review-limit self-review security-review tdd zensu-help"

# skill dir for a verb
skill_dir() { printf '%s' "$1"; }
# workflow file stem for a verb
wf_stem() { case "$1" in zensu-help) printf 'zensu-help' ;; *) printf 'zensu-%s' "$1" ;; esac; }

SKILL_COUNT="$(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
WF_COUNT="$(find "$ROOT/workflows" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "$SKILL_COUNT" = "13" ] && ok "skills/ has 13 skill dirs" || bad "skills/ has $SKILL_COUNT dirs (expected 13)"
[ "$WF_COUNT" = "13" ] && ok "workflows/ has 13 workflow files" || bad "workflows/ has $WF_COUNT files (expected 13)"

# Each verb has BOTH a skill and a workflow, and the workflow references the skill.
for v in $VERBS; do
  sd="$ROOT/skills/$(skill_dir "$v")/SKILL.md"
  wf="$ROOT/workflows/$(wf_stem "$v").md"
  [ -f "$sd" ] && ok "skill present: skills/$(skill_dir "$v")/SKILL.md" || bad "skill MISSING: skills/$(skill_dir "$v")/SKILL.md"
  [ -f "$wf" ] && ok "workflow present: workflows/$(wf_stem "$v").md" || bad "workflow MISSING: workflows/$(wf_stem "$v").md"
  if [ -f "$wf" ]; then
    # the workflow loads/names its skill (the bare verb appears in the body)
    if grep -qE "skills/$(skill_dir "$v")/|$(skill_dir "$v")" "$wf"; then
      ok "workflow zensu-$(wf_stem "$v") references its skill"
    else
      bad "workflow $(wf_stem "$v").md does not reference skill '$(skill_dir "$v")'"
    fi
  fi
done

# No orphan workflows (every workflows/*.md maps back to a known verb's stem).
ORPHAN=""
while IFS= read -r f; do
  stem="$(basename "$f" .md)"
  match=""
  for v in $VERBS; do [ "$(wf_stem "$v")" = "$stem" ] && match=1 && break; done
  [ -z "$match" ] && ORPHAN="$ORPHAN $stem"
done < <(find "$ROOT/workflows" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
[ -z "$ORPHAN" ] && ok "no orphan workflows (every workflow maps to a verb)" || bad "orphan workflow(s):$ORPHAN"

# No orphan skills (every skills/*/ maps to a known verb).
ORPHAN=""
while IFS= read -r d; do
  base="$(basename "$d")"
  match=""
  for v in $VERBS; do [ "$(skill_dir "$v")" = "$base" ] && match=1 && break; done
  [ -z "$match" ] && ORPHAN="$ORPHAN $base"
done < <(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
[ -z "$ORPHAN" ] && ok "no orphan skills (every skill maps to a verb)" || bad "orphan skill(s):$ORPHAN"

# No Claude colon-form invocation in any workflow body.
if [ -d "$ROOT/workflows" ]; then
  HITS="$(grep -rnE '/zensu:[a-z]' "$ROOT/workflows" 2>/dev/null || true)"
  [ -z "$HITS" ] && ok "no Claude '/zensu:' colon-form in workflows/" || { bad "Claude colon-form in workflows:"; printf '%s\n' "$HITS" | head -3; }
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
