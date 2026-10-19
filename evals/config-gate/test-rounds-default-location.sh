#!/bin/bash
# Review rounds belong to the bound canonical workflow document. Retired
# ambient directory overrides never relocate this state into a foreign root.
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export ZENSU_PROJECT_DIR="$WORK/project"
mkdir -p "$ZENSU_PROJECT_DIR"
source "$PLUGIN_DIR/tests/session-control/initialize-baseline.sh" rounds-location
source "$PLUGIN_DIR/hooks/lib/zensu-tdd-phase.sh"
BEFORE="$(tdd_state_file rounds-location)"
export TDD_STATE_DIR="$WORK/foreign" ZENSU_PLUGIN_DATA_OVERRIDE="$WORK/foreign"
AFTER="$(tdd_state_file rounds-location)"
[ "$BEFORE" = "$AFTER" ]
case "$AFTER" in "$ZENSU_PROJECT_ROOT"/.zensu/state/tdd-phase-scv1_*.json) ;; *) exit 1;; esac
CORE="$PLUGIN_DIR/hooks/lib/session-control-core-v1.js" node -e '
const assert=require("assert/strict"),core=require(process.env.CORE);
const state=core.readWorkflowState({projectRoot:process.env.ZENSU_PROJECT_ROOT,sessionId:"rounds-location"});
assert.equal(state.reviewRound,0);
'
[ ! -e "$WORK/foreign" ]
[ -z "$(find "$ZENSU_PROJECT_DIR" -name 'rounds-*.json' -print)" ]
echo 'PASS: review rounds remain in bound CAS; no legacy sidecar or ambient override'
