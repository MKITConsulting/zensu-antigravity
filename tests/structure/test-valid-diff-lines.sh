#!/bin/bash
set -u

# Structure + functional test for hooks/lib/valid-diff-lines.js (pre-publish
# inline-comment anchor validation for /zensu-pr-team-review).
#
# Doc pins (P3/P4) run BEFORE the node gate so they still hold on a node-less
# machine. Functional: synthetic unified diffs through the CLI mode pin the
# valid / remap / none verdicts on BOTH sides — a line inside an added hunk,
# context-only lines (commentable on RIGHT by new-file numbering and on LEFT by
# old-file numbering), a line outside every hunk (rejected -> remap or none),
# a renamed file resolving to its NEW path, deleted/binary handling, the 40-line
# remap cap incl. its exact boundary, tie-breaking (following line wins),
# quoted/space-bearing paths, CRLF input, hunk-body lines starting with
# "--"/"++", and malformed/garbage/oversized stdin failing closed to `none`
# while still exiting 0. Structure: the lib's module exports plus the
# pr-team-review publish integration (SKILL.md Phase D gate, the mandatory
# github-publish.md section, remap-note wording, body-fold fallback, demoted
# 422 guidance, load-bearing quoting, GitLab reuse, workflow.md wiring).

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$PLUGIN_DIR/hooks/lib/valid-diff-lines.js"
. "$PLUGIN_DIR/tests/structure/lib-skill-text.sh"
SKILL_MD="$(skill_text_file "$PLUGIN_DIR/skills/pr-team-review")" || exit 1
trap 'rm -f "$SKILL_MD"' EXIT
PUBLISH_MD="$PLUGIN_DIR/skills/pr-team-review/rules/github-publish.md"
GITLAB_MD="$PLUGIN_DIR/skills/pr-team-review/rules/gitlab-publish.md"
WORKFLOW_MD="$PLUGIN_DIR/skills/pr-team-review/rules/workflow.md"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

for f in "$LIB" "$SKILL_MD" "$PUBLISH_MD" "$GITLAB_MD" "$WORKFLOW_MD"; do
  if [ ! -f "$f" ]; then
    check "P0 required file exists: ${f#"$PLUGIN_DIR"/}" FAIL
    echo "----"
    echo "test-valid-diff-lines: $PASS PASS / $FAIL FAIL"
    exit 1
  fi
done
check "P0 all target files exist" PASS

# ── P3 — publish-integration doc pins (no node needed; run before the gate) ──
if grep -qF 'valid-diff-lines.js' "$PUBLISH_MD" && grep -qiF 'pre-publish anchor validation' "$PUBLISH_MD"; then
  check "P3a github-publish.md carries the mandatory validation section" PASS
else
  check "P3a github-publish.md carries the mandatory validation section" FAIL
fi
if grep -qF 'remap' "$PUBLISH_MD" && grep -qiF 'anchor remapped from line' "$PUBLISH_MD"; then
  check "P3b remap note wording pinned" PASS
else
  check "P3b remap note wording pinned" FAIL
fi
# Prose pins are matched against a whitespace-flattened copy so a reflow of the
# rules file cannot silently break the pin.
PUBLISH_FLAT="$(tr '\n' ' ' < "$PUBLISH_MD" | tr -s '[:space:]' ' ')"
if printf '%s' "$PUBLISH_FLAT" | grep -qiE 'fold the finding into the (overall|review)( review)? body' \
   && grep -qF 'no inline comment' "$PUBLISH_MD" && grep -qF 'It keeps its ID and its line' "$PUBLISH_MD"; then
  check "P3c none-case folds the finding into the review body" PASS
else
  check "P3c none-case folds the finding into the review body" FAIL
fi
if grep -qiE 'should not occur|pre-validated' "$PUBLISH_MD"; then
  check "P3d 422 guidance demoted to last-resort" PASS
else
  check "P3d 422 guidance demoted to last-resort" FAIL
fi
if grep -qF "'<path>'" "$PUBLISH_MD" && grep -qF 'single quotes exactly as shown' "$PUBLISH_MD" && grep -qF 'escape it as' "$PUBLISH_MD"; then
  check "P3e untrusted path is single-quoted with an escape instruction" PASS
