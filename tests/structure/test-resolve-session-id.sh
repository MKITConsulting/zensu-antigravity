#!/bin/bash
set -u

# resolve-session-id.js project-scoped transcript resolution (engine-neutral).
# Pins: ZENSU_TRANSCRIPT_PATH fast-path, project-
# scoped newest-transcript pick, Layer-1 mtime cutoff (argv[2]), Layer-2
# ZENSU_OWN_CMD cmdline tail-match disambiguation, path sanitization of the
# project dir into the projects-subdir name, and empty output when nothing
# resolves. The projects dir is overridable via ZENSU_PROJECTS_DIR.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
JS="$PLUGIN_DIR/hooks/lib/resolve-session-id.js"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$JS" ]; then check "resolve-session-id.js exists" FAIL; echo "----"; echo "test-resolve-session-id: $PASS PASS / $FAIL FAIL"; exit 1; fi
check "R0 resolve-session-id.js exists" PASS
node --check "$JS" 2>/dev/null && check "R0a node --check passes" PASS || check "R0a node --check passes" FAIL

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/proj"; PROJECTS="$TMP/projects"
mkdir -p "$PROJ" "$PROJECTS"

# Sanitize the project dir the way the resolver does: non [A-Za-z0-9_-] -> '-'.
SAN="$(printf '%s' "$PROJ" | sed 's|[^A-Za-z0-9_-]|-|g')"
PDIR="$PROJECTS/$SAN"
mkdir -p "$PDIR"

run() { ZENSU_PROJECT_DIR="$PROJ" ZENSU_PROJECTS_DIR="$PROJECTS" node "$JS" "$@" 2>/dev/null; }

# 1) ZENSU_TRANSCRIPT_PATH fast-path: the basename (minus .jsonl) wins.
TP="$TMP/some/path/explicit-transcript-id.jsonl"
mkdir -p "$(dirname "$TP")"; printf '{}\n' > "$TP"
GOT="$(ZENSU_PROJECT_DIR="$PROJ" ZENSU_PROJECTS_DIR="$PROJECTS" ZENSU_TRANSCRIPT_PATH="$TP" node "$JS" 2>/dev/null)"
[ "$GOT" = "explicit-transcript-id" ] && check "R1 ZENSU_TRANSCRIPT_PATH fast-path -> basename id" PASS || check "R1 transcript fast-path (got '$GOT')" FAIL

# 2) project-scoped newest transcript is picked.
printf '{}\n' > "$PDIR/older.jsonl"; sleep 1; printf '{}\n' > "$PDIR/newer.jsonl"
GOT="$(run)"
[ "$GOT" = "newer" ] && check "R2 newest project transcript picked" PASS || check "R2 newest pick (got '$GOT')" FAIL

# 3) Layer-1 mtime cutoff (argv[2] is a NANOSECOND epoch; files with mtime AFTER
#    the cutoff are excluded — this stops the hook matching transcripts created
#    after it started). A cutoff well in the PAST excludes a now-current file.
rm -f "$PDIR"/*.jsonl
printf '{}\n' > "$PDIR/recent.jsonl"
PAST_NS="$(node -e 'process.stdout.write(String((BigInt(Date.now()) - 3600000n) * 1000000n))')"  # 1h ago, in ns
GOT="$(run "$PAST_NS")"   # cutoff 1h ago -> the just-written file is excluded
[ -z "$GOT" ] && check "R3 Layer-1 mtime cutoff (past ns) excludes newer transcript (empty)" PASS || check "R3 mtime cutoff (got '$GOT')" FAIL
GOT="$(run)"              # no cutoff -> the file resolves
[ "$GOT" = "recent" ] && check "R3b no cutoff -> transcript resolves" PASS || check "R3b no-cutoff (got '$GOT')" FAIL

# 4) Layer-2 cmdline tail-match (ZENSU_OWN_CMD) disambiguates >1 candidate.
# The needle must be found in a transcript's CONTENT (tail), not its filename.
# Make sess-aaa the strictly NEWEST (so the newest-first fallback would pick it)
# and embed the needle only in sess-bbb's body — a correct tail-match must
# override mtime and return sess-bbb. Deterministic on any filesystem (no
# reliance on equal/ambiguous mtimes).
rm -f "$PDIR"/*.jsonl
printf '{"prompt":"run sess-bbb now"}\n' > "$PDIR/sess-bbb.jsonl"; sleep 1
printf '{"prompt":"unrelated"}\n' > "$PDIR/sess-aaa.jsonl"
GOT="$(ZENSU_PROJECT_DIR="$PROJ" ZENSU_PROJECTS_DIR="$PROJECTS" ZENSU_OWN_CMD="sess-bbb" node "$JS" 2>/dev/null)"
[ "$GOT" = "sess-bbb" ] && check "R4 Layer-2 ZENSU_OWN_CMD tail-match disambiguates" PASS || check "R4 cmdline match (got '$GOT')" FAIL

# 5) nothing resolvable -> empty output (no crash).
rm -f "$PDIR"/*.jsonl
GOT="$(run)"
[ -z "$GOT" ] && check "R5 no transcripts -> empty output (graceful)" PASS || check "R5 empty (got '$GOT')" FAIL

# 6) path sanitization: a project dir with spaces/specials maps to a sanitized
#    subdir name (proves the resolver's dir-name derivation).
PROJ2="$TMP/pro ject (x)"; mkdir -p "$PROJ2"
SAN2="$(printf '%s' "$PROJ2" | sed 's|[^A-Za-z0-9_-]|-|g')"
mkdir -p "$PROJECTS/$SAN2"; printf '{}\n' > "$PROJECTS/$SAN2/sanitized-hit.jsonl"
GOT="$(ZENSU_PROJECT_DIR="$PROJ2" ZENSU_PROJECTS_DIR="$PROJECTS" node "$JS" 2>/dev/null)"
[ "$GOT" = "sanitized-hit" ] && check "R6 project-dir path sanitization derives the projects subdir" PASS || check "R6 sanitization (got '$GOT')" FAIL

echo "----"
echo "test-resolve-session-id: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
