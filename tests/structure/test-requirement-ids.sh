#!/bin/bash
set -u

# Stable requirement IDs with end-to-end traceability.
#
# The contract: a requirement gets an `AC-###` / `FR-###` id ONCE, at planning
# time, and every downstream stage refers back to that id instead of re-deriving
# its own numbering. This test pins the three properties that make the chain
# hold — the ID FORMAT is documented, allocation is MONOTONIC and never
# RECYCLED, and each downstream stage (implementation, review, validation)
# carries the traceability obligation in writing.
#
# Prose is the enforcement surface here: these skills are executed by a model,
# so a rule that is not written down does not exist.

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TDD="$PLUGIN_DIR/skills/tdd/SKILL.md"
AUTOPILOT="$PLUGIN_DIR/skills/autopilot/SKILL.md"
IMPLEMENT="$PLUGIN_DIR/skills/implement/SKILL.md"
# The artifact SHAPES live in the shipped templates the skills resolve; the
# skills own the RULES about those shapes.
PLAN_TPL="$PLUGIN_DIR/templates/tdd-plan.md"
SPEC_TPL="$PLUGIN_DIR/templates/autopilot-spec.md"
PR_TPL="$PLUGIN_DIR/templates/autopilot-pr-body.md"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}
has()  { grep -qF -- "$2" "$1" 2>/dev/null; }
hasE() { grep -qEi -- "$2" "$1" 2>/dev/null; }

for f in "$TDD" "$AUTOPILOT" "$IMPLEMENT"; do
  [ -f "$f" ] || { check "R0 missing skill file: ${f#"$PLUGIN_DIR"/}" FAIL; }
done
if [ -f "$TDD" ] && [ -f "$AUTOPILOT" ] && [ -f "$IMPLEMENT" ]; then
  check "R0 tdd + autopilot + implement skills present" PASS
fi

# --- 1) the ID format is documented ----------------------------------------
has "$TDD" 'AC-###' && check "R1 tdd documents the AC-### id format" PASS || check "R1 tdd AC-### format" FAIL
has "$TDD" 'FR-###' && check "R2 tdd documents the FR-### id format" PASS || check "R2 tdd FR-### format" FAIL
has "$AUTOPILOT" 'AC-###' && check "R3 autopilot documents the AC-### id format" PASS || check "R3 autopilot AC-### format" FAIL

# The plan template must carry the Requirements table the ids live in, with the
# id column and a worked example row, and the skill must require that section.
has "$PLAN_TPL" '## Requirements' && check "R4 plan template has a ## Requirements section" PASS || check "R4 plan template Requirements section" FAIL
hasE "$PLAN_TPL" '\| ID \| Requirement \| Source \|' && check "R5 Requirements table header is ID/Requirement/Source" PASS || check "R5 Requirements table header" FAIL
has "$PLAN_TPL" 'AC-001' && check "R6 Requirements table shows an allocated example id" PASS || check "R6 example id" FAIL
hasE "$TDD" 'MUST keep the mandatory sections' && has "$TDD" '## Requirements' \
  && check "R6b a repo template override must keep the Requirements section" PASS || check "R6b override mandatory sections" FAIL

# --- 2) allocation is monotonic and never recycled --------------------------
hasE "$TDD" 'allocated monotonically' && check "R7 tdd pins monotonic allocation" PASS || check "R7 tdd monotonic rule" FAIL
hasE "$TDD" 'NEVER reused|never recycled' && check "R8 tdd pins the never-reuse rule" PASS || check "R8 tdd never-reuse rule" FAIL
hasE "$TDD" 'deprecated' && check "R9 tdd keeps dropped requirements as deprecated rows" PASS || check "R9 tdd deprecated rows" FAIL
hasE "$TDD" 'never delete a row or renumber|never delete or renumber' && check "R10 tdd forbids deleting/renumbering rows" PASS || check "R10 tdd no-renumber rule" FAIL
hasE "$TDD" 'adopt them verbatim' && check "R11 tdd adopts incoming ids verbatim (no re-allocation)" PASS || check "R11 tdd adopt-verbatim rule" FAIL
hasE "$TDD" 'above the highest ID seen' && check "R12 tdd allocates new ids above the highest seen" PASS || check "R12 tdd high-water allocation" FAIL

hasE "$AUTOPILOT" 'monotonic' && check "R13 autopilot pins monotonic allocation" PASS || check "R13 autopilot monotonic rule" FAIL
hasE "$AUTOPILOT" 'never recycled|never re-?used' && check "R14 autopilot pins the never-recycle rule" PASS || check "R14 autopilot never-recycle rule" FAIL
hasE "$AUTOPILOT" 'never delete or renumber|never delete a row or renumber' && check "R15 autopilot forbids deleting/renumbering ids" PASS || check "R15 autopilot no-renumber rule" FAIL
hasE "$AUTOPILOT" 'marked deprecated' && check "R16 autopilot keeps dropped ACs as deprecated" PASS || check "R16 autopilot deprecated ACs" FAIL

