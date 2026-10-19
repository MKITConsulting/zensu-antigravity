#!/usr/bin/env bash
# The promptfoo result-file shape, and the live suite's "verified nothing" scan.
#
# Both were duplicated: the gatekeeper knew the row shape, and run-live.sh carried
# a second copy inside a shell heredoc where no test could load it. Two copies of
# "which envelope did promptfoo write" is two places the suite can start reading
# ZERO rows — and a suite that reads zero rows reports zero failures, which is
# indistinguishable from a clean run. This pins the single implementation and
# fails if a consumer grows its own again.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

SHAPE="$ROOT/evals/promptfoo/lib/results-shape.js"
SCAN="$ROOT/evals/promptfoo/live/scan-unverified.js"
for f in "$SHAPE" "$SCAN"; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
  node --check "$f" || exit 1
done
export SHAPE SCAN

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TMP

# The expression travels through the ENVIRONMENT, never spliced into a
# double-quoted bash string: bash would expand `$`, backticks and backslashes
# before node sees them and mangle the first regex or template literal.
check() { # $1 = label, $2 = expected, $3 = node expression
  local got
  got="$(EXPR="$3" node -e '
    const S = require(process.env.SHAPE);
    const { resultRows, rowScenarioId, rowPassed, rowReason, rowOutputText } = S;
    const { scanUnverified } = require(process.env.SCAN);
    process.stdout.write(String(eval(process.env.EXPR)));
  ' 2>&1)"
  if [ "$got" = "$2" ]; then ok "$1"; else bad "$1 — expected '$2', got '$got'"; fi
}

# --- resultRows: both envelopes promptfoo has shipped ------------------------
check "reads the nested results.results envelope" "2" \
  'resultRows({results: {results: [{}, {}]}}).length'
check "reads the flat results envelope" "3" \
  'resultRows({results: [{}, {}, {}]}).length'
# An empty run is a legitimate shape; it is the GATEKEEPER's job to call it
# missing, not this module's job to hide it.
check "an empty row list is a valid shape, not an error" "0" \
  'resultRows({results: []}).length'
# The old inline copies ended in `|| []`. That turned "I cannot read this file"
# into "nothing was wrong with it".
check "an unreadable envelope throws instead of defaulting to empty" "unrecognised promptfoo results shape" \
  '(() => { try { resultRows({nope: 1}); return "NO THROW"; } catch (e) { return e.message; } })()'
check "a null payload throws rather than reading as clean" "true" \
  '(() => { try { resultRows(null); return false; } catch (e) { return true; } })()'
# A nested key that is present but not an array must fall through to the flat
# read, not be handed back as-is.
check "a non-array nested results falls through instead of being returned" "1" \
  'resultRows({results: Object.assign([{}], {results: "oops"})}).length'

# --- row accessors -----------------------------------------------------------
check "reads the scenario id out of vars" "live-hooks-fire" \
  'rowScenarioId({vars: {scenario_id: "live-hooks-fire"}})'
check "an id-less row is named, not dropped" "<unnamed>" 'rowScenarioId({})'
check "success must be exactly true" "false" 'rowPassed({success: "true"})'
check "a passing row reads as passing" "true" 'rowPassed({success: true})'
check "prefers the grading reason" "assert failed" \
  'rowReason({gradingResult: {reason: "assert failed"}, error: "e"})'
check "falls back to the row error" "boom" 'rowReason({error: "boom"})'
check "never returns empty" "no reason reported" 'rowReason({})'

# --- rowOutputText: the normalisation the naive scan got wrong ---------------
check "a string output passes through" "LIVE-UNAVAILABLE quota" \
  'rowOutputText({response: {output: "LIVE-UNAVAILABLE quota"}})'
# promptfoo may hand back the PARSED object. String() on it yields
# "[object Object]", so a marker the provider definitely emitted reads as absent.
check "an object output is stringified, not [object Object]" "true" \
  'rowOutputText({response: {output: {stdout: "LIVE-UNAVAILABLE quota"}}}).includes("LIVE-UNAVAILABLE")'
check "a missing response is empty text, not a crash" '""' 'rowOutputText({})'

# --- scanUnverified ----------------------------------------------------------
CLEAN='{"results":[{"vars":{"scenario_id":"a"},"response":{"output":"HOOKS-FIRED-ALL"}}]}'
UNAVAIL='{"results":[{"response":{"output":"{\"stdout\":\"LIVE-UNAVAILABLE quota reached\"}"}}]}'
INCONC='{"results":[{"response":{"output":"{\"stdout\":\"LIVE-INCONCLUSIVE the model made no tool call\"}"}}]}'
SKIPPED='{"results":[{"response":{"output":"LIVE-SKIPPED"}}]}'
export CLEAN UNAVAIL INCONC SKIPPED

check "a fully verified run reports nothing" "0" \
  'scanUnverified(JSON.parse(process.env.CLEAN), true).length'
