#!/bin/bash
# zensu-doctor.sh — read-only setup diagnostics for /zensu-doctor.
#
# Probes the local toolchain in the shell (`command -v` and auth-status exit
# codes are a shell concern): the zensu CLI + its auth state, node, the `agy`
# host binary, and the code-forge CLI (gh/glab) resolved from the repo's
# provider. It then hands the results to zensu-doctor-report.js via ZDOC_* env,
# which reads the plugin manifest/hooks, the effective config files, and the
# session state dir and renders a four-block table.
#
# NOTHING here writes. The script always exits 0 — a probe that errors degrades
# to a warning row, never a non-zero exit.
#
# Every ZDOC_* is filled only when the caller left it unset, so the structure
# test (and a skill that already knows a fact) can inject a fixed verdict and
# keep the run deterministic and offline.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"

# Pending-review TTL comes from the CANONICAL getter the Stop enforcer uses, so
# the doctor never reports a TTL the real hooks would disagree with.
if [ -z "${ZDOC_TTL_HOURS:-}" ] && [ -f "$DIR/zensu-config.sh" ]; then
  # shellcheck source=/dev/null
  . "$DIR/zensu-config.sh" 2>/dev/null || true
  if command -v zensu_pending_review_ttl_hours >/dev/null 2>&1; then
    ZDOC_TTL_HOURS="$(zensu_pending_review_ttl_hours 2>/dev/null)"
  fi
fi
export ZDOC_TTL_HOURS="${ZDOC_TTL_HOURS:-}"

# zensu CLI: installed? authenticated? (auth probe is best-effort and quiet)
if [ -z "${ZDOC_ZENSU:-}" ]; then
  if command -v zensu >/dev/null 2>&1; then
    if zensu auth status >/dev/null 2>&1; then ZDOC_ZENSU=authed; else ZDOC_ZENSU=present; fi
  else
    ZDOC_ZENSU=absent
  fi
fi

# node: version string (empty when absent)
if [ -z "${ZDOC_NODE:-}" ]; then
  if command -v node >/dev/null 2>&1; then ZDOC_NODE="$(node --version 2>/dev/null)"; else ZDOC_NODE=""; fi
fi

# agy: the Antigravity host binary. Resolve the PATH entry only — never execute
# it. Doctor must stay fast and side-effect free, and a `--version` spawn of an
# unknown binary is neither.
if [ -z "${ZDOC_AGY:-}" ]; then
  ZDOC_AGY="$(command -v agy 2>/dev/null || true)"
fi

# Forge CLI: resolve the repo's provider (GitHub/GitLab) through the VCS driver
# so the report names the MATCHING CLI (gh/glab) plus its auth state instead of
# hard-probing gh. The driver is a sibling library that may not be present in
# every checkout, so every access is guarded — doctor still renders without it.
# ZENSU_VCS_NO_PROBE=1 keeps the detection offline.
_zdoc_forge_lines() {
  [ -f "$DIR/zensu-vcs.sh" ] || return 0
  local out=""
  out="$(ZENSU_VCS_NO_PROBE=1 bash "$DIR/zensu-vcs.sh" --detect --repo "${ZENSU_PROJECT_DIR:-.}" 2>/dev/null || true)"
  if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  # Fallback: a sourced helper function, isolated in a subshell so a driver that
  # runs a main-at-bottom can neither leak state into the doctor nor abort it.
  (
    # shellcheck source=/dev/null
    . "$DIR/zensu-vcs.sh" >/dev/null 2>&1 || true
    if command -v zensu_vcs_detect >/dev/null 2>&1; then
      ZENSU_VCS_NO_PROBE=1 zensu_vcs_detect "${ZENSU_PROJECT_DIR:-.}" 2>/dev/null || true
    fi
  ) || true
}

if [ -z "${ZDOC_FORGE_PROVIDER:-}" ]; then
  while IFS='=' read -r _zk _zv; do
    case "$_zk" in
      provider) ZDOC_FORGE_PROVIDER="$_zv" ;;
      edition)  ZDOC_FORGE_EDITION="$_zv" ;;
      cliName)  ZDOC_FORGE_CLI="$_zv" ;;
      cliState) ZDOC_FORGE_STATE="$_zv" ;;
    esac
  done <<EOF
$(_zdoc_forge_lines)
EOF
fi
export ZDOC_FORGE_PROVIDER="${ZDOC_FORGE_PROVIDER:-}" \
       ZDOC_FORGE_EDITION="${ZDOC_FORGE_EDITION:-}" \
       ZDOC_FORGE_CLI="${ZDOC_FORGE_CLI:-}" \
       ZDOC_FORGE_STATE="${ZDOC_FORGE_STATE:-}"

export ZDOC_ZENSU ZDOC_NODE ZDOC_AGY

if ! command -v node >/dev/null 2>&1; then
  printf 'Zensu doctor — read-only setup diagnostics\n\n  %s  node: not found on PATH — cannot run the JSON/config/state checks\n' '❌'
  exit 0
fi

(cd -P -- "$DIR" && node ./zensu-doctor-report.js) 2>/dev/null || \
  printf '  %s  zensu-doctor: renderer could not run\n' '⚠️'
exit 0
