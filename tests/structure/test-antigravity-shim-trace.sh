#!/usr/bin/env bash
# antigravity-shim.sh firing trace — the opt-in channel that lets the LIVE suite
# observe which hooks the host invoked AND whether they actually ran.
#
# Why the shipped shim writes this itself: the only artifact that knows a hook
# fired is the shim, and the alternative on offer was "instrument the INSTALLED
# copy by hand before running the live suite". That would prove a modified
# artifact fires — not the one users run.
#
# Every assertion below has to be able to FAIL, and two review rounds were needed
# to get there. Traps already fallen into, recorded so they are not re-introduced:
# watching a sentinel directory the shim never receives (passes with the feature
# deleted); inferring "disabled" from a stderr the shim suppresses by construction;
# greps satisfied by comments; and probing the fail-open path with a silent stub
# whose correct output is byte-identical to the bail output. When adding a case,
# state which mutation turns it red.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# Neutralise every ambient path the shim or its libs could treat as a default
# write target. Without this the "provably inert" section below is only as wide as
# $TMP, and a trace defaulting to $TMPDIR or an operator's project dir slips past.
unset ZENSU_SHIM_TRACE
export HOME="$TMP/home"
export TMPDIR="$TMP/tmpdir"
export ZENSU_PROJECT_DIR="$TMP/proj"
mkdir -p "$HOME" "$TMPDIR" "$ZENSU_PROJECT_DIR"

SBX="$TMP/sbx"
mkdir -p "$SBX/hooks/antigravity" "$SBX/hooks/lib"
cp "$ROOT/hooks/antigravity/"*.sh "$SBX/hooks/antigravity/" 2>/dev/null
for name in normalize-payload.js emit-verdict.js session-paths.js; do cp "$ROOT/hooks/antigravity/$name" "$SBX/hooks/antigravity/"; done
cp "$ROOT/hooks/lib/"* "$SBX/hooks/lib/" 2>/dev/null
SBSHIM="$SBX/hooks/antigravity/antigravity-shim.sh"
chmod +x "$SBSHIM" 2>/dev/null

PAYLOAD='{"toolCall":{"name":"run_command","args":{"CommandLine":"echo hi"}}}'

QUIET="$SBX/hooks/zz-quiet.sh"
cat > "$QUIET" <<'QUIETEOF'
#!/bin/bash
cat >/dev/null 2>&1 || true
QUIETEOF
chmod +x "$QUIET"

DENYER="$SBX/hooks/zz-trace-deny.sh"
cat > "$DENYER" <<'DENYEOF'
#!/bin/bash
cat >/dev/null 2>&1 || true
printf '%s' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"trace control"}}'
DENYEOF
chmod +x "$DENYER"

DENY_JSON='{"decision":"deny","reason":"trace control"}'
count_lines() { c="$(grep -c '.' "$1" 2>/dev/null)"; case "$c" in ''|*[!0-9]*) c=0 ;; esac; printf '%s' "$c"; }

# ---------------------------------------------------------------------------
# 1) enabled: exactly ONE line per invocation — event, script, outcome
#    Red when: the trace block is removed, a field is dropped, or more than one
#    line is emitted per call (which would inflate the live suite's Stop counts).
# ---------------------------------------------------------------------------
TRACE="$TMP/trace.log"
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$TRACE" bash "$SBSHIM" zz-quiet.sh PreToolUse >"$TMP/o" 2>"$TMP/e"

if [ -f "$TRACE" ]; then ok "trace enabled: the file is created"; else bad "trace enabled: no file at $TRACE"; fi
N="$(count_lines "$TRACE")"
[ "$N" = "1" ] \
  && ok "exactly one trace line per invocation" \
  || bad "expected 1 trace line, got $N — the live Stop counts would be inflated"
[ "$(cat "$TRACE" 2>/dev/null)" = "PreToolUse zz-quiet.sh ran" ] \
  && ok "the line is exactly '<event> <script> <outcome>'" \
  || bad "unexpected trace line: $(cat "$TRACE" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 2) the EVENT field is real, not a constant
