#!/bin/bash
# Host-upgrade validation — a small, fail-open helper.
#
# Antigravity can be upgraded while a session is still running: the `agy` binary
# on PATH is replaced, but the already-running session keeps its old runtime and
# its old hook payload dialect. That mismatch is not fatal, but it silently
# explains "the gate stopped firing" / "the payload shape changed" reports, so
# the plugin records the host version when a chain arms and surfaces a clear
# warning if it changes mid-chain.
#
# Contract:
#   - NEVER fatal, NEVER blocking. Every function exits 0 and degrades to
#     "no opinion" (empty output) when the host version cannot be determined.
#   - The stamp is a sidecar next to the chain state file, so it is retired with
#     the chain it belongs to.
#   - ZENSU_HOST_VERSION overrides detection (tests, and users pinning a value).
#   - ZENSU_HOST_VERSION_CHECK=off disables the whole helper.

set -u

# Current host version, or empty when it cannot be determined.
zensu_host_version() {
  [ "${ZENSU_HOST_VERSION_CHECK:-}" = "off" ] && return 0
  if [ -n "${ZENSU_HOST_VERSION:-}" ]; then
    printf '%s' "${ZENSU_HOST_VERSION}" | tr -d '\r\n' | cut -c1-64
    return 0
  fi
  command -v agy >/dev/null 2>&1 || return 0
  local raw
  raw="$(agy --version 2>/dev/null | head -n1 | tr -d '\r\n' | cut -c1-64)" || return 0
  printf '%s' "$raw"
  return 0
}

# Path of the sidecar that stores the version observed when the chain armed.
zensu_host_version_file() {
  local state_file="${1:-}"
  [ -n "$state_file" ] || return 0
  printf '%s' "${state_file}.hostver"
}

# Record the current host version for this chain. Idempotent: an existing stamp
# is never overwritten, so the recorded value stays the ARM-time version for the
# whole chain. Call this on the chain-arm path.
zensu_host_version_stamp() {
  local state_file="${1:-}" stamp_file current
  [ -n "$state_file" ] || return 0
  [ "${ZENSU_HOST_VERSION_CHECK:-}" = "off" ] && return 0
  stamp_file="$(zensu_host_version_file "$state_file")"
  [ -n "$stamp_file" ] || return 0
  # Never write through a symlink, and never re-stamp an existing chain.
  [ -L "$stamp_file" ] && return 0
  [ -s "$stamp_file" ] && return 0
  current="$(zensu_host_version)"
  [ -n "$current" ] || return 0
  mkdir -p "$(dirname "$stamp_file")" 2>/dev/null || true
  printf '%s\n' "$current" > "$stamp_file" 2>/dev/null || true
  return 0
}

# Drop the stamp (chain retired / re-armed).
zensu_host_version_clear() {
  local state_file="${1:-}" stamp_file
  [ -n "$state_file" ] || return 0
  stamp_file="$(zensu_host_version_file "$state_file")"
  [ -n "$stamp_file" ] || return 0
  [ -L "$stamp_file" ] && return 0
  rm -f -- "$stamp_file" 2>/dev/null || true
  return 0
}

# Echo a one-line warning when the host version changed since the chain armed.
# Silent (empty output, rc 0) when there is no stamp, no current version, or no
# drift — the check has no opinion rather than a false alarm.
zensu_host_version_drift() {
  local state_file="${1:-}" stamp_file recorded current
  [ -n "$state_file" ] || return 0
  [ "${ZENSU_HOST_VERSION_CHECK:-}" = "off" ] && return 0
  stamp_file="$(zensu_host_version_file "$state_file")"
  [ -n "$stamp_file" ] || return 0
  [ -L "$stamp_file" ] && return 0
  [ -s "$stamp_file" ] || return 0
  recorded="$(head -n1 "$stamp_file" 2>/dev/null | tr -d '\r\n' | cut -c1-64)"
  [ -n "$recorded" ] || return 0
  current="$(zensu_host_version)"
  [ -n "$current" ] || return 0
  [ "$recorded" = "$current" ] && return 0
  printf 'zensu host-upgrade warning: this chain armed on Antigravity %s but the agy binary now reports %s. The running session keeps the OLD runtime and hook dialect until you start a fresh session — if a gate or payload behaves unexpectedly, restart the session before debugging the plugin.' \
    "$recorded" "$current"
  return 0
}
