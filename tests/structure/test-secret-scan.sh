#!/bin/bash
set -u

# Structure + functional test for the secret scan.
#
# Two hooks share one engine: pre-write-secret-scan.sh covers the Antigravity
# file writers (write_to_file / replace_file_content / multi_replace_file_content)
# and pre-bash-source-write-gate.sh runs the same decider as its second step on
# raw run_command writes (heredoc / redirect / tee / sed -i / dd of=). Pinned
# here: the files exist and parse; the SoT chain hook -> secret-scan-decide.js ->
# secret-patterns.js + bash-source-write-parse.js; the config flag (secretScan)
# and env bypass (ZENSU_SECRET_SCAN) on both hooks; fail-open on a scanner
# error; the engine per credential class incl. placeholder suppression; the
# write-channel probe; and hook-level verdicts on synthetic normalized payloads,
# including the shim's normalize step feeding tool_input.content.
#
# hooks.json.template wiring is NOT asserted here — registration is owned by the
# template + the sibling hooks-json-shape / readme-hook-count tests.
#
# Synthetic token literals below are SPLIT with '' (bash string concatenation)
# so the committed file never contains a full provider-shaped token: the test
# feeds the joined value to the gate at runtime, while external secret scanners
# reading the raw file see only fragments.

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$PLUGIN_DIR/hooks/pre-write-secret-scan.sh"
BASH_GATE="$PLUGIN_DIR/hooks/pre-bash-source-write-gate.sh"
ENGINE="$PLUGIN_DIR/hooks/lib/secret-patterns.js"
DECIDE="$PLUGIN_DIR/hooks/lib/secret-scan-decide.js"
PARSER="$PLUGIN_DIR/hooks/lib/bash-source-write-parse.js"
NORMALIZE="$PLUGIN_DIR/hooks/antigravity/normalize-payload.js"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}
finish() {
  echo "----"
  echo "test-secret-scan: $PASS PASS / $FAIL FAIL"
  [ "$FAIL" -eq 0 ]
}

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }

for f in "$HOOK" "$BASH_GATE" "$ENGINE" "$DECIDE" "$PARSER" "$NORMALIZE"; do
  if [ ! -f "$f" ]; then
    check "S0 required file exists: $f" FAIL
    finish; exit 1
  fi
done
check "S0 all six target files exist" PASS

bash -n "$HOOK" 2>/dev/null && check "S1 pre-write-secret-scan.sh bash -n syntax" PASS \
  || check "S1 pre-write-secret-scan.sh bash -n syntax" FAIL
{ node --check "$ENGINE" && node --check "$DECIDE" && node --check "$PARSER"; } 2>/dev/null \
  && check "S2 engine/decider/parser pass node --check" PASS \
  || check "S2 engine/decider/parser pass node --check" FAIL

{ grep -qF 'secret-scan-decide.js' "$HOOK" && grep -qF 'secret-patterns.js' "$DECIDE" \
  && grep -qF 'bash-source-write-parse.js' "$DECIDE"; } \
  && check "S3 SoT chain: hook -> decider -> engine + shared parser" PASS \
  || check "S3 SoT chain: hook -> decider -> engine + shared parser" FAIL

grep -qF 'secret-scan-decide.js' "$BASH_GATE" \
  && check "S4 raw-run_command writes reuse the same decider" PASS \
  || check "S4 raw-run_command writes reuse the same decider" FAIL

for h in "$HOOK" "$BASH_GATE"; do
  n="$(basename "$h")"
  { grep -qF 'zensu_hook_enabled secretScan' "$h" && grep -qF 'ZENSU_SECRET_SCAN' "$h"; } \
    && check "S5 $n honors hooks.secretScan + ZENSU_SECRET_SCAN" PASS \
    || check "S5 $n honors hooks.secretScan + ZENSU_SECRET_SCAN" FAIL
done

