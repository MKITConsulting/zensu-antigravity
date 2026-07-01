#!/bin/bash
# Antigravity adaptation of CC's test-gate-session.sh. Upstream gated the
# SessionStart `session-start-pulse.sh` banner on the `pulseSession` config key.
# Antigravity exposes no SessionStart hook to plugin hooks.json, so that banner
# side-effect moved to hooks/antigravity/lazy-init.sh (fired by the shim on the
# first pre-* hook). The CONFIG plumbing is engine-neutral and ported intact:
# this pins that the `pulseSession` toggle round-trips through zensu-config.sh
# (default-on; explicit true; explicit false), and that the lazy-init script the
# banner migrated to exists and runs idempotently without breaking the host.
set -u

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HELPER="$PLUGIN_DIR/hooks/lib/zensu-config.sh"
LAZY="$PLUGIN_DIR/hooks/antigravity/lazy-init.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$HELPER" ]; then
  check "zensu-config.sh exists" FAIL
  echo "----"; echo "test-gate-session: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "zensu-config.sh exists" PASS

if [ -f "$LAZY" ]; then
  check "lazy-init.sh (SessionStart replacement) exists" PASS
else
  check "lazy-init.sh (SessionStart replacement) exists" FAIL
fi

export ZENSU_PLUGIN_ROOT="$PLUGIN_DIR"

# pulseSession=false: helper reports disabled (the banner would skip).
TMP_CFG="/tmp/zensu-gate-session-$$.json"
cat > "$TMP_CFG" <<'EOF'
{"hooks": {"pulseSession": false}}
EOF
export ZENSU_CONFIG="$TMP_CFG"
if bash -c 'source "$0"; zensu_hook_enabled pulseSession' "$HELPER" >/dev/null 2>&1; then
  check "pulseSession=false: helper reports DISABLED" FAIL
else
  check "pulseSession=false: helper reports DISABLED" PASS
fi

# pulseSession=true: helper reports enabled.
cat > "$TMP_CFG" <<'EOF'
{"hooks": {"pulseSession": true}}
EOF
if bash -c 'source "$0"; zensu_hook_enabled pulseSession' "$HELPER" >/dev/null 2>&1; then
  check "pulseSession=true: helper reports ENABLED" PASS
else
  check "pulseSession=true: helper reports ENABLED" FAIL
fi

# No config (default): pulseSession is enabled.
unset ZENSU_CONFIG
NOTHING_CFG="/tmp/zensu-no-config-session-$$.json"
rm -f "$NOTHING_CFG"
export ZENSU_CONFIG="$NOTHING_CFG"
if bash -c 'source "$0"; zensu_hook_enabled pulseSession' "$HELPER" >/dev/null 2>&1; then
  check "no config (default): pulseSession ENABLED" PASS
else
  check "no config (default): pulseSession ENABLED" FAIL
fi

# lazy-init must run on a minimal payload without breaking (fail-open exit 0),
# in a sandbox HOME so the real ~/.zensu pointer is never touched.
if [ -f "$LAZY" ]; then
  SBX_HOME="$(mktemp -d)"
  printf '{"session_id":"gate-session-lazy"}' | env HOME="$SBX_HOME" ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$SBX_HOME" bash "$LAZY" >/dev/null 2>&1
  RC=$?
  [ "$RC" -eq 0 ] && check "lazy-init exits 0 on a minimal payload (fail-open)" PASS || check "lazy-init exits 0 (got $RC)" FAIL
  rm -rf "$SBX_HOME"
fi

rm -f "$TMP_CFG"

echo "----"
echo "test-gate-session: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
