#!/bin/bash
set -u

# Structure test for hooks/lib/persona-activation.js — the deterministic
# repo-local review-persona resolver consumed by the /zensu-tdd Phase 6 fan-out,
# and for the repo-local override precedence in hooks/lib/zensu-overlay.sh.
#
#   A  activation-trigger matching (glob semantics, segment boundaries,
#      basename fallback, comma alternation, quoting, always-join)
#   B  spawn precedence (matched before always-join, lexicographic per group,
#      5-spawn cap with an explicit drop verdict)
#   C  robustness (malformed / symlink / missing dir never abort the chain)
#   D  repo-local resolution: the personas dir comes from the caller's repo,
#      and the overlay/template resolver prefers the repo copy over the shipped
#      plugin default
#
# Fully offline and deterministic: node + temp fixtures only, no network, no agy.

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
JS="$PLUGIN_DIR/hooks/lib/persona-activation.js"
OVERLAY_SH="$PLUGIN_DIR/hooks/lib/zensu-overlay.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}
eq() { # $1=label $2=expected $3=actual
  if [ "$2" = "$3" ]; then
    check "$1" PASS
  else
    check "$1 (expected '$2', got '$3')" FAIL
  fi
}

finish() {
  echo "----"
  echo "test-persona-activation: $PASS PASS / $FAIL FAIL"
  [ "$FAIL" -eq 0 ]
}

if [ ! -f "$JS" ]; then
  check "P0 hooks/lib/persona-activation.js exists" FAIL
  finish
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  check "P0 node available" FAIL
  finish
  exit 1
fi
check "P0 resolver + node present" PASS

FX="$(mktemp -d -t personaact-XXXXXX)"
trap 'rm -rf "$FX"' EXIT

mk_persona() { # $1=dir $2=filestem $3=frontmatter-name $4=activation ("-" = none)
  local dir="$1" stem="$2" name="$3" act="$4"
  mkdir -p "$dir"
  {
    printf -- '---\n'
    printf 'name: %s\n' "$name"
    if [ "$act" != "-" ]; then printf 'activation: %s\n' "$act"; fi
    printf 'description: fixture persona\n'
    printf -- '---\n\nReview body.\n'
  } > "$dir/$stem.md"
}

decide() { # $1=dir; remaining args = changed paths
  local dir="$1"; shift
  printf '%s\n' "$@" | node "$JS" "$dir" 2>/dev/null
}

# ── A — activation-trigger matching ──────────────────────────────────
A="$FX/a"
mk_persona "$A" zensu-review-ddd zensu-review-ddd '"**/domain/**"'
eq "A1 deep glob matches a nested path" \
   "spawn zensu-review-ddd" "$(decide "$A" src/domain/order.ts)"
eq "A2 ** respects the segment boundary (subdomain is not domain)" \
   "skip zensu-review-ddd no-activation-match" "$(decide "$A" src/subdomain/order.ts)"

B="$FX/b"
mk_persona "$B" zensu-review-infra zensu-review-infra '*.tf'
eq "A3 slash-free glob also matches the basename" \
   "spawn zensu-review-infra" "$(decide "$B" infra/main.tf)"
eq "A4 slash-free glob does not match a foreign extension" \
   "skip zensu-review-infra no-activation-match" "$(decide "$B" infra/main.yaml)"

C="$FX/c"
mk_persona "$C" zensu-review-single zensu-review-single 'src/*.ts'
eq "A5 single * stays inside one path segment" \
   "skip zensu-review-single no-activation-match" "$(decide "$C" src/nested/x.ts)"
eq "A6 single * matches within its own segment" \
   "spawn zensu-review-single" "$(decide "$C" src/x.ts)"

D="$FX/d"
mk_persona "$D" zensu-review-multi zensu-review-multi '"**/*.tf", "**/*.yaml"'
eq "A7 comma alternation matches the second glob" \
   "spawn zensu-review-multi" "$(decide "$D" deploy/stack.yaml)"