# --- 3) traceability obligation per downstream stage ------------------------
# Stage: planning -> implementation. Every step names the ids it implements.
has "$TDD" 'Covers' && check "R17 implementation stage: steps carry a Covers mapping" PASS || check "R17 Covers mapping" FAIL
hasE "$PLAN_TPL" '\| Status \| Attempts \| Covers \|' && check "R18 Steps table header carries the Covers column" PASS || check "R18 Steps table Covers column" FAIL
has "$PLAN_TPL" '- **Covers**:' && has "$TDD" '- **Covers**:' \
  && check "R19 step detail repeats its Covers line" PASS || check "R19 step detail Covers line" FAIL
hasE "$TDD" 'spec . plan . step . test stays traceable|traceable end to end' && check "R20 tdd states the end-to-end traceability chain" PASS || check "R20 traceability chain statement" FAIL

# Stage: audit. The coverage cross-check closes the loop both ways.
has "$TDD" 'Requirements Coverage Cross-Check' && check "R21 audit stage: requirements coverage cross-check exists" PASS || check "R21 coverage cross-check" FAIL
has "$TDD" 'REQUIREMENT COVERAGE WARNING' && check "R22 cross-check emits a named warning marker" PASS || check "R22 warning marker" FAIL
hasE "$TDD" 'every requirement ID .*not marked deprecated.* is named by at least one step' \
  && check "R23 cross-check verifies requirement -> step direction" PASS || check "R23 requirement->step direction" FAIL
hasE "$TDD" 'every Steps-table row has a non-empty .Covers. cell' \
  && check "R24 cross-check verifies step -> requirement direction" PASS || check "R24 step->requirement direction" FAIL
hasE "$TDD" 'vanilla' && hasE "$TDD" 'Requirements. table and the per-step .Covers. mapping are likewise unchanged' \
  && check "R25 vanilla mode keeps the Requirements table binding" PASS || check "R25 vanilla binding" FAIL

# Stage: review. The reviewers receive the requirement baseline.
hasE "$TDD" 'requirements_baseline' && check "R26 review stage: reviewers get a requirements baseline" PASS || check "R26 review baseline" FAIL
hasE "$TDD" 'requirement drift' && check "R27 review stage: judge checks requirement drift" PASS || check "R27 judge requirement drift" FAIL

# Stage: validation. Autopilot asserts per id, and the PR body is keyed by id.
hasE "$AUTOPILOT" 'every non-deprecated AC by its .AC-###. ID' \
  && check "R28 validation stage: every active AC asserted by id" PASS || check "R28 validation by id" FAIL
hasE "$AUTOPILOT" 'evidence per AC under that' && check "R29 validation stage: evidence captured under the id" PASS || check "R29 evidence per id" FAIL
hasE "$AUTOPILOT" 'per-AC table .*keyed by the|keyed by the\s+stable .AC-###. IDs' \
  && check "R30 delivery stage: PR body table keyed by the ids" PASS || check "R30 PR body keyed by id" FAIL
hasE "$PR_TPL" '\| AC \| Criterion \| Status \| Evidence \|' \
  && check "R30b PR body template is keyed by the AC id" PASS || check "R30b PR body template shape" FAIL
has "$PR_TPL" 'deprecated' && check "R30c PR body template keeps deprecated rows listed" PASS || check "R30c PR body deprecated rows" FAIL
hasE "$SPEC_TPL" 'never recycled' && has "$SPEC_TPL" 'AC-###' \
  && check "R30d spec template states the stable-id rule" PASS || check "R30d spec template id rule" FAIL

# The skills must RESOLVE those templates rather than restate a second shape.
has "$TDD" '--template tdd-plan' && check "R30e tdd resolves the shared plan template" PASS || check "R30e tdd template resolution" FAIL
has "$AUTOPILOT" '--template autopilot-spec' && has "$AUTOPILOT" '--template autopilot-pr-body' \
  && check "R30f autopilot resolves the shared spec + PR-body templates" PASS || check "R30f autopilot template resolution" FAIL

# Stage: hand-off. The ids survive the skill boundary in both directions.
hasE "$AUTOPILOT" 'WITH their\s+.AC-###. IDs|Hand the ACs over' \
  && check "R31 hand-off: autopilot passes ids into the TDD skill" PASS || check "R31 autopilot->tdd hand-off" FAIL
hasE "$IMPLEMENT" 'AC-###' && hasE "$IMPLEMENT" 'FR-###' \
  && check "R32 hand-off: implement gives its spec stable ids" PASS || check "R32 implement ids" FAIL
hasE "$IMPLEMENT" 'adopts incoming IDs verbatim' \
  && check "R33 hand-off: implement states the adopt-verbatim contract" PASS || check "R33 implement adopt-verbatim" FAIL

echo "----"
echo "test-requirement-ids: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
