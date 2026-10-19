#!/usr/bin/env bash
# hooks.json.template shape (the TRACKED artifact install.sh renders into the
# real, gitignored hooks.json). Pins the canonical Antigravity wiring:
#   - every hook command is shim-wrapped: `bash __ZENSU_HOME__/hooks/antigravity/
#     antigravity-shim.sh <bare-script>.sh` (BK1)
#   - the wrapped `$1` token is a BARE name — contains NO `/` (BK1; the shim
#     resolves SCRIPT="$ROOT/hooks/$1", so a slash here would be a mis-render)
#   - the only `__ZENSU_HOME__` occurrences are inside command strings (install
#     renders them to one absolute root)
#   - event keys come from the Antigravity set {PreToolUse, PreInvocation,
#     PostToolUse, Stop} (C10)
#   - each event uses the ENTRY STRUCTURE the host requires: a
#     `{matcher, hooks:[...]}` wrapper for the tool-scoped events, a flat list of
#     handler objects for PreInvocation / PostInvocation / Stop. The vocabulary
#     and the per-event structure come from tests/fixtures/host-hook-events.txt.
#     A grouped entry on a flat event is NOT rejected at install time and is
#     invisible to `agy plugin validate`; the host logs
#       Failed to parse hooks for plugin zensu: invalid hook "<group>":
#       command hook must specify 'command'
#     to its own CLI log and runs WITHOUT that group. zensu shipped exactly that
#     for PreInvocation and Stop, so the intent router, the TDD reminder and the
#     Stop chain-enforcer were inert on every run.
#   - the edit matcher is exactly `write_to_file|replace_file_content|
#     multi_replace_file_content` (BK4 — never drop multi_*, never add
#     Edit|Write|MultiEdit), the shell matcher is `run_command` (C3)
#   - the wrapped scripts wired per event match C10 exactly
#   - every wrapped script resolves to a file under hooks/ on disk
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/hooks.json.template"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

[ -f "$TPL" ] || { bad "hooks.json.template missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TPL" 2>/dev/null \
  && ok "hooks.json.template is valid JSON" || { bad "hooks.json.template is not valid JSON"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

# Every command is shim-wrapped as `<shim> <bare-script>.sh <Event>`. The second
# token is what makes emit-verdict pick the right per-event dialect; a command
# missing it degrades to the safe empty verdict, so it must be pinned here.
SHAPE="$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  let total=0, wrapped=0, bareOk=0, homeOk=0, evOk=0;
  const events = new Set(["PreToolUse","PostToolUse","PreInvocation","PostInvocation","Stop"]);
  const re = /^bash\s+__ZENSU_HOME__\/hooks\/antigravity\/antigravity-shim\.sh\s+(\S+)\s+(\S+)\s*$/;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.command === "string") {
        total++;
        const m = o.command.match(re);
        if (m) {
          wrapped++;
          const arg = m[1];
          if (!arg.includes("/")) bareOk++;     // BK1: $1 is a BARE name
          if (events.has(m[2])) evOk++;         // $2 is a known hook event
          // __ZENSU_HOME__ must appear exactly once (the shim path prefix)
          const occ = (o.command.match(/__ZENSU_HOME__/g) || []).length;
          if (occ === 1) homeOk++;
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(t);
  process.stdout.write([total, wrapped, bareOk, homeOk, evOk].join(" "));
' "$TPL" 2>/dev/null)"
read -r N_TOTAL N_WRAP N_BARE N_HOME N_EV <<EOF
$SHAPE
EOF
[ "${N_TOTAL:-0}" -gt 0 ] && ok "template declares $N_TOTAL hook commands" || bad "no hook commands found"
[ "$N_TOTAL" = "$N_WRAP" ] && ok "every command is antigravity-shim.sh-wrapped with a script + event arg ($N_WRAP/$N_TOTAL)" || bad "malformed shim invocation ($N_WRAP/$N_TOTAL well-formed)"
[ "$N_TOTAL" = "$N_BARE" ] && ok "every wrapped \$1 is a BARE script name (no '/') [BK1]" || bad "a wrapped \$1 contains '/' ($N_BARE/$N_TOTAL bare)"
[ "$N_TOTAL" = "$N_HOME" ] && ok "each command has exactly one __ZENSU_HOME__ (the shim prefix)" || bad "command with stray/missing __ZENSU_HOME__ ($N_HOME/$N_TOTAL)"
[ "$N_TOTAL" = "${N_EV:-0}" ] && ok "every wrapped \$2 is a known hook event ($N_EV/$N_TOTAL)" || bad "command with missing/unknown event arg ($N_EV/$N_TOTAL)"

# The declared event token must equal the JSON key the handler sits under. A
# mismatch makes emit-verdict serve a foreign dialect on that event — e.g. a Stop
# handler labelled PreToolUse would emit a decision the host reads as "stop now".
EVMISMATCH="$(node -e '
  const fs = require("fs");
  let t;
  try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (_) { process.exit(0); }
  const out = [];
  const re = /antigravity-shim\.sh\s+(\S+)\s+(\S+)\s*$/;
  const check = (g, ev, h) => {
    if (!h || typeof h.command !== "string") return;
    const m = h.command.match(re);
    if (!m) { out.push(g + "/" + ev + ":no-event-token"); return; }
    if (m[2] !== ev) out.push(g + "/" + ev + ":declares-" + m[2]);
  };
  for (const [g, events] of Object.entries(t || {})) {
    for (const [ev, arr] of Object.entries(events || {})) {
      if (ev === "enabled" || !Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (Array.isArray(entry && entry.hooks)) entry.hooks.forEach(h => check(g, ev, h));
        else check(g, ev, entry);
      }
    }
  }
  process.stdout.write(out.length ? "SCANNED " + out.join(" ") : "SCANNED");
' "$TPL" 2>/dev/null)"
case "$EVMISMATCH" in
  "SCANNED")   ok "every handler's event arg matches the event key it is registered under" ;;
  "SCANNED "*) bad "event-arg mismatch: ${EVMISMATCH#SCANNED }" ;;
  *)           bad "the event-arg scan did not run" ;;
