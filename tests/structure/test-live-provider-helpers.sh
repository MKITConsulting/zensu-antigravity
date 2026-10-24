#!/usr/bin/env bash
# Deterministic coverage for the LIVE provider's pure logic.
#
# The live suite costs real model calls, so until this existed the probe logic —
# trace parser, hook counters, unavailability classification, trace-path
# confinement, Stop verdicts — could only ever run against paid quota. A typo or an
# inverted comparison surfaced mid-sweep, minutes and tokens later. These helpers
# are exported behind a `require.main` guard precisely so they can be exercised
# here without running a probe.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

PROVIDER="$ROOT/evals/promptfoo/lib/agy-live-provider.js"
[ -f "$PROVIDER" ] || { echo "live provider not found at $PROVIDER"; exit 1; }
export PROVIDER

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TMP

# Requiring the provider must not execute a probe (no agy call, no workspace).
OUT="$(node -e '
  const m = require(process.env.PROVIDER);
  process.stdout.write(Object.keys(m).sort().join(","));
' 2>&1)"
EXPECTED_SURFACE="countHook,digest,fireReport,gateRequest,gateVerdict,installedPluginRoot,isAgyPluginRoot,logSnapshot,logWrittenDuring,makeWorkspace,matchingDecisions,nativeAgentIdentities,nativeAgentTranscriptIdentities,nativeAgentVerdict,parseTraceLine,readDecisions,readTrace,resolveTraceFile,sourceWriteCommand,sourceWriteProof,stopContinuationProof,stopCyclePrompt,stopVerdicts,toolProbeArgs,unavailableReason"
[ "$OUT" = "$EXPECTED_SURFACE" ] \
  && ok "requiring the provider exports the helpers without running a probe" \
  || bad "unexpected module surface: $OUT"

# The expression travels through the ENVIRONMENT, never spliced into a
# double-quoted bash string: otherwise bash expands `$`, backticks and backslashes
# before node sees them, and the first case using a template literal or a regex
# escape is silently mangled into a confusing helper bug.
check() { # $1 = label, $2 = expected, $3 = node expression
  local got
  got="$(EXPR="$3" node -e '
    const H = require(process.env.PROVIDER);
    const { parseTraceLine, readTrace, countHook, unavailableReason, resolveTraceFile, stopVerdicts, logWrittenDuring, logSnapshot, fireReport, isAgyPluginRoot } = H;
    process.stdout.write(String(eval(process.env.EXPR)));
  ' 2>&1)"
  if [ "$got" = "$2" ]; then ok "$1"; else bad "$1 — expected '$2', got '$got'"; fi
}

# Same, but with a FAKE home so the provider's agy log dir resolves inside $TMP.
# The dir is computed at module load from os.homedir(), which reads $HOME on
# POSIX, so HOME has to be set on the node process itself — not exported later.
FAKE_LOGS="$TMP/home/.gemini/antigravity-cli/log"
mkdir -p "$FAKE_LOGS"
check_home() { # $1 = label, $2 = expected, $3 = node expression
  local got
  got="$(HOME="$TMP/home" EXPR="$3" node -e '
    const H = require(process.env.PROVIDER);
    const { logWrittenDuring, logSnapshot } = H;
    const LOGS = require("path").join(process.env.HOME, ".gemini", "antigravity-cli", "log");
    process.stdout.write(String(eval(process.env.EXPR)));
  ' 2>&1)"
  if [ "$got" = "$2" ]; then ok "$1"; else bad "$1 — expected '$2', got '$got'"; fi
}

# --- parseTraceLine ---------------------------------------------------------
check "parses '<event> <script> <outcome>'" "Stop|stop-chain-enforcer.sh|ran" \
  '(r => r.event + "|" + r.script + "|" + r.outcome)(parseTraceLine("Stop stop-chain-enforcer.sh ran"))'
check "records a bail outcome verbatim" "PreToolUse|a.sh|bail-missing-script" \
  '(r => r.event + "|" + r.script + "|" + r.outcome)(parseTraceLine("PreToolUse a.sh bail-missing-script"))'
# The script is column 1, not the last token — reading the last token would make a
# bail line parse its outcome as the script name.
check "reads the script from column 1, not the last token" "a.sh" \
  'parseTraceLine("PreToolUse a.sh bail-no-node").script'
check "defaults a two-column line to outcome=ran" "ran" \
  'parseTraceLine("PreInvocation a.sh").outcome'
