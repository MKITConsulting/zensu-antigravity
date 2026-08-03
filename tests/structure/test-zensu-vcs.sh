#!/bin/bash
set -u

# hooks/lib/zensu-vcs.sh — the forge driver. Pins: sourcing is side-effect free
# (no output, no dispatcher, no git/curl), the detection ladder resolves GitHub
# vs GitLab from SSH and HTTPS remote forms, self-hosted GitLab lands on
# selfhosted + the /api/v4 base, an unresolvable remote degrades to a neutral
# provider=unknown block instead of guessing, and the provider-agnostic op
# surface emits the right forge CLI argv. Fully offline: the probe and the auth
# check are stubbed through the ZENSU_VCS_TEST=1 seams and a PATH curl sentinel
# proves no outbound request fires.
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$PLUGIN_DIR/hooks/lib/zensu-vcs.sh"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

if [ ! -f "$LIB" ]; then
  check "hooks/lib/zensu-vcs.sh exists" FAIL
  echo "----"
  echo "test-zensu-vcs: $PASS PASS / $FAIL FAIL"
  exit 1
fi
check "V1 hooks/lib/zensu-vcs.sh exists" PASS
bash -n "$LIB" 2>/dev/null && check "V2 bash -n syntax check passes" PASS || check "V2 bash -n syntax check passes" FAIL

TMP="$(mktemp -d -t zensuvcs-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

field() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1; }

det() {
  local remote="$1" probe="${2:-}" prov="${3:-}" repodir="${4:-}"
  local a="--detect"
  [ -n "$prov" ] && a="$a --provider $prov"
  [ -n "$repodir" ] && a="$a --repo $repodir"
  env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" \
      ZENSU_VCS_TEST=1 \
      ZENSU_VCS_REMOTE="$remote" \
      ${probe:+ZENSU_VCS_PROBE_RESULT=$probe} \
      ZENSU_VCS_FAKE_AUTH=ready \
      bash "$LIB" $a 2>/dev/null
}

expect() {
  local label="$1" out="$2" key="$3" want="$4" got
  got="$(field "$out" "$key")"
  [ "$got" = "$want" ] && check "$label: $key=$want" PASS || check "$label ($key got '$got' want '$want')" FAIL
}

# ── S: sourcing the lib is side-effect free ──────────────────────────────
# No stdout/stderr, exit 0, the dispatcher must NOT run, and no external
# command (git/curl) is invoked at source time. Sentinels on PATH record any
# call so a future top-level statement cannot silently start shelling out.
SBIN="$TMP/sbin"; mkdir -p "$SBIN"
SLOG="$TMP/source-cmds.log"
for c in git curl gh glab; do
  printf '#!/bin/sh\nprintf "%%s\\n" "%s $*" >> "%s"\nexit 1\n' "$c" "$SLOG" > "$SBIN/$c"
  chmod +x "$SBIN/$c"
done
: > "$SLOG"
SRC_OUT="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" PATH="$SBIN:$PATH" bash -c '. "$1"' _ "$LIB" 2>&1)"; SRC_RC=$?
[ "$SRC_RC" -eq 0 ] && check "S1 sourcing exits 0" PASS || check "S1 sourcing exits 0 (rc=$SRC_RC)" FAIL
[ -z "$SRC_OUT" ] && check "S2 sourcing emits no stdout/stderr" PASS || check "S2 sourcing emits output ('$SRC_OUT')" FAIL
[ ! -s "$SLOG" ] && check "S3 sourcing invokes no git/curl/gh/glab" PASS || check "S3 sourcing invoked: $(tr '\n' ' ' < "$SLOG")" FAIL
SRC_U="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" bash -c 'set -u; . "$1"; printf ok' _ "$LIB" 2>&1)"
[ "$SRC_U" = "ok" ] && check "S4 sourcing is clean under set -u" PASS || check "S4 set -u sourcing (got '$SRC_U')" FAIL
FN_MISS=0
for fn in _zensu_vcs_detect _zensu_vcs_cli_for _zensu_vcs_locate_pr _zensu_vcs_pr_state \
          _zensu_vcs_fetch_threads _zensu_vcs_resolve_thread _zensu_vcs_scout_pr \
          _zensu_vcs_fetch_pr_ref _zensu_vcs_diff_refs _zensu_vcs_post_review _zensu_vcs_open_pr; do
  T="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" bash -c '. "$1"; type -t "$2"' _ "$LIB" "$fn" 2>/dev/null)"
  [ "$T" = "function" ] || { FN_MISS=$((FN_MISS+1)); echo "      missing after source: $fn"; }
