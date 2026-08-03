#!/bin/bash
# pre-bash-source-write-gate.sh — PreToolUse(Bash) integrity gate for source files.
#
# The plugin gates Edit|Write|MultiEdit (pre-edit-tdd-reminder.sh) and the typed
# `zensu` CLI (pre-bash-zensu-gate.sh), but nothing inspected raw Bash commands
# that write to source files. A low-context agent can corrupt tracked source via
# `printf >> file.rs`, `cat > file.rs <<EOF`, `sed -i`, `tee`, `dd of=` — bypassing
# the Edit gate — and worse, can `cd` into a sibling/main checkout and clobber
# another session's working tree. This hook closes both holes.
#
# It DENIES a write through one of those channels to a source-extension file when
# either:
#   (A) the file already exists and is git-tracked inside the project (clobbering
#       real tracked source), or
#   (B) the resolved path escapes the session root (ZENSU_PROJECT_DIR / cwd) into
#       a sibling or main checkout — the cross-session contamination vector.
# Relative targets resolve against a cwd that tracks `cd` across the command, so
# `cd ../main && printf ... >> src/x.rs` is caught by (B).
#
# Deliberately NOT a security boundary — an agent can still bypass via the escape
# hatch (inline `ZENSU_BASH_WRITE_GATE=off` / `ZENSU_MCP_GATE=off`, the process-env
# equivalents, or config `hooks.bashWriteGate:false`). It is a discipline nudge:
# route source edits through the Edit/Write tools (observable, gate-aware) and stay
# inside your own worktree. Carve-outs never denied: a NEW file inside the project,
# gitignored/untracked files, non-source extensions, and temp roots ($TMPDIR, /tmp,
# /private/tmp, /var/folders). mv/cp are out of scope.
#
# Second, independent step — the SECRET SCAN. Step 1 decides WHICH file a raw
# command may write; step 2 decides WHAT it writes. Whenever the command carries a
# write channel at all (redirect / tee / sed -i / dd of= / heredoc), its text is
# scanned against hooks/lib/secret-patterns.js via hooks/lib/secret-scan-decide.js
# — the same engine pre-write-secret-scan.sh runs on the file writers. The two
# steps have separate switches (`hooks.bashWriteGate` vs `hooks.secretScan`,
# `ZENSU_BASH_WRITE_GATE`/`ZENSU_MCP_GATE` vs `ZENSU_SECRET_SCAN`), so silencing
# one never silences the other. Scanner errors FAIL OPEN.
set -u

: "${ZENSU_PLUGIN_ROOT:=${ANTIGRAVITY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"

command -v node >/dev/null 2>&1 || exit 0

# Drain stdin before any early exit so the caller feeding the pipe never sees a
# broken pipe (mirrors pre-bash-zensu-gate.sh's ordering).
INPUT="$(cat 2>/dev/null || true)"

[ -z "$INPUT" ] && exit 0

source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-config.sh"

emit_deny() {
  REASON="$1" node -e '
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: process.env.REASON
      }
    }));
  '
  echo
}

# Step 1 — WHICH file the command writes. The process-env escapes belong to this
# step alone; the secret scan below carries its own switch.
if [ "${ZENSU_BASH_WRITE_GATE:-}" != "off" ] && [ "${ZENSU_MCP_GATE:-}" != "off" ] \
   && zensu_hook_enabled bashWriteGate; then
  REASON="$(PAYLOAD="$INPUT" node "${ZENSU_PLUGIN_ROOT}/hooks/lib/bash-source-write-parse.js" 2>/dev/null)"
  if [ -n "$REASON" ]; then
    emit_deny "$REASON"
    exit 0
  fi
fi

# Step 2 — WHAT the command writes. The decider scans only commands carrying a
# write channel and reports an inline ZENSU_SECRET_SCAN=off prefix (outside
# heredoc bodies) as a __bypass__ verdict.
[ "${ZENSU_SECRET_SCAN:-}" = "off" ] && exit 0
zensu_hook_enabled secretScan || exit 0

RULES="$(printf '%s' "$INPUT" | node "${ZENSU_PLUGIN_ROOT}/hooks/lib/secret-scan-decide.js" 2>/dev/null)"
NODE_RC=$?
if [ "$NODE_RC" -ne 0 ]; then
  echo "zensu secret-scan: scanner error (rc=$NODE_RC), failing open" >&2
  exit 0
fi
case "$RULES" in
  ""|__bypass__*) exit 0 ;;
esac

emit_deny "Blocked: this shell command writes content matching secret pattern(s): $RULES. \
Real-looking credentials must not land in files through a raw redirect/heredoc either. \
Append the zensu-secret-allow marker to that line, use an obvious placeholder (EXAMPLE, \
YOUR_...), or read the value from the environment instead of inlining it. Deliberate \
one-off: prefix the command with ZENSU_SECRET_SCAN=off."
exit 0
