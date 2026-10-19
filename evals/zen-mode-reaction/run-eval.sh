#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "${ZENSU_LIVE_AGY:-}" != 1 ]; then
  echo 'LIVE-SKIPPED: set ZENSU_LIVE_AGY=1 to run native model-reaction probes.' >&2
  exit 2
fi
mkdir -p results
exec promptfoo eval -c promptfooconfig.yaml --output results/latest.json "$@"