else
  check "P3e untrusted path is single-quoted with an escape instruction" FAIL
fi
if grep -qF 'start_line' "$PUBLISH_MD" && grep -qiF 'collapse to a single-line comment' "$PUBLISH_MD" && grep -qiE 'EVERY integer in .?\[start_line, line\]' "$PUBLISH_MD"; then
  check "P3f range anchors require hunk contiguity else collapse" PASS
else
  check "P3f range anchors require hunk contiguity else collapse" FAIL
fi
if grep -qiE '\[RIGHT\|LEFT\]|LEFT.*old-file lines' "$PUBLISH_MD"; then
  check "P3g validation is side-aware (LEFT validates old-file numbering)" PASS
else
  check "P3g validation is side-aware (LEFT validates old-file numbering)" FAIL
fi
if grep -qiF 'prints nothing or exits non-zero' "$PUBLISH_MD"; then
  check "P3h empty validator output is defined as none" PASS
else
  check "P3h empty validator output is defined as none" FAIL
fi
if grep -qF 'Pre-Publish Anchor Validation' "$SKILL_MD" && grep -qF 'valid-diff-lines.js' "$SKILL_MD"; then
  check "P3i SKILL.md Phase D path anchors the mandatory gate" PASS
else
  check "P3i SKILL.md Phase D path anchors the mandatory gate" FAIL
fi
if grep -qF 'valid-diff-lines.js' "$WORKFLOW_MD" && grep -qiF 'anchor validation (mandatory' "$WORKFLOW_MD"; then
  check "P3j workflow.md Phase D repeats the mandatory anchor gate" PASS
else
  check "P3j workflow.md Phase D repeats the mandatory anchor gate" FAIL
fi
if grep -qF 'valid-diff-lines.js' "$PLUGIN_DIR/skills/pr-team-review/references/publish.md" \
  && grep -qF 'on GitLab' "$PLUGIN_DIR/skills/pr-team-review/references/publish.md" \
  && grep -qF 'positionless' "$GITLAB_MD"; then
  check "P3k gitlab-publish.md reuses the forge-agnostic validator" PASS
else
  check "P3k gitlab-publish.md reuses the forge-agnostic validator" FAIL
fi
# The supporting rules must demand the concretized plugin root, never a literal
# placeholder the shell would fail to expand inside a tool argument.
if grep -qF 'node "<absolute-plugin-root>/hooks/lib/valid-diff-lines.js"' "$PUBLISH_MD" \
   && grep -qF 'node "<absolute-plugin-root>/hooks/lib/valid-diff-lines.js"' "$WORKFLOW_MD"; then
  check "P3l both rules files require the concretized absolute plugin root" PASS
else
  check "P3l both rules files require the concretized absolute plugin root" FAIL
fi

# ── P4 — the validator stays dependency-free and host-agnostic ──────────────
# Only Node built-ins may be required; a third-party import would break the
# zero-dependency install contract for a lib the publish path must always run.
if grep -oE "require\(['\"][^'\"]+['\"]\)" "$LIB" | grep -qvE "require\(['\"](assert|buffer|fs|os|path|util)['\"]\)"; then
  check "P4a lib is dependency-free (no third-party require)" FAIL
else
  check "P4a lib is dependency-free (no third-party require)" PASS
fi
# No environment coupling: the verdict must depend only on argv + stdin, so any
# host can call it the same way.
if grep -qF 'process.env' "$LIB"; then
  check "P4b lib reads no environment (argv + stdin only)" FAIL
else
  check "P4b lib reads no environment (argv + stdin only)" PASS
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  SKIP  node not on PATH — functional CLI/export checks skipped (doc pins above ran)"
  echo "----"
  echo "test-valid-diff-lines: $PASS PASS / $FAIL FAIL (node missing, functional checks skipped)"
  if [ "$FAIL" -gt 0 ]; then exit 1; fi
  exit 0
fi

DIFF_MAIN='diff --git a/src/x.js b/src/x.js
index 1111111..2222222 100644
--- a/src/x.js
+++ b/src/x.js
@@ -1,3 +1,4 @@
 line1
+added2
 line3
 line4
@@ -10,2 +11,3 @@
 ctx11