esac

# Event keys come from the fixture, NOT from a second hardcoded list here — a
# private copy would contradict the file this suite calls the source of truth
# (PostInvocation is legal per the fixture, the shim and emit-verdict, and a
# hardcoded set without it would report a correct wiring as an unexpected key).
FIXTURE_EVENTS="$(awk '!/^#/ && NF >= 2 { printf "%s ", $1 }' "$ROOT/tests/fixtures/host-hook-events.txt" 2>/dev/null)"
EVENTS="$(FIXTURE_EVENTS="$FIXTURE_EVENTS" node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const allowed = new Set((process.env.FIXTURE_EVENTS || "").trim().split(/\s+/).filter(Boolean));
  if (!allowed.size) { process.stdout.write(JSON.stringify({ seen: [], bad: "FIXTURE-UNREADABLE" })); process.exit(0); }
  const seen = new Set();
  let bad = "";
  for (const group of Object.values(t)) {
    if (group && typeof group === "object") {
      for (const ev of Object.keys(group)) {
        seen.add(ev);
        if (!allowed.has(ev)) bad += ev + " ";
      }
    }
  }
  process.stdout.write(JSON.stringify({ seen: [...seen].sort(), bad: bad.trim() }));
' "$TPL" 2>/dev/null)"
BADEV="$(printf '%s' "$EVENTS" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(s).bad)}catch(_){}})')"
[ -z "$BADEV" ] && ok "all event keys ∈ {PreToolUse,PreInvocation,PostToolUse,Stop}" || bad "unexpected event key(s): $BADEV"

# --- per-event ENTRY STRUCTURE, driven by the host fixture --------------------
# The one assertion that would have caught the shipped defect. Fails CLOSED: an
# unreadable fixture or an unparseable template must go red, never silently pass.
FIXTURE="$ROOT/tests/fixtures/host-hook-events.txt"
if [ ! -f "$FIXTURE" ]; then
  bad "tests/fixtures/host-hook-events.txt missing — cannot verify per-event structure"
