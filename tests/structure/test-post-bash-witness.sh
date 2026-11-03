#!/usr/bin/env bash
# Strict registry grading rejects absent, cancelled or unexpectedly skipped cases.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
. "$ROOT/tests/structure/lib-unit-registry.sh"
PASS=0; FAIL=0
check() {
  if [ "$2" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  printf '%s %s\n' "$2" "$1"
}
node - "$ROOT" <<'NODE'
const fs = require('node:fs'), assert = require('node:assert/strict'), path = require('node:path');
const root = process.argv[2];
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'hooks/inventory.json'), 'utf8'));
assert.doesNotMatch(JSON.stringify(inventory), /post-bash-witness\.sh/, 'legacy witness must not be registered');
const docs = fs.readFileSync(path.join(root, 'skills/tdd/references/audit.md'), 'utf8');
assert.match(docs, /--evidence-run/);
assert.doesNotMatch(docs, /witness-.*\.log/);
NODE
unit_check "evidence-run-v1.test.js" "$ROOT/tests/structure/evidence-run-v1.test.js"
unit_check_done
printf 'Unit files: %s passed / %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
