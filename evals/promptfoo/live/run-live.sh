#!/usr/bin/env bash
# LIVE proof suite — drives a real `agy` install.
#
# Deliberately NOT part of tests/run-all.sh: every scenario is a real model call
# against a logged-in agy, so it costs time and quota and cannot run in CI. The
# deterministic gate stays hermetic; this is the suite you run by hand after
# changing anything that touches the host contract (hooks.json.template, the
# shim, emit-verdict, normalize-payload, the command shims, install.sh).
#
# Without ZENSU_LIVE_AGY=1 every scenario reports LIVE-SKIPPED and passes, so a
# stray invocation is harmless and visible rather than silently green.
#
#   bash evals/promptfoo/live/run-live.sh            # skips everything
#   ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh
#
# Whether hooks FIRE (as opposed to whether agy merely accepts them) is observed
# through the shim's own trace: the shipped `antigravity-shim.sh` appends
# "<event> <script>" to $ZENSU_SHIM_TRACE when that variable is set, and the
# provider gives each probe its own trace path inside its throwaway workspace.
# Nothing here instruments the installed plugin — an instrumented copy would only
# prove that the MODIFIED artifact fires.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/results"
mkdir -p "$OUT"

PROMPTFOO="$ROOT/node_modules/.bin/promptfoo"
[ -x "$PROMPTFOO" ] || PROMPTFOO="npx --no-install promptfoo"

if [ "${ZENSU_LIVE_AGY:-}" != "1" ]; then
  printf 'live suite: ZENSU_LIVE_AGY is not 1 — every scenario will report LIVE-SKIPPED.\n'
  printf '           re-run as: ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh\n\n'
elif ! command -v agy >/dev/null 2>&1; then
  # An explicit opt-in that then skips everything would exit 0 having asked the host
  # nothing — the same "green means verified" violation the LIVE-UNAVAILABLE guard
  # below exists to prevent. Refuse instead.
  printf 'live suite: ZENSU_LIVE_AGY=1 but no `agy` on PATH. Refusing to report a green\n'
  printf '            run that verified nothing. Install agy or unset ZENSU_LIVE_AGY.\n'
  exit 1
else
  printf 'live suite: driving a real agy install. This makes one model call per scenario.\n\n'
fi

# Same hardening the offline runner has. This suite handles real model output, so
# isolating promptfoo's config dir and refusing to share/phone home matters MORE
# here, not less.
STATE="$(mktemp -d -t zensu-ag-live-XXXXXX)"
trap 'rm -rf "$STATE"' EXIT
export PROMPTFOO_CONFIG_DIR="$STATE/config"
export PROMPTFOO_DISABLE_TELEMETRY=1
export PROMPTFOO_DISABLE_UPDATE=1
export PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=1
mkdir -p "$PROMPTFOO_CONFIG_DIR"

cd "$HERE" || exit 1

node --check ../lib/agy-live-provider.js || exit 1
node --check ../lib/results-shape.js || exit 1
node --check ../assertions/expect.js || exit 1
node --check scan-unverified.js || exit 1
$PROMPTFOO validate config --config promptfooconfig.yaml >/dev/null || exit 1

JSON="$OUT/live-$(date +%Y%m%d-%H%M%S).json"

$PROMPTFOO eval --config promptfooconfig.yaml \
  --no-cache --no-progress-bar --no-share --no-write \
  --output "$JSON" >"$OUT/last-run.txt" 2>&1
STATUS=$?

if [ -f "$JSON" ]; then
  node "$ROOT/evals/promptfoo/verify-results.js" "$JSON" "$HERE"
  VERIFY=$?
else
  printf 'live suite: promptfoo produced no result file — see %s\n' "$OUT/last-run.txt"
  tail -20 "$OUT/last-run.txt" 2>/dev/null
  VERIFY=1
fi

# A scenario that could not reach agy (quota wall, expired login, network) — or
# that reached it but never observed the thing it exists to observe — is not a
# pass. Green here has to mean "the host was asked and answered correctly", so
# both cases fail the run loudly rather than reading as verified. The scenarios
# themselves tolerate the markers; this is where they are called out.
REPORT=""
SCAN=0
if [ -f "$JSON" ]; then
  # scan-unverified.js owns this: it reads the result ROWS through the shared
  # results-shape module rather than grepping the blob, and it exits 2 when the
  # envelope itself is unreadable — an unreadable result file must not render as
  # "nothing unverified".
  REPORT="$(node "$HERE/scan-unverified.js" "$JSON")"
  SCAN=$?
fi
if [ "$SCAN" -gt 1 ]; then
  printf '\n'
  printf 'live suite: the result file could not be scanned for unreachable scenarios.\n'
  printf '            Refusing to report a green run — see %s\n' "$OUT/last-run.txt"
  exit 1
fi
if [ -n "$REPORT" ]; then
  COUNT="$(printf '%s' "$REPORT" | sed -n '1p')"
  printf '\n'
  printf 'live suite: %s scenario(s) verified NOTHING — unreachable host, or reached but\n' "$COUNT"
  printf '            inconclusive (see the reasons below).\n'
  printf '            An environment limit (quota, login, network) is not a plugin defect,\n'
  printf '            but it is also not a pass. Re-run when the host is reachable.\n'
  printf '%s' "$REPORT" | sed -n '2,$p' | sed 's/^/            /'
  exit 1
fi

[ "$STATUS" -eq 0 ] && [ "$VERIFY" -eq 0 ]