{ grep -qiF 'FAIL OPEN' "$HOOK" && grep -qF 'failing open' "$HOOK"; } \
  && check "S6 fail-open documented + implemented in the writer hook" PASS \
  || check "S6 fail-open documented + implemented in the writer hook" FAIL

{ grep -qF 'stripHeredocs(cmd).split' "$DECIDE" && grep -qF '"ZENSU_SECRET_SCAN"' "$DECIDE" \
  && grep -qF '=== "off"' "$DECIDE"; } \
  && check "S7 inline escape decided on heredoc-stripped env tokens (code, not prose)" PASS \
  || check "S7 inline escape decided on heredoc-stripped env tokens (code, not prose)" FAIL

{ grep -qF 'detectChannels' "$PARSER" && grep -qF 'detectChannels' "$DECIDE"; } \
  && check "S8 write-channel probe reuses the shared parser (detectChannels)" PASS \
  || check "S8 write-channel probe reuses the shared parser (detectChannels)" FAIL

# ── Engine unit cases (stdin -> JSON), one per credential class ───────
engine() { printf '%s' "$1" | node "$ENGINE" 2>/dev/null; }

OUT="$(engine 'k = "AKIA''IOSFODNN7RGY4Q2B"')"
case "$OUT" in *'"aws-access-key-id"'*) check "U1 engine: AWS access key id" PASS;; *) check "U1 engine: AWS access key id" FAIL;; esac

OUT="$(engine 'aws_secret_access_key = wJalrXUtnFEMIK7MDENG''bPxRfiCY1234567890Zq')"
case "$OUT" in *'"aws-secret-access-key"'*) check "U2 engine: AWS secret assignment" PASS;; *) check "U2 engine: AWS secret assignment" FAIL;; esac

OUT="$(engine 'ghs_''123456789012345678901234567890123456')"
case "$OUT" in *'"github-token"'*) check "U3 engine: GitHub token" PASS;; *) check "U3 engine: GitHub token" FAIL;; esac

OUT="$(engine 'github_pat_''11ABCDEFG0123456789abc')"
case "$OUT" in *'"github-fine-grained-pat"'*) check "U4 engine: GitHub fine-grained PAT" PASS;; *) check "U4 engine: GitHub fine-grained PAT" FAIL;; esac

OUT="$(engine 'xox''b-1234567890-abcdefghij')"
case "$OUT" in *'"slack-token"'*) check "U5 engine: Slack token" PASS;; *) check "U5 engine: Slack token" FAIL;; esac

OUT="$(engine 'rk_''live_abcdef1234567890XY')"
case "$OUT" in *'"stripe-live-key"'*) check "U6 engine: Stripe live key" PASS;; *) check "U6 engine: Stripe live key" FAIL;; esac

OUT="$(engine '-----BEGIN PRIVATE KEY-----')"
case "$OUT" in *'"private-key-pem"'*) check "U7 engine: PEM private-key header" PASS;; *) check "U7 engine: PEM private-key header" FAIL;; esac

OUT="$(engine 'api_token = "f8Zk2pQ9xL4mNv7wRs3TuY6bE1cD5gHj"')"
case "$OUT" in *'"high-entropy-assignment"'*'"line":1'*) check "U8 engine: high-entropy assignment + line number" PASS;; *) check "U8 engine: high-entropy assignment + line number" FAIL;; esac

OUT="$(engine 'password = "aaaaaaaaaaaaaaaa1"')"
[ "$OUT" = '{"matches":[]}' ] && check "U9 engine: low-entropy value stays clean" PASS || check "U9 engine: low-entropy value stays clean" FAIL

OUT="$(engine 'k = "AKIA''IOSFODNN7EXAMPLE"')"
[ "$OUT" = '{"matches":[]}' ] && check "U10 engine: placeholder suppresses provider rule (EXAMPLE)" PASS || check "U10 engine: placeholder suppresses provider rule (EXAMPLE)" FAIL

