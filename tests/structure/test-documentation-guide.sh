#!/bin/bash
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$PLUGIN_DIR/tests/structure/lib-skill-text.sh"
GUIDE="$PLUGIN_DIR/docs/documentation-guide.md"
DOCS_TEXT="$(skill_text_file "$PLUGIN_DIR/skills/docs")" || exit 1
IMPLEMENT_TEXT="$(skill_text_file "$PLUGIN_DIR/skills/implement")" || exit 1
trap 'rm -f "$DOCS_TEXT" "$IMPLEMENT_TEXT"' EXIT
SCOPE_TITLE='Required doc types (the release gate)'

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$GUIDE" ]; then
  check "G0 docs/documentation-guide.md exists" FAIL
  echo "----"
  echo "test-documentation-guide: $PASS PASS / $FAIL FAIL"
  exit 1
fi
check "G0 docs/documentation-guide.md exists" PASS

norm() { tr -s '[:space:]' ' ' < "$1"; }
NORM_GUIDE="$(norm "$GUIDE")"
NORM_DOCS="$(norm "$DOCS_TEXT")"
NORM_STEP6="$(awk 'index($0, "### Step 6:") == 1 {p = 1} p && index($0, "### Step 7:") == 1 {exit} p' "$IMPLEMENT_TEXT" | tr -s '[:space:]' ' ')"

G1_BAD=""
grep -qxF -- "## $SCOPE_TITLE" "$GUIDE" || G1_BAD="$G1_BAD missing:heading"
for row in '| unset (`null`, the default) | `user_facing` | `end_user` |' \
  '| `api` | `api_reference` | `developer` |' \
  '| `internal_only` | `adr` | `internal` |' \
  '| `public_facing` | `user_facing` — **plus** `tutorial` when `estimated_effort` ∈ {L, XL} |'; do
  grep -qF -- "$row" "$GUIDE" || G1_BAD="$G1_BAD missing-row:[$row]"
done
for rule in 'So the scope picks the type, not the security classification' \
  'a gate that requires docs reports `documentation must be complete before release`' \
  'A response without a `feature_scope` field counts as unset: author `user_facing`' \
  'note that the `tutorial` was skipped for lack of an effort signal' \
  'a type the table does not require for the scope never completes the gate' \
  'and a required `doc_type` from the table above'; do
  printf '%s' "$NORM_GUIDE" | grep -qF -- "$rule" || G1_BAD="$G1_BAD missing-rule:[$rule]"
done
[ -z "$G1_BAD" ] && check "G1 the guide owns the feature_scope -> doc_type table with its unset-scope and unknown-effort rules" PASS \
  || check "G1 the guide lost part of the feature_scope -> doc_type table:$G1_BAD" FAIL

G2_BAD=""
printf '%s' "$NORM_GUIDE" | grep -qF -- 'usually warrants `internal`' && G2_BAD="$G2_BAD picks-by-classification"
printf '%s' "$NORM_GUIDE" | grep -qF -- 'Pick the type by what the reader needs' && G2_BAD="$G2_BAD picks-by-reader"
printf '%s' "$NORM_GUIDE" | grep -qF -- "Every doc type the feature's \`feature_scope\` requires has its doc (Required doc types)" || G2_BAD="$G2_BAD missing:checklist-item"
printf '%s' "$NORM_GUIDE" | grep -qF -- '`skills/docs/SKILL.md`, `skills/implement/SKILL.md`' || G2_BAD="$G2_BAD missing:docs-skill-reference"
[ -z "$G2_BAD" ] && check "G2 the guide picks no doc type by classification or reader and lists the docs skill and the checklist item" PASS \
  || check "G2 the guide drifts from the scope-only rule:$G2_BAD" FAIL

G3_BAD=""
printf '%s' "$NORM_DOCS" | grep -qF -- "Read the table under \"$SCOPE_TITLE\" in \`{plugin_root}/docs/documentation-guide.md\` before you name a target type" || G3_BAD="$G3_BAD docs-plugin-root-read"
printf '%s' "$NORM_DOCS" | grep -qF -- 'That table is the one copy of the rule, and `/zensu-implement` Step 6 reads it too.' || G3_BAD="$G3_BAD docs-one-copy"
printf '%s' "$NORM_DOCS" | grep -qF -- "Derive the required \`doc_type\`(s) from the guide's table (Doc type by feature scope above)." || G3_BAD="$G3_BAD docs-phase2"
printf '%s' "$NORM_DOCS" | grep -qF -- 'Sibling `/zensu-implement` Step 6 takes its doc type(s) from the same guide table' || G3_BAD="$G3_BAD docs-sibling-note"
printf '%s' "$NORM_DOCS" | grep -qF -- '`feature_scope`' || G3_BAD="$G3_BAD docs-feature_scope"
printf '%s' "$NORM_DOCS" | grep -qF -- '`estimated_effort`' || G3_BAD="$G3_BAD docs-estimated_effort"
printf '%s' "$NORM_STEP6" | grep -qF -- "The table under \"$SCOPE_TITLE\" in that guide" || G3_BAD="$G3_BAD implement-step6"
[ -z "$G3_BAD" ] && check "G3 the docs skill and implement Step 6 take the doc type from the guide's table by its heading" PASS \
  || check "G3 a doc-authoring skill no longer points at the guide's '$SCOPE_TITLE' heading:$G3_BAD" FAIL

SCOPE_ROW_RE='^\| *(unset[^|]*|`(default|api|internal_only|public_facing)`) *\| *`(user_facing|api_reference|adr|tutorial)`'
scope_rows() {
  grep -rnE --include='*.md' -- "$SCOPE_ROW_RE" "$@" 2>/dev/null | grep -vF -- "$GUIDE:"
}
G4_ROWS="$(scope_rows "$PLUGIN_DIR/skills" "$PLUGIN_DIR/agents" "$PLUGIN_DIR/docs")"
if [ -z "$G4_ROWS" ]; then
  check "G4 no skill, agent or other doc keeps its own feature_scope -> doc_type table" PASS
else
  printf '%s\n' "$G4_ROWS" | sed 's/^/      /'
  check "G4 a copy of the feature_scope -> doc_type table outside the guide" FAIL
fi

G5_FIX="$(mktemp -d)"
mkdir -p "$G5_FIX/copy" "$G5_FIX/other"
printf '%s\n' '| `api` | `api_reference` | `developer` |' > "$G5_FIX/copy/SKILL.md"
printf '%s\n' '| `default` | `user_facing` | `end_user` |' > "$G5_FIX/copy/rules.md"
printf '%s\n' '| `api` | REST endpoints | `curl` |' '| `api` | status code, response body |' > "$G5_FIX/other/SKILL.md"
G5_COPY="$(scope_rows "$G5_FIX/copy" | wc -l | tr -d ' ')"
G5_OTHER="$(scope_rows "$G5_FIX/other" | wc -l | tr -d ' ')"
rm -rf "$G5_FIX"
[ "$G5_COPY" = 2 ] && [ "$G5_OTHER" = 0 ] && check "G5 the G4 scan flags a planted scope table row and leaves other api tables alone" PASS \
  || check "G5 the G4 scan missed a planted row or flagged another table (copy=$G5_COPY other=$G5_OTHER)" FAIL

echo "----"
echo "test-documentation-guide: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