#    Red when: the shim writes a fixed event for every call. The architecture doc
#    attributes fires to hook GROUPS using this field, and the live hookfire
#    scenario requires <event>:<script> pairs.
# ---------------------------------------------------------------------------
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$TRACE" bash "$SBSHIM" zz-trace-deny.sh Stop >"$TMP/o" 2>"$TMP/e"
grep -qxF 'Stop zz-trace-deny.sh ran' "$TRACE" 2>/dev/null \
  && ok "a second event is recorded with ITS own event token (not a constant)" \
  || bad "the Stop invocation was not recorded as 'Stop zz-trace-deny.sh ran': $(cat "$TRACE" 2>/dev/null)"
[ "$(count_lines "$TRACE")" = "2" ] \
  && ok "trace appends across invocations (2 lines)" \
  || bad "trace did not append — $(count_lines "$TRACE") line(s), so earlier hooks are lost"

# An unrecognised event must degrade to the literal `unknown`, never to an empty
# field: a missing first token shifts every column and the consumer drops the row,
# so a hook that DID fire would vanish from the trace.
UNKTRACE="$TMP/unknown.log"
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$UNKTRACE" bash "$SBSHIM" zz-quiet.sh NotAnEvent >/dev/null 2>&1
[ "$(cat "$UNKTRACE" 2>/dev/null)" = "unknown zz-quiet.sh ran" ] \
  && ok "an unrecognised event is recorded as 'unknown', keeping the column count" \
  || bad "unrecognised event produced: $(cat "$UNKTRACE" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 3) the REAL consumer parses what the shim REALLY writes
#    Red when: either side drifts — the shim's field order changes, or the
#    provider's parser changes. Re-implementing the parser here would pin one side
#    only, which is how the two drifted into HOOKS-NOT-FIRED before.
# ---------------------------------------------------------------------------
PROVIDER="$ROOT/evals/promptfoo/lib/agy-live-provider.js"
if [ -f "$PROVIDER" ]; then
  if PROVIDER="$PROVIDER" node -e 'require(process.env.PROVIDER)' >"$TMP/loaderr" 2>&1; then
    PARSED="$(TRACE_FILE="$TRACE" PROVIDER="$PROVIDER" node -e '
      const { readTrace } = require(process.env.PROVIDER);
      const rows = readTrace(process.env.TRACE_FILE);
      process.stdout.write(rows.map(r => r.event + ":" + r.script + ":" + r.outcome).join(","));
    ' 2>&1)"
    [ "$PARSED" = "PreToolUse:zz-quiet.sh:ran,Stop:zz-trace-deny.sh:ran" ] \
      && ok "the live provider's own parser reads both lines back correctly" \
      || bad "provider parser disagrees with the shim's output: got '$PARSED'"
  else
    # Distinct from a format disagreement: a module that will not load is a
    # different defect and must not be reported as a parser mismatch.
    bad "the live provider module could not be loaded: $(head -3 "$TMP/loaderr" | tr '\n' ' ')"
  fi
else
  bad "live provider not found at $PROVIDER"
fi

# ---------------------------------------------------------------------------
# 4) the verdict is UNCHANGED — tracing must never buy or block a tool call
#    Red when: the trace write leaks into stdout, or perturbs the deny path.
#    `env -u` on the control leg so it cannot silently become a second traced run.
# ---------------------------------------------------------------------------
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$TRACE" bash "$SBSHIM" zz-trace-deny.sh PreToolUse >"$TMP/on" 2>/dev/null
printf '%s' "$PAYLOAD" | env -u ZENSU_SHIM_TRACE bash "$SBSHIM" zz-trace-deny.sh PreToolUse >"$TMP/off" 2>/dev/null
if cmp -s "$TMP/on" "$TMP/off"; then
  ok "verdict is byte-identical with tracing on and off (deny path)"
else
  bad "tracing changed the emitted verdict: on=$(cat "$TMP/on") off=$(cat "$TMP/off")"
fi
grep -qF '"decision":"deny"' "$TMP/on" \
  && ok "the traced run still denies (trace does not swallow the verdict)" \
  || bad "traced deny lost its verdict: $(cat "$TMP/on")"