+added12
 ctx13
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old1
-old2
diff --git a/fresh.txt b/fresh.txt
new file mode 100644
--- /dev/null
+++ b/fresh.txt
@@ -0,0 +1,2 @@
+n1
+n2
\ No newline at end of file
diff --git a/img.png b/img.png
index 3333333..4444444 100644
Binary files a/img.png and b/img.png differ
diff --git a/after.png.txt b/after.png.txt
--- a/after.png.txt
+++ b/after.png.txt
@@ -1 +1 @@ function afterBinary()
-was1
+solo1'

DIFF_CONTEXT='diff --git a/ctx.js b/ctx.js
--- a/ctx.js
+++ b/ctx.js
@@ -20,3 +20,3 @@
 keep20
-old21
+new21
 keep22'

DIFF_RENAME='diff --git a/before.js b/after.js
similarity index 90%
rename from before.js
rename to after.js
--- a/before.js
+++ b/after.js
@@ -5,2 +5,3 @@
 keep5
+new6
 keep7'

DIFF_TIE='diff --git a/t.js b/t.js
--- a/t.js
+++ b/t.js
@@ -3,0 +4,1 @@
+only4
@@ -8,0 +10,1 @@
+only10'

DIFF_FAR='diff --git a/far.js b/far.js
--- a/far.js
+++ b/far.js
@@ -1,1 +1,1 @@
-was1
+top1'

DIFF_TRICKY='diff --git a/sql/q.sql b/sql/q.sql
--- a/sql/q.sql
+++ b/sql/q.sql
@@ -1,3 +1,3 @@
 keep
--- removed sql comment
+++ added plus line
 tail
diff --git a/noeol.txt b/noeol.txt
--- a/noeol.txt
+++ b/noeol.txt
@@ -1,2 +1,2 @@
 ctx
-old2
\ No newline at end of file
+new2
\ No newline at end of file
diff --git a/dir with space/f.txt b/dir with space/f.txt
--- a/dir with space/f.txt
+++ b/dir with space/f.txt
@@ -1 +1 @@
-was1
+spaced1
diff --git "a/quoted-\303\244.txt" "b/quoted-\303\244.txt"
--- "a/quoted-\303\244.txt"
+++ "b/quoted-\303\244.txt"
@@ -1 +1 @@
-was1
+umlaut1'

run_cli() {
  printf '%s' "$1" | node "$LIB" "$2" "$3" ${4+"$4"} 2>/dev/null
}

# ── P1 — a line inside an added hunk validates ──────────────────────────────
V="$(run_cli "$DIFF_MAIN" src/x.js 2)"
[ "$V" = "valid" ] && check "P1a added line inside a hunk is a valid RIGHT anchor" PASS || check "P1a added line inside a hunk (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js 12)"
[ "$V" = "valid" ] && check "P1b second hunk keeps new-file numbering" PASS || check "P1b second hunk numbering (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" fresh.txt 2)"
[ "$V" = "valid" ] && check "P1c new-file line valid; trailing no-newline marker ignored" PASS || check "P1c new-file line valid (got: $V)" FAIL

# ── P1d.. — context-only lines: commentable on BOTH sides, own numbering ────
V="$(run_cli "$DIFF_CONTEXT" ctx.js 20)"
[ "$V" = "valid" ] && check "P1d context-only line is a valid RIGHT anchor (new numbering)" PASS || check "P1d context RIGHT anchor (got: $V)" FAIL
V="$(run_cli "$DIFF_CONTEXT" ctx.js 22 LEFT)"
[ "$V" = "valid" ] && check "P1e context-only line is a valid LEFT anchor (old numbering)" PASS || check "P1e context LEFT anchor (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js 10 LEFT)"
[ "$V" = "valid" ] && check "P1f LEFT context numbering follows the old file, not the new" PASS || check "P1f LEFT context numbering (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" gone.txt 1 LEFT)"
[ "$V" = "valid" ] && check "P1g deleted-file line is a valid LEFT anchor" PASS || check "P1g deleted-file LEFT anchor (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" fresh.txt 1 LEFT)"
[ "$V" = "none" ] && check "P1h new file has no LEFT anchors" PASS || check "P1h new file LEFT anchors (got: $V)" FAIL