check "an unreachable host is reported" "LIVE-UNAVAILABLE quota reached" \
  'scanUnverified(JSON.parse(process.env.UNAVAIL), true)[0]'
# The reason must stop at the JSON envelope's quote, or the hit carries the whole
# serialised row into the operator's terminal.
check "the reason stops at the envelope quote" "true" \
  'scanUnverified(JSON.parse(process.env.UNAVAIL), true)[0].endsWith("reached")'
check "an inconclusive probe is reported too" "true" \
  'scanUnverified(JSON.parse(process.env.INCONC), true)[0].startsWith("LIVE-INCONCLUSIVE")'
# Without the opt-in a skipped run is the expected hermetic outcome.
check "a skip is not a finding without the opt-in" "0" \
  'scanUnverified(JSON.parse(process.env.SKIPPED), false).length'
check "a skip IS a finding after an explicit opt-in" "1" \
  'scanUnverified(JSON.parse(process.env.SKIPPED), true).length'
check "an unreadable envelope throws rather than reporting clean" "true" \
  '(() => { try { scanUnverified({nope: 1}, true); return false; } catch (e) { return true; } })()'

# --- the CLI contract run-live.sh depends on ---------------------------------
printf '%s' "$CLEAN"   > "$TMP/clean.json"
printf '%s' "$UNAVAIL" > "$TMP/unavail.json"
printf '%s' "$INCONC"  > "$TMP/inconc.json"
printf 'not json'      > "$TMP/garbage.json"
printf '{"totals":1}'  > "$TMP/badshape.json"

cli() { ZENSU_LIVE_AGY=1 node "$SCAN" "$1" >"$TMP/out" 2>"$TMP/err"; printf '%s' $?; }

[ "$(cli "$TMP/clean.json")" = "0" ] \
  && ok "a verified run exits 0" || bad "a verified run did not exit 0"
[ "$(cli "$TMP/unavail.json")" = "1" ] \
  && ok "an unreachable scenario exits 1" || bad "an unreachable scenario did not exit 1"
[ "$(cli "$TMP/inconc.json")" = "1" ] \
  && ok "an inconclusive scenario exits 1" || bad "an inconclusive scenario did not exit 1"
# 2 is distinct from 1 on purpose: run-live.sh must not print "N scenarios could
# not reach agy" when the real problem is that it never read the file.
[ "$(cli "$TMP/garbage.json")" = "2" ] \
  && ok "an unparseable file exits 2, distinct from a finding" || bad "an unparseable file did not exit 2"
[ "$(cli "$TMP/badshape.json")" = "2" ] \
  && ok "an unrecognised envelope exits 2, not 0" || bad "an unrecognised envelope did not exit 2"
[ "$(cli "$TMP/missing-file.json")" = "2" ] \
  && ok "a missing result file exits 2" || bad "a missing result file did not exit 2"

# The count on line 1 is what run-live.sh prints; the reasons follow.
cli "$TMP/unavail.json" >/dev/null
[ "$(sed -n '1p' "$TMP/out")" = "1" ] \
  && ok "line 1 of the report is the finding count" || bad "line 1 is not the finding count"

# --- no consumer re-implements the shape -------------------------------------
# Comment-stripped so the prose above (which quotes both expressions) cannot
# satisfy or trip the guard.
STRAY="$(
  find "$ROOT/evals" -name '*.js' -not -path '*/node_modules/*' -not -path '*/results/*' \
    -not -path '*/lib/results-shape.js' -print0 2>/dev/null |
  xargs -0 grep -n 'results\.results\|response\.output' 2>/dev/null |
  grep -v '^\([^:]*\):[0-9]*: *//' || true
)"
STRAY_SH="$(
  grep -n 'results\.results\|response\.output' "$ROOT/evals/promptfoo/live/run-live.sh" \
    "$ROOT/evals/promptfoo/run-eval.sh" 2>/dev/null |
  grep -v '^\([^:]*\):[0-9]*: *#' || true
)"
if [ -z "$STRAY$STRAY_SH" ]; then
  ok "the promptfoo row shape is implemented exactly once"
else
  bad "a second copy of the row shape reappeared:
$STRAY$STRAY_SH"
fi

# Both real consumers must actually import it, or the guard above passes simply
# because they stopped reading results at all.
grep -q "require('./lib/results-shape')" "$ROOT/evals/promptfoo/verify-results.js" \
  && ok "verify-results.js consumes the shared shape" \
  || bad "verify-results.js does not require lib/results-shape"
grep -q "results-shape" "$SCAN" \
  && ok "scan-unverified.js consumes the shared shape" \
  || bad "scan-unverified.js does not require lib/results-shape"
grep -q 'scan-unverified.js' "$ROOT/evals/promptfoo/live/run-live.sh" \
  && ok "run-live.sh delegates the scan instead of embedding it" \
  || bad "run-live.sh no longer calls scan-unverified.js"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
