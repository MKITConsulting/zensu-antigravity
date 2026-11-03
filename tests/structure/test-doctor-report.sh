#!/bin/bash
# Deterministic, fully offline test of the read-only doctor engine
# (hooks/lib/zensu-doctor-report.js + hooks/lib/zensu-doctor.sh).
#
# Every run is driven with `env -i` against a throwaway sandbox: a fixture
# plugin root, a fixture HOME, and a fixture project worktree. All toolchain
# facts are injected via ZDOC_* and the clock via ZDOC_NOW_MS, so nothing here
# probes PATH, the network, or the developer's real setup.
#
# Pins: all four blocks render; a missing `zensu` CLI is a ❌ row and not a
# crash; malformed config JSON is reported and not fatal; the report is
# read-only (it creates nothing anywhere, including the state dir it reports on).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_JS="$ROOT/hooks/lib/zensu-doctor-report.js"
DOCTOR_SH="$ROOT/hooks/lib/zensu-doctor.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
assert_has()  { if contains "$1" "$2"; then check "$3" PASS; else check "$3" FAIL; fi; }
assert_lacks() { if contains "$1" "$2"; then check "$3" FAIL; else check "$3" PASS; fi; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$REPORT_JS" ] || { check "zensu-doctor-report.js present" FAIL; echo "----"; echo "test-doctor-report: $PASS PASS / $FAIL FAIL"; exit 1; }
[ -f "$DOCTOR_SH" ] || { check "zensu-doctor.sh present" FAIL; echo "----"; echo "test-doctor-report: $PASS PASS / $FAIL FAIL"; exit 1; }

# ── Sandbox ──────────────────────────────────────────────────────────
SB="$(mktemp -d -t zdoctor-XXXXXX)"
trap 'rm -rf "$SB"' EXIT

PLUG="$SB/plugin"
mkdir -p "$PLUG/hooks"
cp -R "$ROOT/hooks/lib" "$PLUG/hooks/lib"
printf '{ "name": "zensu", "version": "0.1.0" }\n' > "$PLUG/plugin.json"
printf 'version-0.1.0-blue\n' > "$PLUG/README.md"
printf '## [0.1.0]\n' > "$PLUG/CHANGELOG.md"
: > "$PLUG/hooks/pre-bash-zensu-gate.sh"
: > "$PLUG/hooks/orphan-hook.sh"
cat > "$PLUG/hooks/inventory.json" <<'JSON'
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[
  {"type":"command","command":"bash /opt/zensu/hooks/pre-bash-zensu-gate.sh"},
  {"type":"command","command":"bash /opt/zensu/hooks/ghost-hook.sh"}
]}]}}
JSON
mkdir -p "$SB/home/.zensu"

PROJ="$SB/proj"
mkdir -p "$PROJ/.zensu/state"
node - "$PLUG" "$PROJ" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const core = require(path.join(process.argv[2], 'hooks/lib/session-control-core-v1.js'));
const projectRoot = process.argv[3];
core.initializeWorkflowState({ projectRoot, sessionId: 'doctor-valid' });
fs.writeFileSync(core.adoptionWorkflowStatePath(projectRoot, 'doctor-corrupt'), '{broken', { mode: 0o600 });
fs.writeFileSync(path.join(projectRoot, '.zensu/state/pending-review.json'), '{"files":[]}');
NODE

EMPTY_PROJ="$SB/empty"
mkdir -p "$EMPTY_PROJ"

NOW_EARLY=1000              # before every fixture mtime -> nothing is expired
NOW_FUTURE=4102444800000    # year 2100 -> every marker is long expired

RR_PROJECT="$PROJ"
RR_NOW="$NOW_EARLY"
RR_PLUGIN="$PLUG"

run_report() { # $1 = ZDOC_ZENSU verdict
  env -i PATH="$PATH" \
    HOME="$SB/home" \
    ZENSU_PROJECT_DIR="$RR_PROJECT" \
    ZENSU_DOCTOR_PLUGIN_DIR="$RR_PLUGIN" \
    ZDOC_ZENSU="$1" \
    ZDOC_NODE="v20.11.0" \
    ZENSU_REVIEW_EXECUTION="delegated" \
    ZDOC_BINDING="unbound" \
    ZDOC_FORGE_PROVIDER="github" \
    ZDOC_FORGE_CLI="gh" \
    ZDOC_FORGE_STATE="ready" \
    ZDOC_TTL_HOURS="6" \
    ZDOC_NOW_MS="$RR_NOW" \
    node "$REPORT_JS" 2>&1
}

snapshot() { # Compare content and mode, not merely file sizes.
  node - "$SB" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) walk(file);
    else if (stat.isFile()) console.log(`${stat.mode} ${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')} ${file}`);
  }
}
walk(process.argv[2]);
NODE
}