# ── P1i.. — a line outside every hunk is rejected (remap, or none past cap) ──
V="$(run_cli "$DIFF_MAIN" src/x.js 7)"
[ "$V" = "remap 4" ] && check "P1i out-of-hunk line is rejected and remapped to the nearest" PASS || check "P1i out-of-hunk rejected (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js 8)"
[ "$V" = "remap 11" ] && check "P1j nearest crosses to the closer hunk" PASS || check "P1j nearest crosses hunks (got: $V)" FAIL
V="$(run_cli "$DIFF_TIE" t.js 7)"
[ "$V" = "remap 10" ] && check "P1k distance tie prefers the following line" PASS || check "P1k tie prefers following line (got: $V)" FAIL
V="$(run_cli "$DIFF_FAR" far.js 41)"
[ "$V" = "remap 1" ] && check "P1l remap at exactly the 40-line boundary still remaps" PASS || check "P1l 40-line boundary (got: $V)" FAIL
V="$(run_cli "$DIFF_FAR" far.js 42)"
[ "$V" = "none" ] && check "P1m one line past the cap is rejected outright (none)" PASS || check "P1m past the cap (got: $V)" FAIL
V="$(run_cli "$DIFF_FAR" far.js 500)"
[ "$V" = "none" ] && check "P1n far-out-of-hunk line yields none" PASS || check "P1n far out-of-hunk (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" gone.txt 1)"
[ "$V" = "none" ] && check "P1o deleted file has no RIGHT anchors" PASS || check "P1o deleted file RIGHT (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" img.png 1)"
[ "$V" = "none" ] && check "P1p binary file yields none" PASS || check "P1p binary file (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" nosuch.js 5)"
[ "$V" = "none" ] && check "P1q path absent from the diff yields none" PASS || check "P1q unknown path (got: $V)" FAIL

# ── P1r.. — a renamed file's NEW path validates ─────────────────────────────
V="$(run_cli "$DIFF_RENAME" after.js 6)"
[ "$V" = "valid" ] && check "P1r renamed file validates on the NEW path" PASS || check "P1r rename NEW path (got: $V)" FAIL
V="$(run_cli "$DIFF_RENAME" after.js 5)"
[ "$V" = "valid" ] && check "P1s renamed file context line validates on the NEW path" PASS || check "P1s rename context NEW path (got: $V)" FAIL
V="$(run_cli "$DIFF_RENAME" before.js 6)"
[ "$V" = "none" ] && check "P1t renamed file OLD path is not an anchor" PASS || check "P1t rename OLD path (got: $V)" FAIL

# ── P1u.. — malformed / hostile input fails closed to `none`, exit stays 0 ──
V="$(printf '%s' 'not a diff at all' | node "$LIB" x.js 1 2>/dev/null)"
RC=$?
[ "$V" = "none" ] && check "P1u garbage stdin fails closed to none" PASS || check "P1u garbage stdin (got: $V)" FAIL
[ "$RC" -eq 0 ] && check "P1v always-exit-0 contract holds on garbage stdin" PASS || check "P1v always-exit-0 (rc=$RC)" FAIL
V="$(printf '%s' '' | node "$LIB" x.js 1 2>/dev/null)"
[ "$V" = "none" ] && check "P1w empty stdin fails closed to none" PASS || check "P1w empty stdin (got: $V)" FAIL
V="$(printf '%s' 'diff --git a/b b/b
--- a/b
+++ b/b
@@ this is not a hunk header @@
+orphan' | node "$LIB" b 1 2>/dev/null)"
[ "$V" = "none" ] && check "P1x malformed hunk header yields no anchors (fail-soft)" PASS || check "P1x malformed hunk header (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js abc)"
[ "$V" = "none" ] && check "P1y non-numeric line argument fails closed" PASS || check "P1y non-numeric line (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js 2 SIDEWAYS)"
[ "$V" = "none" ] && check "P1z invalid side argument fails closed" PASS || check "P1z invalid side (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" src/x.js 12 '')"
[ "$V" = "valid" ] && check "P1aa empty side argument defaults to RIGHT" PASS || check "P1aa empty side defaults RIGHT (got: $V)" FAIL
V="$(head -c 52500000 /dev/zero | tr '\0' 'a' | node "$LIB" x.js 1 2>/dev/null)"
[ "$V" = "none" ] && check "P1ab oversized stdin trips the cap and fails closed" PASS || check "P1ab oversized stdin (got: $V)" FAIL