done
[ "$FN_MISS" -eq 0 ] && check "S5 every driver op is defined after sourcing" PASS || check "S5 driver ops missing ($FN_MISS)" FAIL

# ── G: GitHub remote -> gh ───────────────────────────────────────────────
O="$(det 'git@github.com:owner/repo.git')"
expect "G1 github ssh"   "$O" provider github
expect "G1 github ssh"   "$O" edition  cloud
expect "G1 github ssh"   "$O" cliName  gh
expect "G1 github ssh"   "$O" apiBase  "https://api.github.com"
expect "G1 github ssh"   "$O" repo     owner/repo
expect "G1 github ssh"   "$O" cliReady true
expect "G1 github ssh"   "$O" cliState ready

O="$(det 'https://github.com/owner/repo.git')"
expect "G2 github https" "$O" provider github
expect "G2 github https" "$O" edition  cloud
expect "G2 github https" "$O" cliName  gh
expect "G2 github https" "$O" repo     owner/repo

O="$(det 'https://user@github.com/owner/repo.git')"
expect "G3 github https userinfo" "$O" provider github
expect "G3 github https userinfo" "$O" cliName  gh

# ── L: GitLab remote -> glab ─────────────────────────────────────────────
O="$(det 'git@gitlab.com:group/proj.git')"
expect "L1 gitlab ssh"   "$O" provider gitlab
expect "L1 gitlab ssh"   "$O" edition  cloud
expect "L1 gitlab ssh"   "$O" cliName  glab
expect "L1 gitlab ssh"   "$O" apiBase  "https://gitlab.com/api/v4"
expect "L1 gitlab ssh"   "$O" repo     "group%2Fproj"

O="$(det 'https://gitlab.com/group/sub/proj.git')"
expect "L2 gitlab https subgroup" "$O" provider gitlab
expect "L2 gitlab https subgroup" "$O" cliName  glab
expect "L2 gitlab https subgroup" "$O" repo     "group%2Fsub%2Fproj"

# ── H: self-hosted hosts (probe stubbed, never a live request) ───────────
SH="$TMP/selfhosted"; mkdir -p "$SH"
O="$(det 'git@git.corp.io:g/p.git' gitlab '' "$SH")"
expect "H1 self-hosted gitlab (ssh)"   "$O" provider gitlab
expect "H1 self-hosted gitlab (ssh)"   "$O" edition  selfhosted
expect "H1 self-hosted gitlab (ssh)"   "$O" cliName  glab
expect "H1 self-hosted gitlab (ssh)"   "$O" apiBase  "https://git.corp.io/api/v4"
expect "H1 self-hosted gitlab (ssh)"   "$O" repo     "g%2Fp"

O="$(det 'https://gitlab.corp.io/team/app.git' gitlab '' "$SH")"
expect "H2 self-hosted gitlab (https)" "$O" provider gitlab
expect "H2 self-hosted gitlab (https)" "$O" edition  selfhosted
expect "H2 self-hosted gitlab (https)" "$O" apiBase  "https://gitlab.corp.io/api/v4"