check "tolerates surrounding whitespace" "PreInvocation|a.sh" \
  '(r => r.event + "|" + r.script)(parseTraceLine("   PreInvocation   a.sh   ran  "))'
check "rejects a line whose script column is not a .sh file" "null" \
  'parseTraceLine("PreToolUse not-a-script ran")'
check "rejects a single-token line" "null" 'parseTraceLine("orphan.sh")'
check "rejects an empty line" "null" 'parseTraceLine("")'

# --- readTrace / countHook --------------------------------------------------
cat > "$TMP/trace.log" <<'TRACEEOF'
PreInvocation user-prompt-intent-router.sh ran
PreInvocation user-prompt-tdd-reminder.sh ran
Stop stop-chain-enforcer.sh ran
PreInvocation user-prompt-intent-router.sh ran
Stop stop-chain-enforcer.sh ran
PreToolUse pre-write-secret-scan.sh bail-missing-script
TRACEEOF

check "readTrace returns one row per traced invocation, bails included" "6" \
  'readTrace(process.env.TMP + "/trace.log").length'
check "countHook counts repeated invocations of one script" "2" \
  'countHook(process.env.TMP + "/trace.log", "stop-chain-enforcer.sh")'
# The whole point of the outcome column: a hook the host invoked but that bailed
# never ran, and counting it would turn a dropped-script packaging defect green.
check "countHook does NOT count a bailed invocation" "0" \
  'countHook(process.env.TMP + "/trace.log", "pre-write-secret-scan.sh")'
check "countHook on a missing trace file yields 0, not an exception" "0" \
  'countHook(process.env.TMP + "/missing.log", "stop-chain-enforcer.sh")'
check "countHook matches the script column, not a substring of the line" "0" \
  'countHook(process.env.TMP + "/trace.log", "chain-enforcer.sh")'

