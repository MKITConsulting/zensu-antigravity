#!/bin/bash

set -u

_ZENSU_EXECUTED_PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 2
if [ -n "${ZENSU_PLUGIN_ROOT:-}" ]; then
  _ZENSU_DECLARED_PLUGIN_ROOT="$(cd -P -- "$ZENSU_PLUGIN_ROOT" 2>/dev/null && pwd -P)" || {
    echo "zensu- inherited ZENSU_PLUGIN_ROOT does not match the executing plugin" >&2
    exit 2
  }
  if [ "$_ZENSU_DECLARED_PLUGIN_ROOT" != "$_ZENSU_EXECUTED_PLUGIN_ROOT" ]; then
    echo "zensu- inherited ZENSU_PLUGIN_ROOT does not match the executing plugin" >&2
    exit 2
  fi
fi
ZENSU_PLUGIN_ROOT="$_ZENSU_EXECUTED_PLUGIN_ROOT"
unset _ZENSU_EXECUTED_PLUGIN_ROOT _ZENSU_DECLARED_PLUGIN_ROOT
source "${ZENSU_PLUGIN_ROOT}/hooks/lib/zensu-config.sh"

zensu_hook_enabled pulseSession || exit 0

HEAD=$(git rev-parse HEAD 2>/dev/null) || { echo "zensu- not a git repository, pulse session skipped"; exit 0; }
BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && BRANCH="detached"
echo "zensu- pulse session ready — HEAD=$HEAD branch=$BRANCH"