E="$FX/e"
mk_persona "$E" zensu-review-qmark zensu-review-qmark 'src/a?.ts'
eq "A8 ? matches exactly one in-segment character" \
   "spawn zensu-review-qmark" "$(decide "$E" src/ab.ts)"
eq "A9 ? does not cross a path separator" \
   "skip zensu-review-qmark no-activation-match" "$(decide "$E" src/a/b.ts)"

F="$FX/f"
mk_persona "$F" zensu-review-always zensu-review-always -
eq "A10 a persona without activation: always joins" \
   "spawn zensu-review-always" "$(decide "$F" anything/at/all.md)"
eq "A11 always-join joins even with no changed files" \
   "spawn zensu-review-always" "$(decide "$F" "")"

G="$FX/g"
mk_persona "$G" zensu-review-cost zensu-review-cost \
  '*a*b*c*d*e*f*g*h*i*j*k*l*m*n*o*q*r*'
eq "A12 over-budget wildcard glob is treated as non-matching" \
   "skip zensu-review-cost no-activation-match" "$(decide "$G" src/abcdefghijklmnoqr.ts)"

# ── B — spawn precedence + cap ───────────────────────────────────────
P="$FX/p"
mk_persona "$P" zensu-review-aaa zensu-review-aaa -
mk_persona "$P" zensu-review-bbb zensu-review-bbb -
mk_persona "$P" zensu-review-ccc zensu-review-ccc -
mk_persona "$P" zensu-review-ddd zensu-review-ddd -
mk_persona "$P" zensu-review-eee zensu-review-eee -
mk_persona "$P" zensu-review-zzz zensu-review-zzz '"**/*.tf"'
EXPECTED_P="spawn zensu-review-zzz
spawn zensu-review-aaa
spawn zensu-review-bbb
spawn zensu-review-ccc
spawn zensu-review-ddd
drop zensu-review-eee over-cap"
eq "B1 glob-matched persona takes a slot before always-join ones" \
   "$EXPECTED_P" "$(decide "$P" infra/main.tf)"

Q="$FX/q"
mk_persona "$Q" zensu-review-b2 zensu-review-b2 -
mk_persona "$Q" zensu-review-a1 zensu-review-a1 -
eq "B2 always-join group is emitted lexicographically" \
   "spawn zensu-review-a1
spawn zensu-review-b2" "$(decide "$Q" src/x.ts)"

R="$FX/r"
i=1
while [ "$i" -le 6 ]; do
  mk_persona "$R" "zensu-review-p$i" "zensu-review-p$i" -
  i=$((i+1))
done
eq "B3 the 5-spawn cap emits an explicit drop verdict" \
   "drop zensu-review-p6 over-cap" "$(decide "$R" src/x.ts | grep '^drop ')"
eq "B4 exactly five personas are spawned under cap pressure" \
   "5" "$(decide "$R" src/x.ts | grep -c '^spawn ')"

# ── C — robustness ───────────────────────────────────────────────────
M="$FX/m"
mk_persona "$M" zensu-review-mismatch zensu-review-other -
eq "C1 frontmatter name / filename stem mismatch is malformed" \
   "skip zensu-review-mismatch malformed" "$(decide "$M" src/x.ts)"

N="$FX/n"
mkdir -p "$N"
printf 'no frontmatter here\n' > "$N/zensu-review-raw.md"
eq "C2 a file without frontmatter is malformed" \
   "skip zensu-review-raw malformed" "$(decide "$N" src/x.ts)"

O="$FX/o"
mk_persona "$O" zensu-review-real zensu-review-real -
ln -s "$O/zensu-review-real.md" "$O/zensu-review-link.md" 2>/dev/null
eq "C3 a symlinked persona entry is malformed, the real one still spawns" \
   "spawn zensu-review-real
skip zensu-review-link malformed" "$(decide "$O" src/x.ts)"