# --- stopVerdicts and native continuation proof ------------------------------
node - "$TMP/stop-fixture.json" <<'NODE'
const fs = require('fs');
const sessionId = '11111111-1111-4111-8111-111111111111';
const prompt = 'Reply with exactly: DONE';
const controlRows = [
  {step_index:0,type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',content:prompt},
  {step_index:1,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',content:'DONE'},
];
const armedRows = [...controlRows,
  {step_index:2,type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',content:`<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\nmetadata`},
  {step_index:3,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',content:'DONE'},
  {step_index:4,type:'SYSTEM_MESSAGE',source:'SYSTEM',status:'DONE',content:'Stop hook blocked termination: continue review'},
  {step_index:5,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',tool_calls:[{name:'view_file',args:{AbsolutePath:'/owned/file'}}]},
  {step_index:6,type:'GENERIC',source:'MODEL',status:'DONE',content:'actual tool result'},
];
const decision = {sessionId,event:'Stop',script:'stop-chain-enforcer.sh'};
fs.writeFileSync(process.argv[2],JSON.stringify({sessionId,prompt,controlRows,armedRows,
  controlDecisions:[{...decision,decision:'raw'}],armedDecisions:[{...decision,decision:'block'}]}));
NODE
P='(change => { const value = JSON.parse(require("fs").readFileSync(process.env.TMP + "/stop-fixture.json", "utf8")); change(value); return H.stopContinuationProof(value); })'
check "a blocked turn with one Stop and later actual tool activity proves resumption" "true" \
  "$P(() => {}).verified"
check "continuation evidence names the exact armed, blocked, resumed and completed tool steps" "2,4,5,1" \
  "(r => [r.armedUserStep,r.blockedStep,r.resumedStep,r.completedToolResults].join(','))($P(() => {}))"
check "a subsequent complete model response also proves host resumption" "true" \
  "$P(f => { delete f.armedRows[5].tool_calls; f.armedRows[5].content='continued'; }).verified"
check "a sibling decision cannot prove this conversation's block" "false" \
  "$P(f => { f.armedDecisions[0].sessionId='22222222-2222-4222-8222-222222222222'; }).verified"
check "own child trace rows do not masquerade as another main conversation" "true" \
  "$P(f => { f.armedDecisions.push({event:'PreToolUse',sessionId:'22222222-2222-4222-8222-222222222222',agentId:'22222222-2222-4222-8222-222222222222',parentSessionId:f.sessionId}); }).verified"
check "foreign child trace rows are rejected" "false" \
  "$P(f => { f.armedDecisions.push({event:'PreToolUse',sessionId:'22222222-2222-4222-8222-222222222222',agentId:'22222222-2222-4222-8222-222222222222',parentSessionId:'33333333-3333-4333-8333-333333333333'}); }).verified"
check "a prior-turn block cannot prove the resumed turn was blocked" "false" \
  "$P(f => { f.controlRows[1]={...f.armedRows[4],step_index:1}; f.armedRows[1]=f.controlRows[1]; f.armedRows.splice(4,1); }).verified"
check "a model-quoted Stop block is not a native system verdict" "false" \
  "$P(f => { f.armedRows[4].source='MODEL'; f.armedRows[4].type='PLANNER_RESPONSE'; }).verified"
check "quoted text in a system message is not the native Stop block envelope" "false" \
  "$P(f => { f.armedRows[4].content='Quoted example: '+f.armedRows[4].content; }).verified"
check "unfinished model activity is not a continuation witness" "false" \
  "$P(f => { f.armedRows[5].status='IN_PROGRESS'; }).verified"
check "unfinished system blocks are not accepted" "false" \
  "$P(f => { f.armedRows[4].status='IN_PROGRESS'; }).verified"
check "a different resumed user prompt invalidates the paired turn" "false" \
  "$P(f => { f.armedRows[2].content='Continue working'; }).verified"
check "new user input cannot supply apparent continuation after the block" "false" \
  "$P(f => { f.armedRows[5]={step_index:5,type:'USER_INPUT',source:'USER_EXPLICIT',status:'DONE',content:f.prompt}; f.armedRows[6]={step_index:6,type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',content:'DONE'}; }).verified"
check "unfinished extra user input also invalidates the turn boundary" "false" \
  "$P(f => { f.armedRows.push({step_index:7,type:'USER_INPUT',source:'USER_EXPLICIT',status:'IN_PROGRESS',content:f.prompt}); }).verified"
check "duplicate native step indices are rejected" "false" \
  "$P(f => { f.armedRows[5].step_index=4; }).verified"
check "reordered native records are rejected" "false" \
  "$P(f => { [f.armedRows[4],f.armedRows[5]]=[f.armedRows[5],f.armedRows[4]]; }).verified"
check "changed prior control history is rejected" "false" \
  "$P(f => { f.armedRows[1].content='foreign history'; }).verified"
check "a host-looking block without own enforcer decision is rejected" "false" \
  "$P(f => { f.armedDecisions[0].decision='raw'; }).verified"
V='(a => { const r = stopVerdicts(a); return r.enforcer + " " + r.host; })'
check "one blocked Stop plus proven resumption reports both verdicts" "STOP-BLOCKED STOP-HONORED" \
  "$V({enforcingStops:1,continuation:{verified:true},stopsUnarmed:1,stopsArmed:1,chainDone:false})"
check "extra Stop counts cannot replace native continuation evidence" "STOP-BLOCKED STOP-NOT-HONORED" \
  "$V({enforcingStops:1,stopsUnarmed:1,stopsArmed:6,chainDone:true})"
check "an unobserved enforcer block cannot report host compliance" "STOP-NOT-BLOCKED STOP-NOT-HONORED" \
  "$V({enforcingStops:0,continuation:{verified:true}})"

# --- resolveTraceFile -------------------------------------------------------
# The only thing between a PR-editable scenario var and an fs.rmSync(force:true).
check "with no explicit path it stays inside the probe workspace" "true" \
  'resolveTraceFile({}, "hookfire", "/ws").path === "/ws/shim-trace.log"'
check "an absolute path outside the temp dir is refused" "true" \
  'Boolean(resolveTraceFile({trace_file: "/etc/zensu-trace.log"}, "hookfire", "/ws").error)'
# macOS: os.tmpdir() is /var/folders/... whose realpath is /private/var/folders/...
# Comparing the unresolved candidate against the resolved root rejected every
# natural $TMPDIR path, so this escape hatch never worked on this platform.
check "a natural temp path is accepted despite the /var -> /private/var symlink" "true" \
  'resolveTraceFile({trace_file: require("os").tmpdir() + "/t.log"}, "hookfire", "/ws").path.length > 0'
check "an accepted path is suffixed per scenario so concurrent probes cannot collide" "true" \
  'resolveTraceFile({trace_file: require("os").tmpdir() + "/t.log", scenario_id: "live-hooks-fire"}, "hookfire", "/ws").path.endsWith("t.log.live-hooks-fire")'
check "a nonexistent parent directory is an error, not a silent write" "true" \
  'Boolean(resolveTraceFile({trace_file: require("os").tmpdir() + "/no-such-dir-xyz/t.log"}, "hookfire", "/ws").error)'

# --- logWrittenDuring -------------------------------------------------------
# Guards against reporting HOOK-PARSE-CLEAN about a log this probe never wrote.
mkdir -p "$TMP/logs"
printf 'old\n' > "$TMP/logs/a.log"
printf 'old\n' > "$TMP/logs/b.log"
check "a log that neither appeared nor grew is not accepted as this run's output" "null" \
  '(() => { const before = logSnapshot(); return logWrittenDuring(before, "/ws/zensu-live-AAA"); })()'
# Growth alone is not ownership. Under maxConcurrency a sibling probe's log grows
# during this probe's run too — and can easily grow MORE — so the candidate has to
# NAME this probe's workspace. Without the marker the caller must get null and
# report LIVE-UNAVAILABLE, never HOOK-PARSE-CLEAN about a stranger's file.
check_home "a grown log that never names this workspace is refused" "null" \
  '(() => {
     const fs = require("fs"), p = require("path");
     fs.writeFileSync(p.join(LOGS, "sibling.log"), "start\n");
     const before = logSnapshot();
     fs.appendFileSync(p.join(LOGS, "sibling.log"), "work in /tmp/zensu-live-OTHER\n");
     return logWrittenDuring(before, "/tmp/zensu-live-MINE");
   })()'
check_home "a grown log that names this workspace is accepted" "mine.log" \
  '(() => {
     const fs = require("fs"), p = require("path");
     fs.writeFileSync(p.join(LOGS, "mine.log"), "start\n");
     const before = logSnapshot();
     fs.appendFileSync(p.join(LOGS, "mine.log"), "cwd /tmp/zensu-live-MINE\n");
     return p.basename(logWrittenDuring(before, "/tmp/zensu-live-MINE"));
   })()'
# The regression in one assertion: the sibling grows MORE, so "prefer the one that
# grew the most" picks it. Only the marker keeps this honest.
check_home "the marker wins over a sibling that grew more" "mine2.log" \
  '(() => {
     const fs = require("fs"), p = require("path");
     fs.writeFileSync(p.join(LOGS, "mine2.log"), "");
     fs.writeFileSync(p.join(LOGS, "big.log"), "");
     const before = logSnapshot();
     fs.appendFileSync(p.join(LOGS, "mine2.log"), "cwd /tmp/zensu-live-MINE2\n");
     fs.appendFileSync(p.join(LOGS, "big.log"), "x".repeat(5000) + " /tmp/zensu-live-OTHER\n");
     return p.basename(logWrittenDuring(before, "/tmp/zensu-live-MINE2"));
   })()'
