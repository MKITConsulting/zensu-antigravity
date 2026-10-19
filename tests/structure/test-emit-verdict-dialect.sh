#!/usr/bin/env bash
# emit-verdict.js speaks the host's per-EVENT output dialect.
#
# Source of truth: the host's own spec, ~/.gemini/antigravity-cli/builtin/skills/
# agy-customizations/docs/hooks.md ("Input/Output Contract"), agy 1.1.10:
#
#   PreToolUse    {"decision":"allow"|"deny"|"ask"|"force_ask","reason":...}
#   PostToolUse   {}
#   PreInvocation {"injectSteps":[{"ephemeralMessage":"..."}]}
#   PostInvocation same, plus optional terminationBehavior
#   Stop          {"decision":"continue",...} blocks the stop; ANY other value
#                 lets the agent stop
#
# Two rules here encode failures that were silent in production and are the
# reason this suite exists:
#
#   1. Stop must say "continue" to hold the turn open. The plugin previously
#      emitted {"decision":"block"}, which the host reads as "not continue" — so
#      the chain-enforcer let every turn end. Nothing warned.
#   2. An ADVISORY on PreToolUse must NOT emit {"decision":"allow"}. On this event
#      "allow" auto-approves the tool call and skips the permission prompt the
#      user would otherwise see. A convention nudge must never buy a tool call a
#      free pass, so it emits ask and drops the nudge text — a real, accepted
#      capability gap, pinned here so nobody "fixes" it by auto-allowing.
#
# Every assertion drives the real script; nothing is re-implemented in the test.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EV="$ROOT/hooks/antigravity/emit-verdict.js"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }
finish() { printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$EV" ] || { bad "emit-verdict.js missing"; finish; exit 1; }

run() { # $1=event $2=role $3=text -> stdout
  ZV_EVENT="$1" ZV_ROLE="$2" ZV_TEXT="$3" node "$EV" 2>/dev/null
}

# jget <json> <node-expression-over-`j`> -> printed value, or "" on parse failure
jget() {
  printf '%s' "$1" | node -e '
    let s = "";
    process.stdin.on("data", c => s += c);
    process.stdin.on("end", () => {
      let j;
      try { j = JSON.parse(s); } catch (_) { process.stdout.write(""); return; }
      let v;
      try { v = eval(process.argv[1]); } catch (_) { v = undefined; }
      process.stdout.write(v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
    });
  ' "$2"
}

assert_json() { # $1=label $2=json
  if printf '%s' "$2" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{JSON.parse(s);process.exit(0)}catch(_){process.exit(1)}})'; then
    ok "$1: output is valid JSON"
  else
    bad "$1: output is not valid JSON ($2)"
  fi
}

# --- PreToolUse ---------------------------------------------------------------
OUT="$(run PreToolUse deny 'gate says no')"
assert_json "PreToolUse/deny" "$OUT"
[ "$(jget "$OUT" 'j.decision')" = "deny" ] && ok "PreToolUse/deny emits decision=deny" || bad "PreToolUse/deny decision is '$(jget "$OUT" 'j.decision')'"
[ "$(jget "$OUT" 'j.reason')" = "gate says no" ] && ok "PreToolUse/deny carries the reason" || bad "PreToolUse/deny lost the reason"

OUT="$(run PreToolUse deny '')"
[ -n "$(jget "$OUT" 'j.reason')" ] && ok "PreToolUse/deny falls back to a default reason" || bad "PreToolUse/deny with empty text has no reason"

OUT="$(run PreToolUse allow 'audited native reviewer batch')"
[ "$(jget "$OUT" 'j.decision')" = allow ] && ok "explicit audited grant emits native allow" || bad "explicit audited grant lost allow"
[ "$(jget "$OUT" 'j.reason')" = 'audited native reviewer batch' ] && ok "explicit audited grant retains its provenance reason" || bad "audited grant reason changed"

OUT="$(run PreToolUse context 'just a nudge')"
assert_json "PreToolUse/context" "$OUT"
[ "$OUT" = '{"decision":"ask"}' ] && ok "PreToolUse advisory requests native permission without carrying advisory text" \
  || bad "PreToolUse advisory emitted unexpected verdict: $OUT"