# ── A: healthy run renders all four blocks ───────────────────────────
OUT_A="$(run_report authed)"; RC_A=$?
[ "$RC_A" -eq 0 ] && check "A1 report exits 0" PASS || check "A1 report exits 0 (got $RC_A)" FAIL
assert_has "$OUT_A" 'CLI & tooling'   "A2 block 1 'CLI & tooling' renders"
assert_has "$OUT_A" 'Plugin integrity' "A3 block 2 'Plugin integrity' renders"
assert_has "$OUT_A" 'Config'           "A4 block 3 'Config' renders"
assert_has "$OUT_A" 'Session state'    "A5 block 4 'Session state' renders"
assert_has "$OUT_A" 'Summary:'         "A6 summary line renders"
assert_has "$OUT_A" 'zensu CLI: installed and authenticated' "A7 authed zensu CLI reported OK"
assert_has "$OUT_A" 'node: v20.11.0'   "A8 injected node version reported"
assert_has "$OUT_A" 'review execution: delegated mode selected' "A9 native review capability is reported honestly"
assert_has "$OUT_A" 'GitHub CLI (gh): installed and authenticated' "A10 forge CLI row names the detected provider CLI"

# ── B: plugin integrity ──────────────────────────────────────────────
assert_has "$OUT_A" 'version sync: plugin.json, README badge and CHANGELOG agree (0.1.0)' "B1 all three release versions agree"
assert_lacks "$OUT_A" 'plugin-root pointer' "B2 no shared plugin-root pointer is trusted"
assert_has "$OUT_A" 'The mode alone proves no independent execution' "B2b native capability requires adapter evidence"
assert_lacks "$OUT_A" 'permissions.allow' "B2c native delegated mode does not inspect foreign permission rules"
assert_has "$OUT_A" 'ghost-hook.sh'              "B3 hooks.json entry with no file on disk is named"
assert_has "$OUT_A" '❌' "B4 a missing wired hook produces the failure marker"
assert_has "$OUT_A" 'orphan-hook.sh'             "B5 on-disk hook not wired in hooks.json is named"

RR_PLUGIN="$SB/noversion"
mkdir -p "$RR_PLUGIN"
printf '{ "name": "zensu" }\n' > "$RR_PLUGIN/plugin.json"
OUT_NV="$(run_report authed)"
assert_has "$OUT_NV" 'version sync: required release files are unreadable' "B6 incomplete release metadata is a failure row"
assert_has "$OUT_NV" 'Summary:'                      "B7 missing version still renders a full report"
RR_PLUGIN="$PLUG"

# ── C: missing zensu CLI is a failure marker, not a crash ────────────
OUT_C="$(run_report absent)"; RC_C=$?
[ "$RC_C" -eq 0 ] && check "C1 missing zensu CLI still exits 0 (no crash)" PASS || check "C1 missing zensu CLI exit (got $RC_C)" FAIL
assert_has "$OUT_C" 'zensu CLI: not found on PATH' "C2 missing zensu CLI is reported"
if contains "$OUT_C" '⚠️  zensu CLI: not found on PATH'; then
  check "C3 missing optional zensu CLI carries the warning marker" PASS
else
  check "C3 missing optional zensu CLI carries the warning marker" FAIL
fi
assert_has "$OUT_C" 'Session state' "C4 later blocks still render after the CLI failure"
assert_lacks "$OUT_C" 'renderer failed' "C5 no renderer exception on a missing CLI"

OUT_UA="$(run_report present)"
assert_has "$OUT_UA" 'installed but not authenticated' "C6 unauthenticated zensu CLI is a warning, not a failure"

# ── D: config handling ───────────────────────────────────────────────
assert_has "$OUT_A" 'no config file present' "D1 absent config falls back to defaults"

printf '{ "hooks": { "autoTdd": true } }\n' > "$SB/home/.zensu/config.json"
OUT_D2="$(run_report authed)"
assert_has "$OUT_D2" 'no quoted-boolean traps' "D2 valid config reported clean"

printf '{ "hooks": { "autoTdd": "true", "chainEnforcer": "false" } }\n' > "$SB/home/.zensu/config.json"
OUT_D3="$(run_report authed)"
assert_has "$OUT_D3" 'quoted boolean'          "D3 quoted-boolean trap detected"
assert_has "$OUT_D3" 'hooks.autoTdd = "true"'  "D4 the offending key is named with its quoted value"

printf '{ "hooks": { "autoTdd": \n' > "$SB/home/.zensu/config.json"
OUT_D5="$(run_report authed)"; RC_D5=$?
[ "$RC_D5" -eq 0 ] && check "D5 malformed config JSON is not fatal (exit 0)" PASS || check "D5 malformed config exit (got $RC_D5)" FAIL
assert_has "$OUT_D5" 'config: invalid JSON'  "D6 malformed config JSON is reported"
assert_has "$OUT_D5" 'Session state'         "D7 malformed config does not abort later blocks"
assert_lacks "$OUT_D5" 'renderer failed'     "D8 no renderer exception on malformed config"
rm -f "$SB/home/.zensu/config.json"