S="$FX/s"
mkdir -p "$S"
printf -- '---\nname: zensu-review-bad name\ndescription: x\n---\n' > "$S/zensu-review-bad name.md"
eq "C4 a filename stem outside the reserved shape reports invalid-filename" \
   "skip invalid-filename malformed" "$(decide "$S" src/x.ts)"

eq "C5 a missing personas dir is a silent no-op" \
   "" "$(decide "$FX/does-not-exist" src/x.ts)"
decide "$FX/does-not-exist" src/x.ts >/dev/null 2>&1
eq "C6 a missing personas dir still exits 0" "0" "$?"

T="$FX/t"
mkdir -p "$T"
mk_persona "$T" zensu-review-ok zensu-review-ok -
printf -- '---\nname: zensu-plm\n---\n' > "$T/zensu-plm.md"
printf 'readme\n' > "$T/README.md"
eq "C7 non-persona files in the dir are ignored" \
   "spawn zensu-review-ok" "$(decide "$T" src/x.ts)"

# ── D — repo-local resolution + override precedence ──────────────────
REPO="$FX/repo"
mkdir -p "$REPO/.zensu/agents"
mk_persona "$REPO/.zensu/agents" zensu-review-repo zensu-review-repo -
eq "D1 personas resolve from the caller's repo-local .zensu/agents dir" \
   "spawn zensu-review-repo" "$(printf 'src/x.ts\n' | node "$JS" "$REPO/.zensu/agents" 2>/dev/null)"

if [ -f "$OVERLAY_SH" ]; then
  mkdir -p "$REPO/.zensu/overlays" "$REPO/.zensu/templates"
  OUT="$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --overlay tdd 2>/dev/null)"
  eq "D2 a missing overlay is a silent no-op" "" "$OUT"

  printf -- '- Team convention: every new module gets an ADR reference.\n' \
    > "$REPO/.zensu/overlays/tdd.md"
  OUT="$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --overlay tdd 2>/dev/null)"
  if printf '%s' "$OUT" | grep -qF 'Team convention: every new module gets an ADR reference.'; then
    check "D3 a present overlay is injected verbatim" PASS
  else
    check "D3 a present overlay is injected verbatim" FAIL
  fi
  if printf '%s' "$OUT" | grep -qF 'NEVER disable,' \
    && printf '%s' "$OUT" | grep -qF 'the skill' \
    && printf '%s' "$OUT" | grep -qF 'not enforced by code'; then
    check "D4 the injected block carries the additive-only contract + trust boundary" PASS
  else
    check "D4 the injected block carries the additive-only contract + trust boundary" FAIL
  fi
  if printf '%s' "$OUT" | grep -qF '<!-- zensu:overlay-begin tdd' \
    && printf '%s' "$OUT" | grep -qF '<!-- zensu:overlay-end tdd -->'; then
    check "D5 the injected block is delimited by begin/end markers" PASS
  else
    check "D5 the injected block is delimited by begin/end markers" FAIL
  fi

  ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --overlay ../escape >/dev/null 2>&1
  eq "D6 a traversal overlay name is rejected" "2" "$?"

  eq "D7 a template with no repo copy resolves to the plugin default" \
     "plugin" "$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --template-source tdd-plan 2>/dev/null)"
  printf '# repo override\n' > "$REPO/.zensu/templates/tdd-plan.md"
  eq "D8 a repo-local template wins over the shipped default" \
     "repo" "$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --template-source tdd-plan 2>/dev/null)"
  eq "D9 the winning template path points at the repo copy" \
     "$REPO/.zensu/templates/tdd-plan.md" \
     "$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --template tdd-plan 2>/dev/null)"
  rm -f "$REPO/.zensu/templates/tdd-plan.md"
  eq "D10 removing the repo copy falls back to the shipped default" \
     "$PLUGIN_DIR/templates/tdd-plan.md" \
     "$(ZENSU_REPO_ROOT="$REPO" bash "$OVERLAY_SH" --template tdd-plan 2>/dev/null)"
else
  check "D2 hooks/lib/zensu-overlay.sh exists" FAIL
fi

finish