# --- PostToolUse --------------------------------------------------------------
OUT="$(run PostToolUse context 'anything')"
assert_json "PostToolUse" "$OUT"
[ "$OUT" = "{}" ] && ok "PostToolUse emits the empty object the host expects" || bad "PostToolUse emitted '$OUT', want {}"

# --- PreInvocation ------------------------------------------------------------
OUT="$(run PreInvocation context 'remember the TDD workflow')"
assert_json "PreInvocation" "$OUT"
[ "$(jget "$OUT" 'j.injectSteps.length')" = "1" ] && ok "PreInvocation emits exactly one injected step" || bad "PreInvocation injectSteps length is '$(jget "$OUT" 'j.injectSteps.length')'"
[ "$(jget "$OUT" 'j.injectSteps[0].ephemeralMessage')" = "remember the TDD workflow" ] \
  && ok "PreInvocation carries the advisory as ephemeralMessage" \
  || bad "PreInvocation ephemeralMessage is '$(jget "$OUT" 'j.injectSteps[0].ephemeralMessage')'"
[ -z "$(jget "$OUT" 'j.additionalContext')" ] && ok "PreInvocation does not emit the foreign additionalContext key" || bad "PreInvocation still emits additionalContext"
[ -z "$(jget "$OUT" 'j.decision')" ] && ok "PreInvocation does not emit a tool decision" || bad "PreInvocation emits a decision key"

OUT="$(run PreInvocation context '')"
[ "$OUT" = "{}" ] && ok "PreInvocation with no text injects nothing" || bad "PreInvocation with no text emitted '$OUT'"

# --- PostInvocation -----------------------------------------------------------
OUT="$(run PostInvocation context 'keep going')"
[ "$(jget "$OUT" 'j.injectSteps[0].ephemeralMessage')" = "keep going" ] && ok "PostInvocation shares the injectSteps dialect" || bad "PostInvocation dialect wrong: $OUT"

# --- Stop ---------------------------------------------------------------------
OUT="$(run Stop block 'review chain not done')"
assert_json "Stop/block" "$OUT"
[ "$(jget "$OUT" 'j.decision')" = "continue" ] \
  && ok "Stop/block emits decision=continue (the ONLY value that blocks stopping)" \
  || bad "Stop/block emits decision='$(jget "$OUT" 'j.decision')' — the host would let the agent stop"
[ "$(jget "$OUT" 'j.reason')" = "review chain not done" ] && ok "Stop/block carries the reason" || bad "Stop/block lost the reason"
[ "$(jget "$OUT" 'j.decision')" != "block" ] && ok 'Stop never emits the CC-shaped decision="block"' || bad 'Stop still emits decision="block"'

OUT="$(run Stop context 'nothing to enforce')"
[ -z "$(jget "$OUT" 'j.decision')" ] && ok "Stop with nothing to enforce lets the agent stop" || bad "Stop advisory wrongly blocks: $OUT"

# --- silence and unknown events ------------------------------------------------
OUT="$(run PreToolUse '' '')"
[ "$OUT" = '{"decision":"ask"}' ] && ok "neutral PreToolUse explicitly uses the native permission path" || bad "neutral PreToolUse emitted '$OUT'"

OUT="$(run NotAnEvent deny 'x')"
[ "$OUT" = "{}" ] && ok "unknown event fails safe with {}" || bad "unknown event emitted '$OUT'"

OUT="$(run '' deny 'x')"
[ "$OUT" = "{}" ] && ok "missing event fails safe with {}" || bad "missing event emitted '$OUT'"

# --- the retired dialect must not come back -----------------------------------
for ev in PreToolUse PostToolUse PreInvocation PostInvocation Stop; do
  for role in deny block context; do
    O="$(run "$ev" "$role" 'text')"
    case "$O" in
      *allow_tool*|*deny_reason*)
        bad "$ev/$role still emits the retired allow_tool/deny_reason dialect: $O" ;;
    esac
  done
done
ok "no event emits the retired allow_tool/deny_reason dialect"

finish
