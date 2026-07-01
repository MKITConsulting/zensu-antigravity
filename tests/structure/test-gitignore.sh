#!/usr/bin/env bash
# .gitignore contract: the ephemeral .zensu/ run-artifact tree (per-session
# state + witness logs) and the GENERATED hooks.json (machine-absolute paths) are
# ignored and never committed; .zensu/config.json (durable user config) stays
# tracked; tests/results/ is ignored. Behavioral check via git check-ignore.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GI="$ROOT/.gitignore"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

if [ ! -f "$GI" ]; then
  bad ".gitignore exists"
  printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1
fi
ok ".gitignore exists"

grep -qE '^/?\.zensu/\*$' "$GI" && ok ".gitignore blanket-ignores .zensu/*" || bad ".gitignore does not blanket-ignore .zensu/*"
grep -qF '!.zensu/config.json' "$GI" && ok ".zensu/config.json stays un-ignored (tracked)" || bad ".zensu/config.json not un-ignored"
grep -qE '^/?hooks\.json$' "$GI" && ok "generated hooks.json is ignored" || bad "generated /hooks.json not ignored"

cd "$ROOT" 2>/dev/null || true
if git rev-parse --git-dir >/dev/null 2>&1; then
  git check-ignore -q ".zensu/state/tdd-phase-x.json" && ok "git check-ignore: .zensu/state/ IS ignored" || bad "git check-ignore: .zensu/state/ not ignored"
  git check-ignore -q ".zensu/logs/witness-smoke-1.log" && ok "git check-ignore: a witness log IS ignored" || bad "git check-ignore: witness log not ignored"
  git check-ignore -q "tests/results/run-all-x.txt" && ok "git check-ignore: tests/results/ IS ignored" || bad "git check-ignore: tests/results/ not ignored"
  git check-ignore -q "hooks.json" && ok "git check-ignore: generated hooks.json IS ignored" || bad "git check-ignore: hooks.json not ignored"
  if git check-ignore -q ".zensu/config.json"; then
    bad "git check-ignore: .zensu/config.json wrongly ignored"
  else
    ok "git check-ignore: .zensu/config.json is NOT ignored (tracked)"
  fi
else
  ok "git check-ignore (skipped: not a git repo)"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
