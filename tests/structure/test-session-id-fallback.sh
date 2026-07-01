#!/bin/bash
set -u

# Ported verbatim from CC (zensu-session.sh is byte-identical per BK9 — the lib
# headers are NOT widened). Pins zensu_resolve_session_id: stdin id ->
# verbatim-sanitized; empty -> deterministic fallback_<key>; stable
# zensu_session_key (<pid>_<cksum>); graceful ps/cksum degradation -> bare PPID.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HELPER="$PLUGIN_DIR/hooks/lib/zensu-session.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$HELPER" ]; then
  check "hooks/lib/zensu-session.sh exists" FAIL
  echo "----"; echo "test-session-id-fallback: $PASS PASS / $FAIL FAIL"; exit 1
fi
check "S2-C0 hooks/lib/zensu-session.sh exists" PASS
bash -n "$HELPER" 2>/dev/null && check "S2-C0a bash -n syntax check on zensu-session.sh" PASS || check "S2-C0a bash -n syntax check on zensu-session.sh" FAIL

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
PROJECT_DIR="$TMP_DIR/proj"
mkdir -p "$PROJECT_DIR/.zensu/state"

# Case 1 — stdin id present -> returned verbatim sanitized.
OUT1=$(CLAUDE_PROJECT_DIR="$PROJECT_DIR" bash -c "source '$HELPER'; zensu_resolve_session_id 'abc-123_real'")
[ "$OUT1" = "abc-123_real" ] && check "S2-C1 stdin id present -> returned verbatim" PASS || check "S2-C1 stdin id (got '$OUT1')" FAIL

# Case 4 — sanitization strips dangerous chars.
OUT4=$(CLAUDE_PROJECT_DIR="$PROJECT_DIR" bash -c "source '$HELPER'; zensu_resolve_session_id '../foo/bar baz'")
case "$OUT4" in
  *../*|*/*|*' '*) check "S2-C4 dangerous chars stripped (got '$OUT4')" FAIL ;;
  *) [ -n "$OUT4" ] && check "S2-C4 dangerous chars (../, /, space) stripped" PASS || check "S2-C4 sanitized id non-empty" FAIL ;;
esac

# Case 6 — zensu_session_key shape + stability.
KEY1=$(bash -c "source '$HELPER'; zensu_session_key")
case "$KEY1" in
  [0-9]*_[0-9]*) check "S2-C6 zensu_session_key shape '<pid>_<cksum>' (got '$KEY1')" PASS ;;
  [0-9]*)        check "S2-C6 zensu_session_key bare pid fallback (got '$KEY1')" PASS ;;
  *)             check "S2-C6 zensu_session_key shape (got '$KEY1')" FAIL ;;
esac
PAIR_OUT=$(bash -c "source '$HELPER'; zensu_session_key; zensu_session_key")
KEY1A=$(echo "$PAIR_OUT" | head -1); KEY1B=$(echo "$PAIR_OUT" | tail -1)
{ [ "$KEY1A" = "$KEY1B" ] && [ -n "$KEY1A" ]; } && check "S2-C6b zensu_session_key stable across two calls in same shell" PASS || check "S2-C6b stable (a='$KEY1A' b='$KEY1B')" FAIL

# Case 3 — stdin empty + cache missing -> deterministic fallback_<key>.
PROJECT_DIR3="$TMP_DIR/proj3"
mkdir -p "$PROJECT_DIR3/.zensu/state"
SEED3="$TMP_DIR/seed3.sh"
cat > "$SEED3" <<EOF
#!/bin/bash
set -u
source "$HELPER"
KEY=\$(zensu_session_key)
RESOLVED=\$(zensu_resolve_session_id "")
echo "RESOLVED=\${RESOLVED}"
echo "KEY=\${KEY}"
EOF
chmod +x "$SEED3"
OUT3_RAW=$(CLAUDE_PROJECT_DIR="$PROJECT_DIR3" "$SEED3" 2>&1)
OUT3=$(echo "$OUT3_RAW" | grep '^RESOLVED=' | cut -d= -f2-)
KEY3=$(echo "$OUT3_RAW" | grep '^KEY=' | cut -d= -f2-)
[ "$OUT3" = "fallback_${KEY3}" ] && check "S2-C3 stdin empty + cache missing -> fallback_<key>" PASS || check "S2-C3 fallback (got '$OUT3' expected 'fallback_${KEY3}')" FAIL
case "$OUT3" in *unknown*) check "S2-C3b fallback never contains literal 'unknown'" FAIL ;; *) check "S2-C3b fallback never contains literal 'unknown'" PASS ;; esac

# Case 7 — graceful degradation when ps/cksum missing -> bare PPID.
DEG="$TMP_DIR/degraded"
mkdir -p "$DEG"
printf '#!/bin/bash\nexit 1\n' > "$DEG/ps"; printf '#!/bin/bash\nexit 1\n' > "$DEG/cksum"
chmod +x "$DEG/ps" "$DEG/cksum"
DEGRADED_KEY=$(env PATH="$DEG:/usr/bin:/bin" bash -c "source '$HELPER'; zensu_session_key")
case "$DEGRADED_KEY" in
  [0-9]*_*) check "S2-C7 ps+cksum failing but key has underscore (ps stub did not block)" FAIL ;;
  [0-9]*)   check "S2-C7 ps/cksum stubbed-failing -> bare numeric PPID fallback" PASS ;;
  *)        check "S2-C7 ps/cksum stubbed (got '$DEGRADED_KEY')" FAIL ;;
esac
DEGRADED_RESOLVE=$(env PATH="$DEG:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$PROJECT_DIR3" bash -c "source '$HELPER'; zensu_resolve_session_id ''")
case "$DEGRADED_RESOLVE" in
  fallback_[0-9]*) check "S2-C7b ps/cksum failing -> resolve returns fallback_<bare-pid>" PASS ;;
  *)               check "S2-C7b ps/cksum failing resolve (got '$DEGRADED_RESOLVE')" FAIL ;;
esac

echo "----"
echo "test-session-id-fallback: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