check_home "no marker at all is refused rather than guessed" "null" \
  '(() => {
     const fs = require("fs"), p = require("path");
     fs.writeFileSync(p.join(LOGS, "any.log"), "");
     const before = logSnapshot();
     fs.appendFileSync(p.join(LOGS, "any.log"), "anything\n");
     return logWrittenDuring(before, "");
   })()'

# --- fireReport --------------------------------------------------------------
# The trace rows a hookfire probe turns into a verdict.
R_ALL='[{event:"PreInvocation",script:"a.sh",outcome:"ran"},{event:"Stop",script:"b.sh",outcome:"ran"}]'
export R_ALL
check "every required pair present reports ALL" "HOOKS-FIRED-ALL" \
  "fireReport($R_ALL, 'PreInvocation:a.sh Stop:b.sh').verdict"
check "an empty trace reports NOT-FIRED" "HOOKS-NOT-FIRED" \
  "fireReport([], 'PreInvocation:a.sh').verdict"
check "a missing pair is named" "HOOKS-FIRED-MISSING Stop:c.sh" \
  "fireReport($R_ALL, 'PreInvocation:a.sh Stop:c.sh').verdict"
check "no requirement degrades to the weaker marker" "HOOKS-FIRED" \
  "fireReport($R_ALL, '').verdict"
# A bailed row proves the host CALLED the registration but the wrapped script never
# ran. Counting it as fired turns a dropped-script packaging defect into a green run.
check "a bailed row does not satisfy a requirement" "HOOKS-FIRED-MISSING PreInvocation:a.sh" \
  "fireReport([{event:'PreInvocation',script:'a.sh',outcome:'bail-missing-script'},{event:'Stop',script:'b.sh',outcome:'ran'}], 'PreInvocation:a.sh').verdict"