# ── P1ac.. — tricky content and paths must not desync the counters ──────────
V="$(run_cli "$DIFF_TRICKY" sql/q.sql 2)"
V2="$(run_cli "$DIFF_TRICKY" sql/q.sql 3)"
if [ "$V" = "valid" ] && [ "$V2" = "valid" ]; then
  check "P1ac hunk-body ++/-- content lines do not desync numbering" PASS
else
  check "P1ac hunk-body ++/-- content lines (got: $V/$V2)" FAIL
fi
V="$(run_cli "$DIFF_TRICKY" noeol.txt 2)"
[ "$V" = "valid" ] && check "P1ad mid-hunk no-newline marker keeps numbering" PASS || check "P1ad mid-hunk no-newline marker (got: $V)" FAIL
V="$(run_cli "$DIFF_TRICKY" 'dir with space/f.txt' 1)"
[ "$V" = "valid" ] && check "P1ae path with spaces validates" PASS || check "P1ae path with spaces (got: $V)" FAIL
V="$(run_cli "$DIFF_TRICKY" "quoted-$(printf '\303\244').txt" 1)"
[ "$V" = "valid" ] && check "P1af quoted octal-escaped path is unquoted" PASS || check "P1af quoted octal path (got: $V)" FAIL
V="$(run_cli "$DIFF_MAIN" after.png.txt 1)"
[ "$V" = "valid" ] && check "P1ag omitted-count hunk + fn trailer after a binary file parses" PASS || check "P1ag omitted-count hunk after binary (got: $V)" FAIL
CRLF_DIFF="$(printf '%s' "$DIFF_FAR" | sed $'s/$/\r/')"
V="$(run_cli "$CRLF_DIFF" far.js 1)"
[ "$V" = "valid" ] && check "P1ah CRLF diff input parses" PASS || check "P1ah CRLF diff input (got: $V)" FAIL

# ── P2 — module exports (the lib doubles as a require()-able module) ────────
if node -e 'var m=require(process.argv[1]); process.exit(typeof m.parseDiff==="function"&&typeof m.isValidAnchor==="function"&&typeof m.nearestAnchor==="function"&&typeof m.isValidRight==="function"&&typeof m.nearestRight==="function"&&typeof m.cliMain==="function"?0:1)' "$LIB" 2>/dev/null; then
  check "P2a lib exports parse + side-aware and RIGHT query helpers" PASS
else
  check "P2a lib exports parse + side-aware and RIGHT query helpers" FAIL
fi
if node -e 'var m=require(process.argv[1]); var p=m.parseDiff("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n-gone\n ctx\n"); process.exit(JSON.stringify(p.f.left)==="[1,2]"&&JSON.stringify(p.f.right)==="[1]"?0:1)' "$LIB" 2>/dev/null; then
  check "P2b LEFT side collects removed+context by old numbering" PASS
else
  check "P2b LEFT side collects removed+context by old numbering" FAIL
fi
if node -e 'var m=require(process.argv[1]); var p=m.parseDiff("diff --git a/g b/g\n--- a/g\n+++ b/g\n@@ -1,2 +1,2 @@\n-a1\n+b1\n ctx\n@@ -10,1 +10,1 @@\n-a10\n+b10\n"); process.exit(JSON.stringify(p.g.left)==="[1,2,10]"?0:1)' "$LIB" 2>/dev/null; then
  check "P2c LEFT numbering continues across hunks" PASS
else
  check "P2c LEFT numbering continues across hunks" FAIL
fi
if node -e 'var m=require(process.argv[1]); var p=m.parseDiff("diff --git a/__proto__ b/__proto__\n--- a/__proto__\n+++ b/__proto__\n@@ -1 +1 @@\n-x0\n+x\n"); process.exit(m.isValidRight(p,"__proto__",1)===true&&m.isValidRight(p,"constructor",1)===false?0:1)' "$LIB" 2>/dev/null; then
  check "P2d prototype-named paths parse and query cleanly" PASS
else
  check "P2d prototype-named paths parse and query cleanly" FAIL
fi

echo "----"
echo "test-valid-diff-lines: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
