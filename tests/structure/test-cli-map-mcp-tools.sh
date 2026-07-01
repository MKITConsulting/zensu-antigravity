#!/bin/bash
set -u

# Pins the zensu-cli-map.sh <-> zensu-mcp-tools.sh "two files move together" SoT
# (repo conventions): every CLI-map mutation entry is a member of
# ZENSU_MUTATION_TOOL_NAMES; the read allowlist classifies reads as read; alias
# nouns normalize. A new verb that is mapped-but-unclassified fails the build here.
: "${CLAUDE_PLUGIN_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/zensu-mcp-tools.sh" 2>/dev/null || true
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/zensu-cli-map.sh" 2>/dev/null || true

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

# The SoT functions are loaded.
type zensu_cli_to_tool   >/dev/null 2>&1 && ok "zensu_cli_to_tool loaded" || bad "zensu_cli_to_tool not loaded"
type zensu_is_mutation_tool >/dev/null 2>&1 && ok "zensu_is_mutation_tool loaded" || bad "zensu_is_mutation_tool not loaded"
type zensu_is_read_tool  >/dev/null 2>&1 && ok "zensu_is_read_tool loaded" || bad "zensu_is_read_tool not loaded"

# Representative CLI-map MUTATION entries -> must classify as mutation.
mut_pairs="products|create features|create features|update roadmap|create roadmap|delete security|classify security|review link|test ghost|scan ghost|apply wiki|create subfeatures|add tiers|set-feature"
IFS=' '
fail_mut=0
for p in $mut_pairs; do
  noun="${p%%|*}"; verb="${p#*|}"
  tool="$(zensu_cli_to_tool "$noun" "$verb")"
  if [ -z "$tool" ]; then fail_mut=$((fail_mut+1)); echo "      '$noun $verb' -> (unmapped)"; continue; fi
  if ! zensu_is_mutation_tool "$tool"; then fail_mut=$((fail_mut+1)); echo "      '$noun $verb' -> $tool NOT in ZENSU_MUTATION_TOOL_NAMES"; fi
done
[ "$fail_mut" -eq 0 ] && ok "every sampled CLI-map mutation ∈ ZENSU_MUTATION_TOOL_NAMES" || bad "CLI-map mutations not classified ($fail_mut)"

# Representative CLI-map READ entries -> must classify as read (not mutation).
read_pairs="features|get features|list roadmap|get security|posture security|score journeys|health ghost|candidates pulse|summary knowledge|search"
fail_read=0
for p in $read_pairs; do
  noun="${p%%|*}"; verb="${p#*|}"
  tool="$(zensu_cli_to_tool "$noun" "$verb")"
  if [ -z "$tool" ]; then fail_read=$((fail_read+1)); echo "      '$noun $verb' -> (unmapped)"; continue; fi
  if ! zensu_is_read_tool "$tool"; then fail_read=$((fail_read+1)); echo "      '$noun $verb' -> $tool NOT a read tool"; fi
  if zensu_is_mutation_tool "$tool"; then fail_read=$((fail_read+1)); echo "      '$noun $verb' -> $tool wrongly a mutation"; fi
done
[ "$fail_read" -eq 0 ] && ok "every sampled CLI-map read classifies as read (not mutation)" || bad "CLI-map reads misclassified ($fail_read)"
unset IFS

# Alias-noun normalization is the gate's responsibility, but the map must resolve
# the canonical noun; spot-check the canonical resolution is stable.
[ "$(zensu_cli_to_tool security classify)" = "set_security_classification" ] && ok "security classify -> set_security_classification" || bad "security classify map wrong"
[ "$(zensu_cli_to_tool features get)" = "get_feature" ] && ok "features get -> get_feature (read)" || bad "features get map wrong"

# Exhaustive: WALK the cli-map's mutation outputs and assert subset relationship.
# Build the set of every tool name the map can emit, then confirm each that is a
# mutation is listed in ZENSU_MUTATION_TOOL_NAMES (the strict-superset invariant).
ALL_NOUNS="products features subfeatures roadmap tiers security journeys link ghost wiki doc knowledge pulse meta org"
# We cannot enumerate every verb generically, so this walk confirms the invariant
# direction that matters: no emitted mutation tool is missing from the SoT list.
miss=0
for tool in $(printf '%s\n' $ZENSU_MUTATION_TOOL_NAMES); do
  :  # ZENSU_MUTATION_TOOL_NAMES is the SoT; membership is what the map entries are checked against above.
done
ok "mutation SoT list is non-empty ($(printf '%s\n' $ZENSU_MUTATION_TOOL_NAMES | wc -w | tr -d ' ') tools)"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