check "a bailed row is still reported, not swallowed" "PreInvocation:a.sh(bail-no-node)" \
  "fireReport([{event:'PreInvocation',script:'a.sh',outcome:'bail-no-node'}], '').bailed[0]"
# A tool-call group can only be observed if the model made a tool call. Blaming the
# registration for the model's choice sends the next reader to the wrong file.
check "a required tool-call pair with NO tool call is inconclusive, not missing" "true" \
  "fireReport($R_ALL, 'PreToolUse:w.sh').verdict.startsWith('LIVE-INCONCLUSIVE')"
# But once ANY tool call was observed, a missing pair really is a registration
# problem — this is the discrimination the marker exists for.
check "a required tool-call pair WITH another tool call observed is genuinely missing" "HOOKS-FIRED-MISSING PreToolUse:w.sh" \
  "fireReport([{event:'PreToolUse',script:'other.sh',outcome:'ran'}], 'PreToolUse:w.sh').verdict"

# --- installedPluginRoot -----------------------------------------------------
# ~/.zensu/plugin-root is a single slot every Zensu port writes, so on a machine
# with more than one installed it names whichever went last. All of them ship
# hooks/lib/zensu-log.sh, so an existence check accepts a FOREIGN port's tree and
# the probe arms chain state through the wrong helper. Only this port ships
# hooks/antigravity/antigravity-shim.sh.
mkdir -p "$TMP/foreign/hooks/lib" "$TMP/agy/hooks/lib" "$TMP/agy/hooks/antigravity"
: > "$TMP/foreign/hooks/lib/zensu-log.sh"
: > "$TMP/agy/hooks/lib/zensu-log.sh"
: > "$TMP/agy/hooks/antigravity/antigravity-shim.sh"
check "another Zensu port's plugin root is rejected despite having zensu-log.sh" "false" \
  'isAgyPluginRoot(process.env.TMP + "/foreign")'
check "a real agy plugin root is accepted" "true" \
  'isAgyPluginRoot(process.env.TMP + "/agy")'
check "an empty pointer is rejected without throwing" "false" 'isAgyPluginRoot("")'
check "a nonexistent path is rejected" "false" 'isAgyPluginRoot(process.env.TMP + "/nope")'
# A shim without the helper is a half-staged tree, not an install.
mkdir -p "$TMP/half/hooks/antigravity"
: > "$TMP/half/hooks/antigravity/antigravity-shim.sh"
check "a tree with the shim but no helper is rejected" "false" \
  'isAgyPluginRoot(process.env.TMP + "/half")'
# Falling back to the repo checkout would report a verdict about a tree the host
# never loaded — the exact drift the installed-root rule exists to prevent.
NOROOT="$(HOME="$TMP/empty-home" node -e '
  const { installedPluginRoot } = require(process.env.PROVIDER);
  process.stdout.write(String(installedPluginRoot()));
' 2>&1)"
[ "$NOROOT" = "null" ] \
  && ok "no identifiable install returns null instead of the repo checkout" \
  || bad "expected null with no install, got '$NOROOT'"

# --- permission boundary ----------------------------------------------------
# Permission-limited print mode must remain a refusal, never silently opt into
# a permission bypass. Interactive probes leave every actual approval to the
# operator; their argument list cannot contain an automatic permission grant.
INTERACTIVE_FIXTURE="$TMP/interactive"
mkdir -p "$INTERACTIVE_FIXTURE/evidence/workspaces" "$INTERACTIVE_FIXTURE/plugin/hooks/antigravity" "$INTERACTIVE_FIXTURE/plugin/hooks/lib"
touch "$INTERACTIVE_FIXTURE/plugin/hooks.json" "$INTERACTIVE_FIXTURE/plugin/hooks/antigravity/antigravity-shim.sh" "$INTERACTIVE_FIXTURE/plugin/hooks/lib/zensu-log.sh"
INTERACTIVE_FIXTURE="$(cd "$INTERACTIVE_FIXTURE" && pwd -P)"
export INTERACTIVE_FIXTURE
check "headless synthetic tool probes refuse rather than bypass permissions" "true" \
  '(() => { const fs=require("fs"),os=require("os"),p=require("path"); delete process.env.ZENSU_LIVE_INTERACTIVE; delete process.env.ZENSU_LIVE_PLUGIN_ROOT; delete process.env.ZENSU_LIVE_EVIDENCE_DIR; const ws=fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(),"zensu-live-"))); try{try{H.toolProbeArgs(ws);return false}catch(e){return /interactive/i.test(e.message)}}finally{fs.rmSync(ws,{recursive:true,force:true})} })()'