O="$(det 'https://ghe.corp.io/team/app.git' github-enterprise '' "$SH")"
expect "H3 self-hosted github enterprise" "$O" provider github
expect "H3 self-hosted github enterprise" "$O" edition  enterprise
expect "H3 self-hosted github enterprise" "$O" cliName  gh
expect "H3 self-hosted github enterprise" "$O" apiBase  "https://ghe.corp.io/api/v3"

# Probe misses -> the weak CI-marker tiebreak, still no network.
MK="$TMP/marker"; mkdir -p "$MK"
: > "$MK/.gitlab-ci.yml"
O="$(det 'git@git.corp.io:g/p.git' none '' "$MK")"
expect "H4 probe miss falls to .gitlab-ci.yml marker" "$O" provider gitlab
expect "H4 probe miss falls to .gitlab-ci.yml marker" "$O" edition  selfhosted

# Explicit --provider short-circuits the ladder.
O="$(det 'git@github.com:owner/repo.git' '' gitlab)"
expect "H5 explicit --provider overrides the host" "$O" provider gitlab
expect "H5 explicit --provider overrides the host" "$O" cliName  glab

# ── U: unknown remote -> graceful neutral result ─────────────────────────
UK="$TMP/unknown"; mkdir -p "$UK"
O="$(det 'git@git.corp.io:g/p.git' none '' "$UK")"; UK_RC=$?
expect "U1 unknown host, no marker" "$O" provider unknown
expect "U1 unknown host, no marker" "$O" edition  ""
expect "U1 unknown host, no marker" "$O" apiBase  ""
expect "U1 unknown host, no marker" "$O" repo     ""
expect "U1 unknown host, no marker" "$O" cliName  ""
[ "$UK_RC" -eq 0 ] && check "U2 unknown detect still exits 0 (graceful)" PASS || check "U2 unknown detect exit (rc=$UK_RC)" FAIL

# No forge -> no CLI to authenticate. Asserted WITHOUT the FAKE_AUTH stub (the
# seam short-circuits ahead of the empty-CLI check), so this pins the real
# reconcile state consumers branch on.
O="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_VCS_TEST=1 ZENSU_VCS_PROBE_RESULT=none \
      ZENSU_VCS_REMOTE='git@git.corp.io:g/p.git' bash "$LIB" --detect --repo "$UK" 2>/dev/null)"
expect "U1b unknown -> no CLI" "$O" cliName  ""
expect "U1b unknown -> no CLI" "$O" cliState missing
expect "U1b unknown -> no CLI" "$O" cliReady false

O="$(det '' '' '' "$UK")"
expect "U3 empty remote -> unknown" "$O" provider unknown
expect "U3 empty remote -> unknown" "$O" cliName  ""

O="$(det 'not-a-remote-url' none '' "$UK")"
expect "U4 unparseable remote -> unknown" "$O" provider unknown

# Every key is always emitted, even in the unknown case — consumers parse a
# fixed block, never a variable one.
O="$(det 'git@git.corp.io:g/p.git' none '' "$UK")"
KEY_MISS=0
for k in provider edition apiBase repo cliReady cliName cliState; do
  printf '%s\n' "$O" | grep -q "^$k=" || { KEY_MISS=$((KEY_MISS+1)); echo "      missing key: $k"; }
done
[ "$KEY_MISS" -eq 0 ] && check "U5 all 7 keys emitted even when unknown" PASS || check "U5 keys missing when unknown ($KEY_MISS)" FAIL