OUT="$(engine 'api_key = "XXXX9aB3kZpQ7Lm2XXXX"')"
[ "$OUT" = '{"matches":[]}' ] && check "U11 engine: placeholder suppresses entropy value (XXXX)" PASS || check "U11 engine: placeholder suppresses entropy value (XXXX)" FAIL

OUT="$(engine 'plain prose, nothing secret here')"
[ "$OUT" = '{"matches":[]}' ] && check "U12 engine: clean input -> empty matches" PASS || check "U12 engine: clean input -> empty matches" FAIL

# ── Write-channel probe (module import; require.main guard keeps it silent) ──
detect() { CMD="$1" node -e '
  const { detectChannels } = require(process.argv[1]);
  process.stdout.write(detectChannels(process.env.CMD));
' "$PARSER" 2>/dev/null; }

OUT="$(detect 'printf foo >> notes.txt')"
case "$OUT" in *redirect*) check "D1 channel: >> redirect" PASS;; *) check "D1 channel: >> redirect" FAIL;; esac
OUT="$(detect 'echo hi | tee out.log')"
case "$OUT" in *tee*) check "D2 channel: tee" PASS;; *) check "D2 channel: tee" FAIL;; esac
OUT="$(detect "sed -i '' s/a/b/ f.txt")"
case "$OUT" in *"sed -i"*) check "D3 channel: sed -i" PASS;; *) check "D3 channel: sed -i" FAIL;; esac
OUT="$(detect 'dd if=/dev/zero of=img.bin bs=1')"
case "$OUT" in *"dd of="*) check "D4 channel: dd of=" PASS;; *) check "D4 channel: dd of=" FAIL;; esac
OUT="$(detect "$(printf 'cat > x.txt <<EOF\nbody\nEOF\n')")"
case "$OUT" in *heredoc*) check "D5 channel: heredoc" PASS;; *) check "D5 channel: heredoc" FAIL;; esac
OUT="$(detect 'ls -la 2>&1')"
[ -z "$OUT" ] && check "D6 channel: fd-dup 2>&1 is not a write" PASS || check "D6 channel: fd-dup 2>&1 is not a write (got '$OUT')" FAIL
OUT="$(detect 'git status && ls')"
[ -z "$OUT" ] && check "D7 channel: read-only command -> none" PASS || check "D7 channel: read-only command -> none" FAIL

# ── Hook-level cases on synthetic normalized payloads ─────────────────
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
printf '%s' '{"hooks":{}}'                     > "$TMPD/config-on.json"
printf '%s' '{"hooks":{"secretScan":false}}'   > "$TMPD/config-off.json"

write_payload() {
  T="$1" FP="$2" BODY="$3" node -e '
    const o = { hook_event_name: "PreToolUse", tool_name: process.env.T,
                tool_input: { file_path: process.env.FP, content: process.env.BODY },
                session_id: "secret-scan-test" };
    process.stdout.write(JSON.stringify(o));
  '
}
cmd_payload() {
  CMD="$1" CWD="$TMPD" node -e '
    const o = { hook_event_name: "PreToolUse", tool_name: "run_command",
                tool_input: { command: process.env.CMD }, cwd: process.env.CWD,
                session_id: "secret-scan-test" };
    process.stdout.write(JSON.stringify(o));
  '
}
classify() {
  node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      s=s.trim();
      if(!s){process.stdout.write("ALLOW");return;}
      try{const j=JSON.parse(s);const d=j.hookSpecificOutput&&j.hookSpecificOutput.permissionDecision;process.stdout.write(d==="deny"?"DENY":(d||"OTHER"));}
      catch(_){process.stdout.write("BADJSON");}
    });
  '
}
run_hook() {
  local script="$1" payload="$2" cfg="${3:-$TMPD/config-on.json}"
  printf '%s' "$payload" | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$TMPD" \
    ZENSU_CONFIG="$cfg" ZENSU_SECRET_SCAN= bash "$script" 2>/dev/null
}
expect() {
  local label="$1" out="$2" exp="$3"
  local got; got="$(printf '%s' "$out" | classify)"
  [ "$got" = "$exp" ] && check "$label -> $exp" PASS || check "$label (got '$got' want '$exp')" FAIL
}

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/app.ts 'const k = "AKIA''IOSFODNN7RGY4Q2B";')")"
expect "F1 write_to_file with AWS access key" "$OUT" DENY
case "$OUT" in *aws-access-key-id*zensu-secret-allow*) check "F1b deny reason names the rule + the remediation" PASS;; *) check "F1b deny reason names the rule + the remediation" FAIL;; esac