check "interactive mode without an explicit evidence directory refuses" "true" \
  '(() => { const fs=require("fs"),os=require("os"),p=require("path"); process.env.ZENSU_LIVE_INTERACTIVE="1"; delete process.env.ZENSU_LIVE_EVIDENCE_DIR; const ws=fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(),"zensu-live-"))); try{try{H.toolProbeArgs(ws);return false}catch(e){return /ZENSU_LIVE_EVIDENCE_DIR/.test(e.message)}}finally{fs.rmSync(ws,{recursive:true,force:true})} })()'
ZENSU_LIVE_INTERACTIVE=1 ZENSU_LIVE_EVIDENCE_DIR="$INTERACTIVE_FIXTURE/evidence" ZENSU_LIVE_PLUGIN_ROOT="$INTERACTIVE_FIXTURE/plugin" \
  check "interactive tool probes supply no automatic permission arguments" "[]" \
  '(() => { const fs=require("fs"),p=require("path"); const ws=fs.realpathSync(fs.mkdtempSync(p.join(process.env.ZENSU_LIVE_EVIDENCE_DIR,"workspaces/zensu-live-"))); try{return JSON.stringify(H.toolProbeArgs(ws))}finally{fs.rmSync(ws,{recursive:true,force:true})} })()'
ZENSU_LIVE_INTERACTIVE=1 ZENSU_LIVE_EVIDENCE_DIR="$INTERACTIVE_FIXTURE/evidence" ZENSU_LIVE_PLUGIN_ROOT="$INTERACTIVE_FIXTURE/plugin" \
  check "interactive tool probes reject an ordinary directory" "true" \
  '(() => { try{H.toolProbeArgs(process.env.TMP);return false}catch(e){return /physical disposable live-probe/.test(e.message)} })()'
ZENSU_LIVE_INTERACTIVE=1 ZENSU_LIVE_EVIDENCE_DIR="$INTERACTIVE_FIXTURE/evidence" ZENSU_LIVE_PLUGIN_ROOT="$INTERACTIVE_FIXTURE/plugin" \
  check "a live-named symlink cannot authorize a real project" "true" \
  '(() => { const fs=require("fs"),p=require("path"); const ws=p.join(process.env.ZENSU_LIVE_EVIDENCE_DIR,"workspaces/zensu-live-test"+process.pid); fs.symlinkSync(process.env.TMP,ws); try{try{H.toolProbeArgs(ws);return false}catch(e){return /physical disposable live-probe/.test(e.message)}}finally{fs.unlinkSync(ws)} })()'

# --- unavailableReason ------------------------------------------------------
check "a clean run is available" "" \
  'unavailableReason({exit_code: 0, stdout: "READY", stderr: "", signal: "", spawn_error: ""})'
check "a quota wall on stderr is unavailability" "quota reached" \
  'unavailableReason({exit_code: 1, stdout: "", stderr: "error: quota reached", signal: "", spawn_error: ""})'
# stdout is the model's answer, i.e. data — matching it would report an unreachable
# host for a reply that merely mentions the words.
check "the same words in stdout are DATA, not a transport failure" "" \
  'unavailableReason({exit_code: 0, stdout: "the quota reached its limit", stderr: "", signal: "", spawn_error: ""})'
# A stopcycle cut off mid-loop must not report STOP-NOT-HONORED for a wall clock.
check "a killed run is unavailable even with partial stdout" \
  "agy was killed by SIGTERM (timeout or external kill)" \
  'unavailableReason({exit_code: -1, stdout: "partial", stderr: "", signal: "SIGTERM", spawn_error: ""})'
check "a spawn failure is unavailable" "agy could not run: spawn ENOENT" \
  'unavailableReason({exit_code: -1, stdout: "", stderr: "", signal: "", spawn_error: "spawn ENOENT"})'
check "a non-zero exit with no output is unavailable" "agy exited 3 with no output" \
  'unavailableReason({exit_code: 3, stdout: "", stderr: "", signal: "", spawn_error: ""})'
check "a non-zero exit WITH output is a real result" "" \
  'unavailableReason({exit_code: 1, stdout: "LOADED doctor", stderr: "", signal: "", spawn_error: ""})'

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