# ── P: the probe is SSRF-guarded and never fires for private hosts ────────
# TEST=1 WITHOUT a stubbed PROBE_RESULT drives the REAL probe path; a PATH curl
# sentinel records every attempt. FAKE_AUTH keeps the auth check deterministic.
PBIN="$TMP/pbin"; mkdir -p "$PBIN"
CLOG="$TMP/curl.log"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexit 1\n' "$CLOG" > "$PBIN/curl"; chmod +x "$PBIN/curl"
probe_run() {
  : > "$CLOG"
  env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" PATH="$PBIN:$PATH" \
      ZENSU_VCS_TEST=1 ZENSU_VCS_FAKE_AUTH=ready \
      ZENSU_VCS_FAKE_RESOLVE='git.corp.io=93.184.216.34' \
      ZENSU_VCS_REMOTE="$1" bash "$LIB" --detect --repo "$UK" 2>/dev/null
}
# Positive control: a benign public host DOES reach the sentinel, so the
# negatives below are non-vacuous rather than accidentally green.
probe_run 'git@git.corp.io:g/p.git' >/dev/null
[ -s "$CLOG" ] && check "P1 control: probeable public host reaches curl" PASS || check "P1 control: public host never curled (harness broken)" FAIL
for bad in 127.0.0.1 169.254.169.254 10.0.0.5 192.168.1.1 172.16.0.9 localhost internal.local x.internal FOO.LOCALHOST; do
  O="$(probe_run "git@${bad}:g/p.git")"
  P="$(field "$O" provider)"
  if [ "$P" = unknown ] && [ ! -s "$CLOG" ]; then
    check "P2 private/loopback host '$bad' -> unknown, never curled" PASS
  else
    check "P2 private host '$bad' (provider='$P', curl log $( [ -s "$CLOG" ] && echo nonempty || echo empty ))" FAIL
  fi
done
# Userinfo cannot smuggle a loopback authority past the host capture.
O="$(probe_run 'https://a@b@127.0.0.1/g/p.git')"
P="$(field "$O" provider)"
if [ "$P" = unknown ] && [ ! -s "$CLOG" ]; then
  check "P3 multi-userinfo https cannot reach loopback" PASS
else
  check "P3 multi-userinfo https reached '$P' / curl $( [ -s "$CLOG" ] && echo fired || echo silent )" FAIL
fi

# ZENSU_VCS_NO_PROBE=1 is the offline switch: no curl at all, ladder falls
# through to the marker/unknown tiebreak.
: > "$CLOG"
O="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" PATH="$PBIN:$PATH" ZENSU_VCS_TEST=1 ZENSU_VCS_FAKE_AUTH=ready \
      ZENSU_VCS_NO_PROBE=1 ZENSU_VCS_REMOTE='git@git.corp.io:g/p.git' bash "$LIB" --detect --repo "$UK" 2>/dev/null)"
expect "P4 NO_PROBE -> unknown (offline)" "$O" provider unknown
[ ! -s "$CLOG" ] && check "P4 NO_PROBE fired no curl" PASS || check "P4 NO_PROBE fired curl anyway" FAIL

# The test seams are gated on ZENSU_VCS_TEST=1 — a stray global cannot spoof auth.
O="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_VCS_FAKE_AUTH=ready ZENSU_VCS_PROBE_RESULT=gitlab \
      ZENSU_VCS_NO_PROBE=1 ZENSU_VCS_REMOTE='git@git.corp.io:g/p.git' bash "$LIB" --detect --repo "$UK" 2>/dev/null)"
expect "P5 seams ignored without ZENSU_VCS_TEST=1" "$O" provider unknown

# ── O: the op surface emits the right forge CLI (dry argv) ───────────────
dry() { env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_VCS_TEST=1 ZENSU_VCS_PRINT_ARGV=1 bash "$LIB" "$@" 2>/dev/null; }
argv_is() {
  local label="$1" got="$2" want="$3"
  [ "$got" = "$want" ] && check "$label" PASS || check "$label (got '$got')" FAIL
}
argv_starts() {
  local label="$1" got="$2" want="$3"
  case "$got" in "$want"*) check "$label" PASS ;; *) check "$label (got '$got')" FAIL ;; esac
}