# ---------------------------------------------------------------------------
# 5) DISABLED: provably inert — nothing created OR grown anywhere in the sandbox
#    Red when: the trace writes to a default path, the cwd, $HOME, $TMPDIR or the
#    project dir when the variable is unset. Names alone are not enough: an append
#    to an existing file would be invisible, so sizes and content hashes are part
#    of the snapshot. Node avoids BSD/GNU stat dialect differences: GNU stat -f
#    reports shared filesystem usage, which changes when unrelated jobs write.
# ---------------------------------------------------------------------------
snapshot() {
  node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const root = process.argv[2];
const rows = [];
function walk(relative) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const entry = path.join(relative, name);
    const absolute = path.join(root, entry);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      rows.push([entry, 'directory']);
      walk(entry);
    } else if (stat.isFile()) {
      const hash = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      rows.push([entry, 'file', stat.size, hash]);
    } else if (stat.isSymbolicLink()) {
      rows.push([entry, 'symlink', fs.readlinkSync(absolute)]);
    } else {
      rows.push([entry, 'special', stat.mode, stat.size]);
    }
  }
}
walk('');
process.stdout.write(JSON.stringify(rows));
NODE
}
RUNDIR="$TMP/rundir"; mkdir -p "$RUNDIR"
BEFORE="$(snapshot "$TMP")" || { bad "cannot snapshot the sandbox before the disabled trace probe"; exit 1; }
( cd "$RUNDIR" && printf '%s' "$PAYLOAD" | env -u ZENSU_SHIM_TRACE bash "$SBSHIM" zz-quiet.sh PreInvocation ) >/dev/null 2>&1
AFTER="$(snapshot "$TMP")" || { bad "cannot snapshot the sandbox after the disabled trace probe"; exit 1; }
if [ "$BEFORE" = "$AFTER" ]; then
  ok "trace disabled: not one file created or grown anywhere under the sandbox"
else
  bad "trace disabled but the tree changed: $(diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") | head -4 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 6) UNWRITABLE path: fail-open, verified on the DENY path
#    Probing with a silent hook would be vacuous: its correct output is `{}`, which
#    is byte-identical to what bail() prints — so a shim that ABORTED every hook on
#    a trace-write failure would pass. A deny distinguishes them.
#    Red when: the append's error reaches stderr, anything joins the verdict on
#    stdout, or a failed trace write turns into a bail.
# ---------------------------------------------------------------------------
BADPATH="$TMP/does/not/exist/trace.log"
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$BADPATH" bash "$SBSHIM" zz-trace-deny.sh PreToolUse >"$TMP/o3" 2>"$TMP/e3"
[ -s "$TMP/e3" ] \
  && bad "unwritable trace path leaked to stderr: $(cat "$TMP/e3")" \
  || ok "unwritable trace path is silent (no redirection error on the host's stream)"
[ "$(cat "$TMP/o3")" = "$DENY_JSON" ] \
  && ok "an unwritable trace path still delivers the real verdict (it does not become a bail)" \
  || bad "unwritable trace path damaged the verdict: $(cat "$TMP/o3" | tr '\n' '|')"

# ---------------------------------------------------------------------------
# 7) a /dev/ path is refused (by path prefix, and by non-regular target)
#    Red when: the guard is dropped. ZENSU_SHIM_TRACE=/dev/stdout would otherwise
#    prepend the trace line to the verdict and break the host's JSON parse — the
#    one path where this debug aid can change a decision. Note the shim refuses by
#    PREFIX: with stdout redirected to a file, /dev/stdout is a symlink to that
#    file, so a character-device test would not catch it.
# ---------------------------------------------------------------------------
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE=/dev/stdout bash "$SBSHIM" zz-trace-deny.sh PreToolUse >"$TMP/o4" 2>/dev/null
[ "$(cat "$TMP/o4")" = "$DENY_JSON" ] \
  && ok "a /dev/ trace path is refused (verdict stream stays exactly the verdict)" \
  || bad "/dev/stdout trace corrupted the verdict stream: $(cat "$TMP/o4" | tr '\n' '|')"