else
  WANT=""
  while read -r ev structure _rest; do
    case "$ev" in ''|\#*) continue ;; esac
    case "$structure" in
      grouped|flat) WANT="$WANT $ev:$structure" ;;
      *) bad "fixture row '$ev' has unknown structure '$structure' (want grouped|flat)" ;;
    esac
  done < "$FIXTURE"

  if [ -z "$WANT" ]; then
    bad "the host-hook-events fixture lists no events"
  else
    ok "host fixture lists $(printf '%s' "$WANT" | wc -w | tr -d ' ') hook events"
    # Emits "<group> <event> <grouped|flat|malformed>" per entry, then SCAN-OK.
    SCAN="$(node -e '
      const fs = require("fs");
      let t;
      try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (_) { process.exit(0); }
      if (!t || typeof t !== "object") process.exit(0);
      const out = [];
      for (const [group, events] of Object.entries(t)) {
        if (!events || typeof events !== "object") { out.push(group + " ? malformed"); continue; }
        for (const [event, arr] of Object.entries(events)) {
          if (event === "enabled") continue;
          if (!Array.isArray(arr)) { out.push(group + " " + event + " malformed"); continue; }
          for (const entry of arr) {
            if (!entry || typeof entry !== "object") { out.push(group + " " + event + " malformed"); }
            else if (Array.isArray(entry.hooks)) out.push(group + " " + event + " grouped");
            else if (typeof entry.command === "string") out.push(group + " " + event + " flat");
            else out.push(group + " " + event + " malformed");
          }
        }
      }
      out.push("SCAN-OK");
      process.stdout.write(out.join("\n"));
    ' "$TPL" 2>/dev/null)"

    case "$SCAN" in
      *SCAN-OK) ok "per-event structure scan ran" ;;
      *) bad "the per-event structure scan did not run (unparseable template or node failure)"; SCAN="" ;;
    esac

    if [ -n "$SCAN" ]; then
      structure_for() { # $1=event -> grouped|flat|"" (unknown to the fixture)
        local e
        for e in $WANT; do
          case "$e" in "$1":*) printf '%s' "${e#*:}"; return 0 ;; esac
        done
        printf ''
      }
      while read -r g ev observed; do
        [ "$g" = "SCAN-OK" ] && continue
        [ -z "${g:-}" ] && continue
        want="$(structure_for "$ev")"
        if [ -z "$want" ]; then
          bad "$g declares event '$ev', absent from the host fixture"
        elif [ "$observed" = "$want" ]; then
          ok "$g/$ev uses the required '$want' structure"
        else
          bad "$g/$ev is '$observed' but the host requires '$want' — the host drops this group at load time"
        fi
      done <<EOF
$SCAN
EOF
    fi
  fi
fi

# Every handler carries a non-empty command, at either nesting depth. That exact
# omission is what the host's rejection message names.
NOCMD="$(node -e '
  const fs = require("fs");
  let t;
  try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (_) { process.exit(0); }
  const out = [];
  const check = (g, e, h) => {
    if (!h || typeof h.command !== "string" || !h.command.trim()) out.push(g + "/" + e);
  };
  for (const [g, events] of Object.entries(t || {})) {
    for (const [e, arr] of Object.entries(events || {})) {
      if (e === "enabled" || !Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (Array.isArray(entry && entry.hooks)) entry.hooks.forEach(h => check(g, e, h));
        else check(g, e, entry);
      }
    }
  }
  process.stdout.write(out.length ? "SCANNED " + out.join(" ") : "SCANNED");
' "$TPL" 2>/dev/null)"
case "$NOCMD" in
  "SCANNED")  ok "every handler carries a non-empty command" ;;
  "SCANNED "*) bad "handler(s) without a command: ${NOCMD#SCANNED }" ;;
  *) bad "the handler-command scan did not run" ;;
esac