argv_starts "O1 locate-pr github -> gh"  "$(dry --locate-pr --provider github 42)"  "gh pr view"
argv_starts "O1 locate-pr gitlab -> glab" "$(dry --locate-pr --provider gitlab 42)" "glab mr view"
argv_starts "O2 pr-state github -> gh"   "$(dry --pr-state --provider github 42)"   "gh pr view --json state"
argv_starts "O2 pr-state gitlab -> glab" "$(dry --pr-state --provider gitlab 42)"   "glab mr view --output json"
argv_starts "O3 scout-pr github -> gh"   "$(dry --scout-pr --provider github 42)"   "gh pr view --json number,url,state,title"
argv_starts "O3 scout-pr gitlab -> glab" "$(dry --scout-pr --provider gitlab 42)"   "glab mr view --output json"
argv_starts "O4 fetch-threads github -> gh graphql" "$(dry --fetch-threads --provider github --repo-id 'o/r' 42)" "gh api graphql --paginate"
argv_is     "O4 fetch-threads gitlab -> glab discussions" "$(dry --fetch-threads --provider gitlab --repo-id 'g%2Fp' 42)" "glab api --paginate --output json projects/g%2Fp/merge_requests/42/discussions"
argv_is     "O5 fetch-pr-ref github"  "$(dry --fetch-pr-ref --provider github 42)" "pull/42/head"
argv_is     "O5 fetch-pr-ref gitlab"  "$(dry --fetch-pr-ref --provider gitlab 42)" "merge-requests/42/head"
argv_starts "O6 diff-refs github -> headRefOid" "$(dry --diff-refs --provider github 42)" "gh pr view --json headRefOid"
argv_is     "O6 diff-refs gitlab -> mr api" "$(dry --diff-refs --provider gitlab --repo-id 'g%2Fp' 42)" "glab api projects/g%2Fp/merge_requests/42"
argv_starts "O7 open-pr github -> gh pr create" "$(dry --open-pr --provider github --base main --head feat --title T --body-file "$TMP/body.md")" "gh pr create"
argv_starts "O7 open-pr gitlab -> glab mr create" "$(dry --open-pr --provider gitlab --base main --head feat --title T --body-file "$TMP/body.md")" "glab mr create"

# resolve-thread emits reply + resolve; GitHub resolves via GraphQL, GitLab via
# a discussions PUT — the single abstraction both skills call.
RT_GH="$(dry --resolve-thread --provider github --repo-id 'o/r' --reply 'fixed in abc123' 42 THREADID 999)"
case "$RT_GH" in
  *"gh api repos/o/r/pulls/42/comments/999/replies"*) check "O8 resolve-thread github replies to the comment" PASS ;;
  *) check "O8 resolve-thread github reply (got '$RT_GH')" FAIL ;;
esac
case "$RT_GH" in
  *"resolveReviewThread"*) check "O8 resolve-thread github resolves via GraphQL" PASS ;;
  *) check "O8 resolve-thread github resolve (got '$RT_GH')" FAIL ;;
esac
RT_GL="$(dry --resolve-thread --provider gitlab --repo-id 'g%2Fp' --reply 'fixed in abc123' 42 abcdef 2>/dev/null)"
case "$RT_GL" in
  *"glab api --method POST projects/g%2Fp/merge_requests/42/discussions/abcdef/notes"*) check "O9 resolve-thread gitlab posts the reply note" PASS ;;
  *) check "O9 resolve-thread gitlab reply (got '$RT_GL')" FAIL ;;
esac
case "$RT_GL" in
  *"--method PUT projects/g%2Fp/merge_requests/42/discussions/abcdef?resolved=true"*) check "O9 resolve-thread gitlab resolves the discussion" PASS ;;
  *) check "O9 resolve-thread gitlab resolve (got '$RT_GL')" FAIL ;;
esac

# post-review: GitHub is one atomic review object, GitLab degrades to a summary
# note plus one discussion per inline finding.
printf '{"body":"summary","event":"COMMENT","comments":[{"path":"a.ts","line":3,"body":"nit"}]}\n' > "$TMP/review.json"
argv_is "O10 post-review github -> one atomic reviews POST" \
  "$(dry --post-review --provider github --repo-id 'o/r' 42 "$TMP/review.json")" \
  "gh api -X POST repos/o/r/pulls/42/reviews --input $TMP/review.json"