# An existing non-regular target is refused too, so a symlinked or exotic path that
# slips the textual prefix check cannot reach the append.
if command -v mkfifo >/dev/null 2>&1 && mkfifo "$TMP/fifo" 2>/dev/null; then
  # Watchdog, because the failing case is a HANG: drop the guard and the append
  # blocks forever on a fifo with no reader. `disown` keeps the kill from printing
  # a job-control notice into the suite's output.
  printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$TMP/fifo" bash "$SBSHIM" zz-trace-deny.sh PreToolUse >"$TMP/o4b" 2>/dev/null &
  FIFO_PID=$!
  ( sleep 3; kill "$FIFO_PID" 2>/dev/null ) >/dev/null 2>&1 &
  WATCH=$!
  disown "$WATCH" 2>/dev/null || true
  wait "$FIFO_PID" 2>/dev/null
  kill "$WATCH" 2>/dev/null || true
  [ "$(cat "$TMP/o4b" 2>/dev/null)" = "$DENY_JSON" ] \
    && ok "an existing non-regular trace target is refused (no block on a fifo)" \
    || bad "a fifo trace target changed the outcome: $(cat "$TMP/o4b" 2>/dev/null | tr '\n' '|')"
else
  ok "skipped: mkfifo unavailable, cannot test the non-regular-target guard"
fi

# ---------------------------------------------------------------------------
# 8) invoked-but-BAILED is recorded, and recorded as NOT having run
#    Both halves matter and they failed in opposite directions across two review
#    rounds. Tracing only after the bails makes a dropped script look like a host
#    that never called us; tracing only before them makes it look like the hook
#    fired. The outcome field is what separates the two.
#    Red when: the trace moves back below the bails (first assertion), or the
#    outcome field is dropped so a bail counts as a fire (second).
# ---------------------------------------------------------------------------
BAILTRACE="$TMP/bail.log"
printf '%s' "$PAYLOAD" | ZENSU_SHIM_TRACE="$BAILTRACE" bash "$SBSHIM" no-such-hook.sh PreToolUse >"$TMP/o5" 2>/dev/null
grep -qxF 'PreToolUse no-such-hook.sh bail-missing-script' "$BAILTRACE" 2>/dev/null \
  && ok "an invocation whose script is missing is recorded, with the bail as its outcome" \
  || bad "a bailed invocation was not recorded as a bail: $(cat "$BAILTRACE" 2>/dev/null)"
if [ -f "$PROVIDER" ]; then
  RANCOUNT="$(TRACE_FILE="$BAILTRACE" PROVIDER="$PROVIDER" node -e '
    const { countHook } = require(process.env.PROVIDER);
    process.stdout.write(String(countHook(process.env.TRACE_FILE, "no-such-hook.sh")));
  ' 2>/dev/null)"
  [ "$RANCOUNT" = "0" ] \
    && ok "the consumer does NOT count a bailed invocation as a hook that ran" \
    || bad "countHook counted a bailed invocation ($RANCOUNT) — a dropped script would read as fired"
fi
[ "$(cat "$TMP/o5")" = '{"decision":"ask"}' ] \
  && ok "the bailed invocation still defers to native permissions" \
  || bad "bailed invocation emitted: $(cat "$TMP/o5" | tr '\n' '|')"

# ---------------------------------------------------------------------------
# 9) both sides of the contract are LOAD-BEARING, not merely mentioned
#    Red when: the shim keeps only its header comment, or the provider keeps only
#    prose. Greps for the bare variable name passed while all functional uses were
#    deleted, so comments are stripped and the provider's THREE call sites counted.
# ---------------------------------------------------------------------------
strip_comments() { sed -e 's://.*::' -e 's:^[[:space:]]*#.*::' "$1"; }
strip_comments "$ROOT/hooks/antigravity/antigravity-shim.sh" | grep -qF '>>"$ZENSU_SHIM_TRACE"' \
  && ok "the shipped shim actually APPENDS to \$ZENSU_SHIM_TRACE" \
  || bad "the shim no longer writes the trace — the live suite would need hand instrumentation again"
SITES="$(strip_comments "$PROVIDER" | grep -cF 'ZENSU_SHIM_TRACE:')"
[ "${SITES:-0}" -ge 3 ] \
  && ok "the live provider passes ZENSU_SHIM_TRACE to agy on all $SITES probe paths" \
  || bad "only ${SITES:-0} provider call site(s) pass ZENSU_SHIM_TRACE — hookfire, hooklog and both stopcycle legs each need one"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
