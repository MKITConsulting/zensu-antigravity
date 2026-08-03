#!/bin/bash
# pre-write-secret-scan.sh — PreToolUse secret gate for the Antigravity file
# writers (write_to_file / replace_file_content / multi_replace_file_content).
#
# The source-write gate protects WHICH files raw shell commands may write;
# nothing inspected WHAT gets written. This hook closes that gap: it scans the
# payload about to land in a file — the normalized `tool_input.content` the shim
# builds from the writer's body arg — against the curated rule set in
# hooks/lib/secret-patterns.js (the single source of truth: provider tokens plus
# a Shannon-entropy assignment heuristic, no naive catch-all). The decision logic
# lives in hooks/lib/secret-scan-decide.js (payload on stdin, matched rule names
# on stdout); the raw-shell half of the same scan runs inside
# pre-bash-source-write-gate.sh, which already owns the run_command matcher.
#
# Never denied (allowlist): targets under a test(s)/, __tests__/, spec(s)/,
# testdata/, evals/ or fixtures/ directory segment or *.example.* files; lines
# carrying the zensu-secret-allow marker; obvious placeholder values (EXAMPLE,
# PLACEHOLDER, CHANGE_ME, YOUR_, XXXX, ..., <angle>, {{template}}, ${var}).
# Parser or node errors FAIL OPEN — allow, with a note on stderr.
#
# Deliberately NOT a security boundary — bypass via the ZENSU_SECRET_SCAN=off
# env or config hooks.secretScan:false. It is a discipline nudge that keeps
# real-looking credentials out of files.
set -u

: "${ZENSU_PLUGIN_ROOT:=${ANTIGRAVITY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

command -v node >/dev/null 2>&1 || exit 0

# Drain stdin before any early exit so the caller feeding the pipe never sees a
# broken pipe (mirrors pre-bash-source-write-gate.sh's ordering).
INPUT="$(cat 2>/dev/null || true)"

# Process-env escape.
[ "${ZENSU_SECRET_SCAN:-}" = "off" ] && exit 0

[ -z "$INPUT" ] && exit 0

source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-config.sh"
zensu_hook_enabled secretScan || exit 0

RULES="$(printf '%s' "$INPUT" | node "${ZENSU_PLUGIN_ROOT}/hooks/lib/secret-scan-decide.js")"
NODE_RC=$?
if [ "$NODE_RC" -ne 0 ]; then
  echo "zensu secret-scan: scanner error (rc=$NODE_RC), failing open" >&2
  exit 0
fi
# A __bypass__ verdict is the decider's inline-escape report and only reaches
# this hook if a run_command payload was routed here by a mis-rendered matcher —
# never treat the marker itself as a matched rule name.
case "$RULES" in
  ""|__bypass__*) exit 0 ;;
esac

RULES="$RULES" node -e '
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Blocked: the payload matches secret pattern(s): " + process.env.RULES + ". " +
        "Real-looking credentials must not land in files. Legitimate fixture options: " +
        "write the file under a test(s)/, __tests__/, spec(s)/, testdata/, evals/ or " +
        "fixtures/ path or an *.example.* file; or append the zensu-secret-allow marker " +
        "to that line; or use an obvious placeholder (EXAMPLE, YOUR_...). Prefer the " +
        "surgical, auditable escape (the allow marker, visible in the diff) over disabling " +
        "the gate. A blanket opt-out exists but is deliberately not inlined here, so " +
        "turning the whole gate off stays a deliberate, human choice."
    }
  }));
'
echo
exit 0