# The host owns one wildcard registration; the executable engine inventory owns
# individual gates. Ask the shipped dispatcher, so inventory and runtime cannot
# disagree silently about a second handler that the host never invokes.
node - "$ROOT" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=process.argv[2],manifest=JSON.parse(fs.readFileSync(root+'/hooks.json.template','utf8'));
const pre=Object.values(manifest).flatMap(group=>group.PreToolUse||[]);
assert.equal(pre.length,1);assert.equal(pre[0].matcher,'.*');assert.equal(pre[0].hooks.length,1);
const rows=require(root+'/tests/structure/antigravity-wiring.js').inventory(root);
for(const row of rows)assert.ok(fs.existsSync(path.join(root,'hooks',row.script)),row.script+' missing');
function wired(event,tool,script){assert.ok(rows.some(r=>r.event===event&&r.tool===tool&&r.script===script),event+':'+script+' not dispatched for '+tool)}
for(const tool of ['Write','Edit','MultiEdit'])for(const script of ['pre-reviewer-capability-gate.sh','pre-write-plugin-data-guard.sh','pre-edit-tdd-reminder.sh','pre-write-secret-scan.sh','pre-work-order-gate.sh'])wired('PreToolUse',tool,script);
for(const script of ['pre-bash-zensu-gate.sh','pre-bash-source-write-gate.sh','pre-write-secret-scan.sh','pre-browser-navigation-consent.sh'])wired('PreToolUse','Bash',script);
for(const script of ['user-prompt-intent-router.sh','user-prompt-tdd-reminder.sh','user-prompt-zen-mode.sh'])wired('PreInvocation','Read',script);
for(const script of ['post-artifact-redact.sh','post-browser-navigation-consent.sh','post-work-order.sh'])wired('PostToolUse','Bash',script);
for(const script of ['stop-chain-enforcer.sh','stop-work-order.sh'])wired('Stop','Read',script);
assert.ok(!rows.some(r=>['post-review-tdd-delegate.sh','plan-approved-delegate.sh'].includes(r.script)),'unsupported native completion events must not be invented');
NODE
[ "$?" -eq 0 ] && ok "one PreToolUse host handler dispatches all required real engine gates" || bad "host/engine chain wiring mismatch"

# No `zensu:` colon-form names leaked into the template commands.
grep -qE 'zensu:[a-z]' "$TPL" && bad "template carries colon-form (zensu:foo)" || ok "no colon-form names in template"

# --- the fixture must actually BIND its consumers -----------------------------
# The fixture calls itself the source of truth, but the accepted-event vocabulary is
# also encoded in the shim's `case` alternation and in emit-verdict's `switch`. If
# those drift, a new host event gets half-adopted: declared legal by the fixture,
# silently blanked by the shim, and served the empty verdict. Bind them here.
SHIM_EVENTS="$(sed -n 's/^  \(PreToolUse|.*\)) ;;$/\1/p' "$ROOT/hooks/antigravity/antigravity-shim.sh" | tr '|' ' ')"
EV_EVENTS="$(grep -oE '^  case "(PreToolUse|PostToolUse|PreInvocation|PostInvocation|Stop)":' "$ROOT/hooks/antigravity/emit-verdict.js" \
  | sed 's/.*case "//; s/"://' | tr '\n' ' ')"
sorted() { printf '%s\n' $1 | sort | tr '\n' ' '; }
FIX_SORTED="$(sorted "$FIXTURE_EVENTS")"
SHIM_SORTED="$(sorted "$SHIM_EVENTS")"
EV_SORTED="$(sorted "$EV_EVENTS")"
[ -n "$SHIM_SORTED" ] && [ "$SHIM_SORTED" = "$FIX_SORTED" ] \
  && ok "the shim accepts exactly the fixture's events" \
  || bad "shim event list drifted from the fixture: shim='$SHIM_SORTED' fixture='$FIX_SORTED'"
[ -n "$EV_SORTED" ] && [ "$EV_SORTED" = "$FIX_SORTED" ] \
  && ok "emit-verdict handles exactly the fixture's events" \
  || bad "emit-verdict event switch drifted from the fixture: emit='$EV_SORTED' fixture='$FIX_SORTED'"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