OUT="$(run_hook "$HOOK" "$(write_payload replace_file_content /x/src/n.go 't := "xox''b-1234567890-abcdefghij"')")"
expect "F2 replace_file_content with Slack token" "$OUT" DENY

OUT="$(run_hook "$HOOK" "$(write_payload multi_replace_file_content /x/src/pay.rb 'k = "sk_''live_abcdef1234567890XY"')")"
expect "F3 multi_replace_file_content with Stripe key" "$OUT" DENY

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/id_rsa.pem '-----BEGIN RSA PRIVATE KEY-----')")"
expect "F4 write_to_file with a PEM private key" "$OUT" DENY

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/docs/notes.md 'Plain documentation text, nothing secret in here at all.')")"
expect "F5 benign file content" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/cfg.py 'k = "AKIA''IOSFODNN7EXAMPLE"')")"
expect "F6 false-positive-prone placeholder token (EXAMPLE)" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/cfg.py 'cfg = "AKIA''IOSFODNN7RGY4Q2B" zensu-secret-allow')")"
expect "F7 inline zensu-secret-allow marker" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/tests/unit/aws.txt 'AKIA''IOSFODNN7RGY4Q2B')")"
expect "F8 tests/ path exemption" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/config.example.json 'AKIA''IOSFODNN7RGY4Q2B')")"
expect "F9 *.example.* filename exemption" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" "$(write_payload write_to_file /x/src/a.ts 'AKIA''IOSFODNN7RGY4Q2B')" "$TMPD/config-off.json")"
expect "F10 hooks.secretScan:false" "$OUT" ALLOW

OUT="$(printf '%s' "$(write_payload write_to_file /x/src/a.ts 'AKIA''IOSFODNN7RGY4Q2B')" \
  | env ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_CONFIG="$TMPD/config-on.json" \
    ZENSU_SECRET_SCAN=off bash "$HOOK" 2>/dev/null)"
expect "F11 ZENSU_SECRET_SCAN=off env bypass" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" 'this is not json at all')"
expect "F12 malformed payload fails open" "$OUT" ALLOW
OUT="$(run_hook "$HOOK" '')"
expect "F13 empty payload fails open" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" '{"tool_name":"read_file","tool_input":{"file_path":"/x/src/a.ts"}}')"
expect "F14 non-writer tool is not scanned" "$OUT" ALLOW

OUT="$(run_hook "$HOOK" '{"tool_name":"run_command","tool_input":{"command":"ZENSU_SECRET_SCAN=off printf x > a.env"}}')"
expect "F14b __bypass__ verdict is never denied as a rule name" "$OUT" ALLOW

