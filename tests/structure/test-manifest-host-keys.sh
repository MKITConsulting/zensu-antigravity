#!/usr/bin/env bash
# The manifest may declare ONLY keys the Antigravity host actually consumes.
#
# This test exists because a whole class of defect was invisible to every other
# suite in this repo: `plugin.json` declared `rules` and `workflows` arrays, each
# entry pointed at a real file on disk, and the pairing/manifest tests happily
# confirmed the arrays and the filesystem agreed — while the host silently
# ignored both keys. `agy plugin validate` reports exactly five component
# categories (skills, agents, commands, mcpServers, hooks); anything else is
# dropped without a warning, so a shim under `workflows` produced no slash
# command. On agy1.4.2 the plugin-owned rules/AGENTS.md directory channel
# works independently of any manifest key; the unsupported rules array stays forbidden.
#
# Internal consistency is therefore NOT evidence that a key does anything. The
# allowlist below is the host's vocabulary plus the inert metadata fields, and it
# is the one assertion in the suite that would have caught the original bug.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M="$ROOT/plugin.json"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

[ -f "$M" ] || { bad "plugin.json missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
command -v node >/dev/null 2>&1 || { bad "node required"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }

# The host's vocabulary, verified against `agy plugin validate` on agy 1.1.10.
# It is NOT permanent: a host upgrade can add a key (this list then wrongly
# rejects a legitimate one) or RETIRE one (every suite here stays green while
# the components go inert again — the original failure mode, one release away).
# Re-verify on every agy upgrade; see docs/architecture.md "Verification status".
# Single source of truth — evals/promptfoo/scenarios/manifest.yaml reads this
# same file rather than repeating the list.
KEYFILE="$ROOT/tests/fixtures/host-manifest-keys.txt"
[ -f "$KEYFILE" ] || { bad "missing $KEYFILE (the shared host-key vocabulary)"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
COMPONENT_KEYS="$(awk '/^component /{printf "%s ", $2}' "$KEYFILE")"
METADATA_KEYS="$(awk '/^metadata /{printf "%s ", $2}' "$KEYFILE")"

# Fail CLOSED: a node crash, an unreadable file or a malformed manifest must
# not read as "no unknown keys". The sentinel proves the scan actually ran.
SCAN="$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const allowed = new Set((process.argv[2] + " " + process.argv[3]).split(" ").filter(Boolean));
  const unknown = Object.keys(m).filter((k) => !allowed.has(k));
  // No trailing space on the clean path: command substitution strips newlines,
  // not spaces, so "SCANNED " would never match the clean case.
  process.stdout.write(unknown.length ? "SCANNED " + unknown.join(" ") : "SCANNED");
' "$M" "$COMPONENT_KEYS" "$METADATA_KEYS" 2>/dev/null)"

case "$SCAN" in
  "SCANNED") ok "plugin.json declares only host-recognised keys (verified component vocabulary; rules directory discovery is separate)" ;;
  "SCANNED "*) bad "plugin.json declares key(s) the host ignores: ${SCAN#SCANNED }" ;;
  *) bad "the manifest key scan did not run (unparseable plugin.json or node failure)" ;;
esac

# The two keys that actually shipped inert — named explicitly so a regression
# reads as the specific historical mistake rather than a generic allowlist miss.
for dead in rules workflows; do
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.exit(Object.prototype.hasOwnProperty.call(m, process.argv[2]) ? 1 : 0);
  ' "$M" "$dead" 2>/dev/null \
    && ok "no inert .$dead[] key" \
    || bad ".$dead[] is back — the host ignores it, so whatever it lists does nothing"
  if [ "$dead" = rules ]; then
    [ -f "$ROOT/rules/AGENTS.md" ] && [ ! -L "$ROOT/rules/AGENTS.md" ] \
      && ok "native rules directory supplies its regular AGENTS.md without a manifest key" \
      || bad "native rules directory is missing its regular product policy"
  else
    [ -d "$ROOT/$dead" ] \
      && bad "$dead/ directory is back on disk" \
      || ok "no $dead/ directory on disk"
  fi
done

# Every declared component key must resolve to something on disk; a key that is
# recognised but empty is its own kind of lie.
for key in skills agents commands; do
  COUNT="$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = m[process.argv[2]];
    process.stdout.write(String(Array.isArray(v) ? v.length : 0));
  ' "$M" "$key" 2>/dev/null)"
  [ "${COUNT:-0}" -gt 0 ] \
    && ok ".$key[] declares $COUNT entr$([ "$COUNT" = 1 ] && echo y || echo ies)" \
    || bad ".$key[] is missing or empty"
done

# `hooks` is a string path in this manifest, not an array — pin the shape so a
# future edit cannot turn it into an ignored array form.
HOOKS_SHAPE="$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(typeof m.hooks);
' "$M" 2>/dev/null)"
[ "$HOOKS_SHAPE" = "string" ] \
  && ok "hooks is a string path ($HOOKS_SHAPE)" \
  || bad "hooks must be a string path, got $HOOKS_SHAPE"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
