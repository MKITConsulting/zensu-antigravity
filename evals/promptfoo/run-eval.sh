#!/bin/bash
# Offline promptfoo proof suite for the zensu-antigravity plugin.
#
# Every scenario drives real plugin artifacts through an exec provider inside a
# disposable sandbox: no network, no model call, no `agy` binary. The suite is
# therefore safe to run in CI and is part of the deterministic gate.
#
#   run-eval.sh              run the suite and verify the results
#   run-eval.sh --self-check validate the config and the provider without evaluating
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$EVAL_DIR/../.." && pwd -P)"

node "$ROOT/tests/prepare-runtime.js" "$ROOT"

PROMPTFOO="$ROOT/node_modules/.bin/promptfoo"
if [ ! -x "$PROMPTFOO" ]; then
  if command -v promptfoo >/dev/null 2>&1; then
    PROMPTFOO="$(command -v promptfoo)"
  else
    echo 'promptfoo suite: promptfoo is not available — run `npm ci` in the plugin root first' >&2
    exit 127
  fi
fi

STATE="$(mktemp -d -t zensu-ag-promptfoo-XXXXXX)"
trap 'rm -rf "$STATE"' EXIT
export PROMPTFOO_CONFIG_DIR="$STATE/config"
export PROMPTFOO_DISABLE_TELEMETRY=1
export PROMPTFOO_DISABLE_UPDATE=1
export PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=1
mkdir -p "$PROMPTFOO_CONFIG_DIR"

cd "$EVAL_DIR"

node --check lib/zensu-provider.js
node --check assertions/expect.js
"$PROMPTFOO" validate config --config promptfooconfig.yaml >/dev/null

if [ "${1:-}" = "--self-check" ]; then
  node verify-results.js --catalog-only
  echo 'promptfoo suite self-check: PASS'
  exit 0
fi

RESULT="$STATE/results.json"
"$PROMPTFOO" eval --config promptfooconfig.yaml \
  --no-cache --no-share --no-write --no-progress-bar \
  --output "$RESULT" >"$STATE/eval.log" 2>&1 || true

if [ ! -s "$RESULT" ]; then
  echo 'promptfoo suite: the evaluator produced no results file' >&2
  tail -40 "$STATE/eval.log" >&2 || true
  exit 1
fi

node verify-results.js "$RESULT"
