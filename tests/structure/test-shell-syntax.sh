#!/usr/bin/env bash
# Every shell script must parse (bash -n) and every JS/ESM module must pass
# node --check; entry executables must carry the +x bit; install.ps1 keeps its
# two Windows literal pins. bash-3.2 (stock macOS) empty-array guard is pinned on
# any runner that builds arg arrays.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

# bash -n every hook + test shell script + install.sh
while IFS= read -r f; do
  [ -f "$f" ] || continue
  rel="${f#"$ROOT"/}"
  if bash -n "$f" 2>/dev/null; then ok "bash -n $rel"; else bad "bash -n $rel"; fi
done < <(find "$ROOT/hooks" "$ROOT/tests" "$ROOT/evals" -name '*.sh' -type f 2>/dev/null; printf '%s\n' "$ROOT/install.sh")

# node --check every shipped .js / .mjs. Not just hooks/: the promptfoo providers,
# assertions and verifier are shipped code too, and the live provider in particular
# is executed by no gate suite — a syntax error there would ship with the gate green
# and only surface during a hand-run live sweep.
while IFS= read -r f; do
  [ -f "$f" ] || continue
  rel="${f#"$ROOT"/}"
  if node --check "$f" 2>/dev/null; then ok "node --check $rel"; else bad "node --check $rel"; fi
done < <(
  find "$ROOT/hooks" "$ROOT/evals" \( -name '*.js' -o -name '*.mjs' \) -type f \
    -not -path '*/results/*' -not -path '*/node_modules/*' 2>/dev/null
)

# Entry executables must be +x.
for f in "$ROOT/install.sh" "$ROOT/hooks/antigravity/antigravity-shim.sh" "$ROOT/tests/run-all.sh"; do
  rel="${f#"$ROOT"/}"
  [ -x "$f" ] && ok "executable: $rel" || bad "not executable: $rel"
done

# install.ps1 correctness is not executable on this runner; pin the two
# Windows-specific fixes literally.
if [ -f "$ROOT/install.ps1" ]; then
  if grep -q 'env:ProgramFiles(x86)}' "$ROOT/install.ps1"; then
    ok "install.ps1 uses \${env:ProgramFiles(x86)} brace form"
  else
    bad "install.ps1 ProgramFiles(x86) interpolation broken"
  fi
  if grep -q "notmatch '..Windows..(System32|Sysnative)" "$ROOT/install.ps1"; then
    ok "install.ps1 functionally excludes WSL System32/Sysnative bash"
  else
    bad "install.ps1 lacks the functional -notmatch System32/Sysnative filter"
  fi
else
  bad "install.ps1 missing"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