# Scanner crash -> fail open (node shim that fails only for the decider).
mkdir -p "$TMPD/shim"
REAL_NODE="$(command -v node)"
{
  printf '#!/bin/bash\n'
  printf 'for a in "$@"; do case "$a" in *secret-scan-decide.js*) exit 1;; esac; done\n'
  printf 'exec %s "$@"\n' "$REAL_NODE"
} > "$TMPD/shim/node"
chmod +x "$TMPD/shim/node" 2>/dev/null
if [ -x "$TMPD/shim/node" ] && ! "$TMPD/shim/node" "$DECIDE" </dev/null >/dev/null 2>&1; then
  OUT="$(printf '%s' "$(write_payload write_to_file /x/src/a.ts 'AKIA''IOSFODNN7RGY4Q2B')" \
    | env PATH="$TMPD/shim:$PATH" ZENSU_PLUGIN_ROOT="$PLUGIN_DIR" ZENSU_PROJECT_DIR="$TMPD" \
      ZENSU_CONFIG="$TMPD/config-on.json" ZENSU_SECRET_SCAN= bash "$HOOK" 2>/dev/null)"
  expect "F15 scanner crash fails open" "$OUT" ALLOW
else
  check "F15 scanner crash fails open (shim not executable — skipped)" PASS
fi

# ── Raw-shell writes go through the source-write gate's second step ───
# The shell commands below are assembled inside DOUBLE quotes, where a '' split
# would stay literal and defuse the token — so the fragments are joined once
# here, in single-quoted assignments, and only the joined variable is embedded.
TOK_AWS='AKIA''IOSFODNN7RGY4Q2B'
TOK_GH='ghp_''123456789012345678901234567890123456'

HEREDOC="$(printf 'cat > %s/creds.env <<EOF\n%s\nEOF\n' "$TMPD" "$TOK_GH")"
OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "$HEREDOC")")"
expect "B1 raw heredoc write carrying a GitHub token" "$OUT" DENY
case "$OUT" in *github-token*) check "B1b bash deny reason names the rule" PASS;; *) check "B1b bash deny reason names the rule" FAIL;; esac

OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "printf '$TOK_AWS' > $TMPD/creds.env")")"
expect "B2 raw redirect carrying an AWS access key" "$OUT" DENY

OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "echo $TOK_GH")")"
expect "B3 no write channel -> not scanned" "$OUT" ALLOW

ESCAPED="$(printf 'ZENSU_SECRET_SCAN=off cat > %s/creds.env <<EOF\n%s\nEOF\n' "$TMPD" "$TOK_GH")"
OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "$ESCAPED")")"
expect "B4 inline ZENSU_SECRET_SCAN=off prefix" "$OUT" ALLOW

SMUGGLED="$(printf 'cat > %s/creds.env <<EOF\nZENSU_SECRET_SCAN=off is only the escape hatch\n%s\nEOF\n' "$TMPD" "$TOK_GH")"
OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "$SMUGGLED")")"
expect "B5 escape token smuggled inside the heredoc body" "$OUT" DENY

OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "printf 'plain notes' > $TMPD/notes.txt")")"
expect "B6 benign raw write" "$OUT" ALLOW

OUT="$(run_hook "$BASH_GATE" "$(cmd_payload "printf '$TOK_AWS' > $TMPD/creds.env")" "$TMPD/config-off.json")"
expect "B7 hooks.secretScan:false on the raw-shell path" "$OUT" ALLOW

# ── Shim normalize step actually carries the write body ───────────────
AG_PAYLOAD="$(BODY='const k = "AKIA''IOSFODNN7RGY4Q2B";' node -e '
  const o = { toolCall: { name: "write_to_file",
              args: { TargetFile: "/x/src/app.ts", CodeContent: process.env.BODY } },
              workspacePaths: ["/x"] };
  process.stdout.write(JSON.stringify(o));
')"
NORMALIZED="$(printf '%s' "$AG_PAYLOAD" | node "$NORMALIZE" 2>/dev/null | sed -n '2p')"
case "$NORMALIZED" in *'"content"'*) check "N1 normalize maps the writer body -> tool_input.content" PASS;; *) check "N1 normalize maps the writer body -> tool_input.content" FAIL;; esac
OUT="$(run_hook "$HOOK" "$NORMALIZED")"
expect "N2 normalized Antigravity writer payload end-to-end" "$OUT" DENY

finish