# ── E: session state ─────────────────────────────────────────────────
assert_has "$OUT_A" '1 validated CAS workflow document(s)' "E1 valid bound-format state is validated"
assert_has "$OUT_A" '1 invalid CAS workflow document(s)' "E2 corrupt CAS document is a failure row"
assert_has "$OUT_A" 'reviewRound/stopBlockCount/implStopCount are integrated fields' "E3 counters use validated CAS fields"
assert_has "$OUT_A" 'within its 6h TTL'                  "E4 fresh pending-review within TTL"

RR_NOW="$NOW_FUTURE"
OUT_E="$(run_report authed)"
assert_has "$OUT_E" 'expired, safe to clear'  "E5 expired pending-review surfaced"
assert_lacks "$OUT_E" 'session-id pointer' "E6 no obsolete current-session pointer is read"
RR_NOW="$NOW_EARLY"

RR_PROJECT="$EMPTY_PROJ"
OUT_E7="$(run_report authed)"
assert_has "$OUT_E7" 'does not exist yet' "E7 absent state dir reported, not an error"
[ -d "$EMPTY_PROJ/.zensu" ] && check "E8 report did NOT create the missing state dir" FAIL || check "E8 report did NOT create the missing state dir" PASS
RR_PROJECT="$PROJ"

# ── F: read-only ─────────────────────────────────────────────────────
BEFORE="$(snapshot)"
run_report authed >/dev/null 2>&1
RR_NOW="$NOW_FUTURE"; run_report absent >/dev/null 2>&1; RR_NOW="$NOW_EARLY"
AFTER="$(snapshot)"
[ "$BEFORE" = "$AFTER" ] && check "F1 report is read-only (sandbox tree byte-identical)" PASS || check "F1 report wrote to the sandbox" FAIL

# Hard proof that nothing is written: strip the write bit from the fixture
# plugin root and the state dir, then run. A writer would error out; a reader
# renders the full table and still exits 0. (root ignores mode bits, so the
# write-denied assertion is only made for a non-root runner.)
chmod -R a-w "$PLUG" "$PROJ/.zensu/state" 2>/dev/null || true
OUT_F="$(run_report authed)"; RC_F=$?
[ "$RC_F" -eq 0 ] && check "F2 read-only filesystem still exits 0" PASS || check "F2 read-only filesystem exit (got $RC_F)" FAIL
assert_has "$OUT_F" 'CLI & tooling'  "F3 read-only filesystem still renders block 1"
assert_has "$OUT_F" 'Session state'  "F4 read-only filesystem still renders block 4"
assert_has "$OUT_F" 'Summary:'       "F5 read-only filesystem still renders the summary"
assert_lacks "$OUT_F" 'renderer failed' "F6 no renderer exception on a read-only filesystem"
if [ "$(id -u)" = "0" ]; then
  check "F7 write-denied state dir reported (skipped: running as root)" PASS
else
  assert_has "$OUT_F" 'is not writable' "F7 write-denied state dir reported as a failure row"
fi
chmod -R u+w "$PLUG" "$PROJ/.zensu/state" 2>/dev/null || true

# ── G: the bash wrapper renders the same table ───────────────────────
OUT_G="$(env -i PATH="$PATH" \
  HOME="$SB/home" \
  ZENSU_PROJECT_DIR="$PROJ" \
  ZENSU_DOCTOR_PLUGIN_DIR="$PLUG" \
  ZDOC_ZENSU="authed" ZDOC_NODE="v20.11.0" ZENSU_REVIEW_EXECUTION="delegated" \
    ZDOC_BINDING="unbound" \
  ZDOC_FORGE_PROVIDER="github" ZDOC_FORGE_CLI="gh" ZDOC_FORGE_STATE="ready" \
  ZDOC_TTL_HOURS="6" ZDOC_NOW_MS="$NOW_EARLY" \
  bash "$DOCTOR_SH" 2>&1)"; RC_G=$?
[ "$RC_G" -eq 0 ] && check "G1 wrapper exits 0" PASS || check "G1 wrapper exits 0 (got $RC_G)" FAIL
assert_has "$OUT_G" 'CLI & tooling'    "G2 wrapper renders block 1"
assert_has "$OUT_G" 'Plugin integrity' "G3 wrapper renders block 2"
assert_has "$OUT_G" 'Config'           "G4 wrapper renders block 3"
assert_has "$OUT_G" 'Session state'    "G5 wrapper renders block 4"
assert_lacks "$OUT_G" 'renderer could not run' "G6 wrapper reached the renderer"

# ── H: standalone (no reference-host identifiers in the engine) ──────
LEAK="$(grep -lniE 'claude|anthropic' "$REPORT_JS" "$DOCTOR_SH" 2>/dev/null || true)"
[ -z "$LEAK" ] && check "H1 doctor engine carries no foreign-host identifiers" PASS || check "H1 foreign-host identifiers in: $LEAK" FAIL

echo "----"
echo "test-doctor-report: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