PR_GL="$(dry --post-review --provider gitlab --repo-id 'g%2Fp' 42 "$TMP/review.json")"
GL_NOTES=$(printf '%s\n' "$PR_GL" | grep -c 'merge_requests/42/notes' || true)
GL_DISC=$(printf '%s\n' "$PR_GL" | grep -c 'merge_requests/42/discussions' || true)
{ [ "$GL_NOTES" -eq 1 ] && [ "$GL_DISC" -eq 1 ]; } \
  && check "O10 post-review gitlab -> 1 summary note + 1 inline discussion" PASS \
  || check "O10 post-review gitlab degradation (notes=$GL_NOTES discussions=$GL_DISC)" FAIL

# ── R: neutral/invalid input is rejected, never silently mis-routed ───────
dry --locate-pr --provider bitbucket 42 >/dev/null 2>&1 && check "R1 unknown provider rejected" FAIL || check "R1 unknown provider rejected" PASS
dry --locate-pr 42 >/dev/null 2>&1 && check "R2 missing --provider rejected" FAIL || check "R2 missing --provider rejected" PASS
dry --fetch-threads --provider github --repo-id 'o/r' 'not-a-number' >/dev/null 2>&1 && check "R3 non-numeric PR id rejected" FAIL || check "R3 non-numeric PR id rejected" PASS
dry --fetch-threads --provider github --repo-id '../../etc' 42 >/dev/null 2>&1 && check "R4 traversal repo-id rejected (github)" FAIL || check "R4 traversal repo-id rejected (github)" PASS
dry --fetch-threads --provider gitlab --repo-id 'g%2E%2E%2Fp' 42 >/dev/null 2>&1 && check "R5 encoded-dot repo-id rejected (gitlab)" FAIL || check "R5 encoded-dot repo-id rejected (gitlab)" PASS
bash "$LIB" --bogus-subcommand >/dev/null 2>&1; RC=$?
[ "$RC" -eq 2 ] && check "R6 unknown subcommand -> usage, exit 2" PASS || check "R6 unknown subcommand exit (rc=$RC)" FAIL

# ── D: degrade without node ──────────────────────────────────────────────
BASH_ABS="$(command -v bash)"
O="$(env -i PATH=/dev/null ZENSU_VCS_REMOTE='git@github.com:o/r.git' "$BASH_ABS" "$LIB" --detect 2>/dev/null)"
expect "D1 no-node degrade -> unknown" "$O" provider unknown
expect "D1 no-node degrade -> empty repo" "$O" repo ""

# ── X: real git remote resolution (no network; local repo only) ──────────
if command -v git >/dev/null 2>&1; then
  GT="$TMP/gitrepo"; mkdir -p "$GT"
  git -C "$GT" init -q 2>/dev/null
  git -C "$GT" remote add origin 'https://gitlab.com/acme/widget.git' 2>/dev/null
  O="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_VCS_TEST=1 ZENSU_VCS_FAKE_AUTH=ready bash "$LIB" --detect --repo "$GT" 2>/dev/null)"
  expect "X1 real git remote -> gitlab" "$O" provider gitlab
  expect "X1 real git remote -> gitlab" "$O" repo     "acme%2Fwidget"
  expect "X1 real git remote -> gitlab" "$O" cliName  glab

  GT2="$TMP/gitrepo-noremote"; mkdir -p "$GT2"
  git -C "$GT2" init -q 2>/dev/null
  O="$(env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_VCS_TEST=1 bash "$LIB" --detect --repo "$GT2" 2>/dev/null)"
  expect "X2 git repo with no remote -> unknown" "$O" provider unknown
else
  check "X1/X2 real git path (git present)" FAIL
fi

echo "----"
echo "test-zensu-vcs: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ]
