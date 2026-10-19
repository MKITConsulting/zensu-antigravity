#!/bin/bash
# Self-resolution must survive a missing ambient root without selecting a
# shared host pointer or changing the immutable project/session binding.
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export ZENSU_PROJECT_DIR="$WORK/project"
mkdir -p "$ZENSU_PROJECT_DIR"
source "$PLUGIN_DIR/tests/session-control/initialize-baseline.sh" no-root-fixture
unset ZENSU_PLUGIN_ROOT ANTIGRAVITY_PLUGIN_ROOT
OUT="$(printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"zensu features create --product fixture"},"session_id":"no-root-fixture"}' | bash "$PLUGIN_DIR/hooks/pre-bash-zensu-gate.sh")"
node -e 'const j=JSON.parse(process.argv[1]);if(j.hookSpecificOutput.permissionDecision!=="deny")throw Error("self-resolved mutation gate was bypassed")' "$OUT"
ROOT="$PLUGIN_DIR" node -e '
const assert=require("assert/strict"),os=require("os"),path=require("path");
const paths=require(process.env.ROOT+"/hooks/antigravity/session-paths.js");
assert.equal(paths.pluginRoot(),process.env.ROOT);
const actual=paths.dataRoot();process.env.HOME="/an/untrusted/selector";
assert.equal(paths.dataRoot(),actual);
assert.equal(actual,path.join(os.userInfo().homedir,".zensu","antigravity","plugin-data"));
'
echo 'PASS: absent root self-resolves, mutation denial survives, private data root ignores ambient HOME'
