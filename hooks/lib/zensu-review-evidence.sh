#!/bin/bash
set -euo pipefail

fail() {
  printf '%s\n' "zensu-review-evidence.sh: $1" >&2
  exit 2
}

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd -P)" \
  || fail 'executing plugin root is unavailable'
[ -n "${ZENSU_PLUGIN_DATA:-}" ] || fail 'ZENSU_PLUGIN_DATA is required'
[ -n "${ZENSU_HOST_SESSION_ID:-}" ] || fail 'ZENSU_HOST_SESSION_ID is required'

if [ -n "${ZENSU_PLUGIN_ROOT:-}" ]; then
  DECLARED="$(CDPATH= cd -- "$ZENSU_PLUGIN_ROOT" 2>/dev/null && pwd -P)" \
    || fail 'ZENSU_PLUGIN_ROOT does not exist'
  [ "$DECLARED" = "$ROOT" ] || fail 'ZENSU_PLUGIN_ROOT does not match the executing plugin'
fi

POLICY="$ROOT/hooks/lib/review-evidence-lease-v1.js"
[ -f "$POLICY" ] && [ ! -L "$POLICY" ] || fail 'lease policy is unavailable'
NODE="$(command -v node 2>/dev/null)" || fail 'node is required'
[ -n "$NODE" ] || fail 'node is required'
NATIVE_ROOT="$(bash "$ROOT/hooks/lib/zensu-host-path.sh" "$ROOT")" \
  || fail 'executing plugin root is unavailable to native Node'
NATIVE_PLUGIN_DATA="$(bash "$ROOT/hooks/lib/zensu-host-path.sh" "$ZENSU_PLUGIN_DATA")" \
  || fail 'ZENSU_PLUGIN_DATA is unavailable to native Node'

export ZENSU_PLUGIN_ROOT="$NATIVE_ROOT" ZENSU_PLUGIN_DATA="$NATIVE_PLUGIN_DATA"
unset PLUGIN_ROOT ZENSU_PLUGIN_ROOT DECLARED NATIVE_ROOT NATIVE_PLUGIN_DATA POLICY
cd -P -- "$ROOT/hooks/lib" || fail 'lease policy directory is unavailable'
unset ROOT
exec "$NODE" ./review-evidence-lease-v1.js "$@"
