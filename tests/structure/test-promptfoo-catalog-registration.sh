#!/usr/bin/env bash
# Every scenario catalog on disk must be registered in promptfooconfig.yaml.
#
# The config lists its `tests:` files explicitly, and promptfoo does not complain
# about a catalog it was never told to load. So an unregistered catalog is a file
# full of assertions that simply never run — and the suite still reports a clean
# 99/99. verify-results.js cannot catch it either: it checks that every
# CATALOGUED scenario ran, and an orphaned file is not catalogued.
#
# That is the same failure shape as the defects this repo keeps finding in the
# host integration: an artifact that exists, looks wired, and is silently inert.
# This suite closes it on our side of the fence.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUITES="$ROOT/evals/promptfoo $ROOT/evals/promptfoo/live"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }
finish() { printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; }

check_suite() { # $1 = suite dir holding promptfooconfig.yaml + scenarios/
  local ON_DISK REGISTERED REG_COUNT ORPHANS GHOSTS DUPES n f
  local DIR="$1" CFG="$1/promptfooconfig.yaml" label
  label="${DIR#$ROOT/}"
  [ -f "$CFG" ] || { bad "$label/promptfooconfig.yaml missing"; return; }
  [ -d "$DIR/scenarios" ] || { bad "$label/scenarios missing"; return; }

ON_DISK=0
for f in "$DIR"/scenarios/*.yaml; do
  [ -f "$f" ] || continue
  ON_DISK=$((ON_DISK+1))
done
[ "$ON_DISK" -gt 0 ] && ok "$label: $ON_DISK scenario catalog(s) on disk" || { bad "$label: no scenario catalogs found"; return; }

# Registered entries, in config order.
REGISTERED="$(grep -oE 'file://scenarios/[A-Za-z0-9._-]+\.yaml' "$CFG" 2>/dev/null | sed 's|file://scenarios/||' | sort -u)"
REG_COUNT="$(printf '%s\n' "$REGISTERED" | grep -c . || true)"
[ "${REG_COUNT:-0}" -gt 0 ] && ok "$label: $REG_COUNT catalog(s) registered" || { bad "$label: config registers no scenario catalogs"; return; }

ORPHANS=""
for f in "$DIR"/scenarios/*.yaml; do
  [ -f "$f" ] || continue
  n="$(basename "$f")"
  printf '%s\n' "$REGISTERED" | grep -qxF "$n" || ORPHANS="$ORPHANS $n"
done
[ -z "$ORPHANS" ] && ok "$label: every catalog on disk is registered — none silently skipped" \
                  || bad "$label: catalog(s) on disk but NOT registered (their assertions never run):$ORPHANS"

GHOSTS=""
while IFS= read -r n; do
  [ -z "$n" ] && continue
  [ -f "$DIR/scenarios/$n" ] || GHOSTS="$GHOSTS $n"
done <<EOF
$REGISTERED
EOF
[ -z "$GHOSTS" ] && ok "$label: every registered catalog exists on disk" || bad "$label: registered but missing on disk:$GHOSTS"

# scenario_id uniqueness across catalogs: a duplicate would let one scenario
# shadow another in the results verification.
DUPES="$(grep -h -oE '^[[:space:]]*scenario_id:[[:space:]]*[A-Za-z0-9._-]+' "$DIR"/scenarios/*.yaml 2>/dev/null \
  | sed 's/.*scenario_id:[[:space:]]*//' | sort | uniq -d)"
[ -z "$DUPES" ] && ok "$label: every scenario_id is unique across catalogs" || bad "$label: duplicate scenario_id(s): $(printf '%s' "$DUPES" | tr '\n' ' ')"

}

for suite in $SUITES; do check_suite "$suite"; done

finish
