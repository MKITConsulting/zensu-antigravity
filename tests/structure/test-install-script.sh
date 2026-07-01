#!/usr/bin/env bash
# install.sh contract, exercised in a SANDBOX HOME (the user's real ~/.gemini and
# ~/.zensu are never touched):
#   --dry-run        -> writes NOTHING (no plugin dirs, no ~/.zensu)
#   fresh install    -> stages the plugin subtree into BOTH dests (IDE + CLI),
#                       writes ~/.zensu/plugin-root, seeds ~/.zensu/config.json
#   generated hooks.json -> exists, parses, EVERY command is an ABSOLUTE path
#                       under the install root that resolves to an existing file,
#                       with ZERO __ZENSU_HOME__ / ${...} placeholders left (the
#                       core generation assertion)
#   staging scope    -> hooks/ is staged RECURSIVELY (antigravity/ + lib/);
#                       tests/, evals/, reference/, README/CHANGELOG/LICENSE/
#                       install.* are EXCLUDED
#   idempotency      -> second run is a NOOP (portable mtime via node)
#   user-edit guard  -> a user-modified staged file is SKIPped on every upgrade
#   --uninstall      -> removes only manifest-listed in-root files; refuses ../
#                       and out-of-root paths; ~/.zensu user data untouched
#   install.ps1      -> the two Windows literal pins (cannot run on Linux)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
mt() { node -e 'console.log(require("fs").statSync(process.argv[1]).mtimeMs)' "$1" 2>/dev/null; }

INSTALL="$ROOT/install.sh"
[ -f "$INSTALL" ] || { bad "install.sh missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
bash -n "$INSTALL" 2>/dev/null && ok "install.sh passes bash -n" || bad "install.sh syntax error"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"

IDE="$HOME/.gemini/config/plugins/zensu"
CLI="$HOME/.gemini/antigravity-cli/plugins/zensu"

# 1) --dry-run writes NOTHING
bash "$INSTALL" --dry-run >/dev/null 2>&1
[ -d "$IDE" ] && bad "dry-run created IDE plugin dir" || ok "dry-run: no IDE plugin dir"
[ -d "$CLI" ] && bad "dry-run created CLI plugin dir" || ok "dry-run: no CLI plugin dir"
[ -d "$HOME/.zensu" ] && bad "dry-run created ~/.zensu" || ok "dry-run: no ~/.zensu"

# 2) fresh install (both dests)
OUT="$(bash "$INSTALL" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "install exits 0" || { bad "install rc=$RC"; printf '%s\n' "$OUT" | tail -5; }
[ -f "$IDE/plugin.json" ] && ok "IDE dest has plugin.json" || bad "IDE plugin.json missing"
[ -f "$CLI/plugin.json" ] && ok "CLI dest has plugin.json" || bad "CLI plugin.json missing"
[ -f "$IDE/hooks/antigravity/antigravity-shim.sh" ] && ok "IDE has the shim (hooks/ staged recursively)" || bad "IDE shim missing"
[ -f "$IDE/hooks/lib/zensu-log.sh" ] && ok "IDE has hooks/lib (recursive stage)" || bad "IDE hooks/lib missing"
[ -f "$IDE/skills/tdd/SKILL.md" ] && ok "IDE has skills/" || bad "IDE skills missing"
[ -f "$IDE/rules/zensu-tdd.md" ] && ok "IDE has rules/" || bad "IDE rules missing"
[ -f "$IDE/workflows/zensu-tdd.md" ] && ok "IDE has workflows/" || bad "IDE workflows missing"
[ -f "$IDE/agents/zensu-plm.md" ] && ok "IDE has agents/" || bad "IDE agents missing"
[ "$(cat "$HOME/.zensu/plugin-root" 2>/dev/null)" = "$IDE" ] && ok "plugin-root pointer -> IDE dest" || bad "plugin-root wrong: $(cat "$HOME/.zensu/plugin-root" 2>/dev/null)"
[ -f "$HOME/.zensu/config.json" ] && ok "config.json seeded" || bad "config.json not seeded"
[ -f "$IDE/.zensu-install-manifest.tsv" ] && ok "IDE manifest (TSV) written" || bad "IDE manifest missing"

# 3) staging scope: meta/test dirs EXCLUDED from the staged tree
[ -d "$IDE/tests" ] && bad "tests/ wrongly staged into IDE dest" || ok "tests/ excluded from staging"
[ -d "$IDE/evals" ] && bad "evals/ wrongly staged" || ok "evals/ excluded from staging"
[ -f "$IDE/README.md" ] && bad "README.md wrongly staged" || ok "README.md excluded from staging"
[ -f "$IDE/install.sh" ] && bad "install.sh wrongly staged" || ok "install.sh excluded from staging"
[ -f "$IDE/config.example.json" ] && ok "config.example.json IS staged (runtime template)" || bad "config.example.json should be staged"

# 4) generated hooks.json: absolute paths, zero placeholders, all resolve
for DEST in "$IDE" "$CLI"; do
  HJ="$DEST/hooks.json"
  [ -f "$HJ" ] && ok "$(basename "$(dirname "$DEST")")/.../hooks.json generated" || { bad "hooks.json missing in $DEST"; continue; }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$HJ" 2>/dev/null \
    && ok "generated hooks.json parses ($(basename "$(dirname "$DEST")"))" || bad "generated hooks.json invalid JSON ($DEST)"
  grep -q '__ZENSU_HOME__' "$HJ" && bad "hooks.json has __ZENSU_HOME__ leftover ($DEST)" || ok "hooks.json: zero __ZENSU_HOME__ placeholders ($(basename "$(dirname "$DEST")"))"
  grep -qE '\$\{[A-Za-z_]+\}' "$HJ" && bad "hooks.json has \${VAR} leftover ($DEST)" || ok "hooks.json: zero \${VAR} placeholders ($(basename "$(dirname "$DEST")"))"
  # every command's shim path is ABSOLUTE under IDE and exists on disk; bare $1.
  ABS_OK="$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const fs = require("fs");
    let total=0, absOk=0, fileOk=0, bareOk=0;
    const re = /^bash\s+(\/\S+\/antigravity-shim\.sh)\s+(\S+)\s*$/;
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === "object") {
        if (typeof o.command === "string") {
          total++;
          const m = o.command.match(re);
          if (m) {
            const shim = m[1], arg = m[2];
            if (shim.startsWith("/")) absOk++;
            if (fs.existsSync(shim)) fileOk++;
            if (!arg.includes("/")) bareOk++;
          }
        }
        Object.values(o).forEach(walk);
      }
    };
    walk(j);
    process.stdout.write([total, absOk, fileOk, bareOk].join(" "));
  ' "$HJ" 2>/dev/null)"
  read -r T A F B <<EOF
$ABS_OK
EOF
  { [ "$T" -gt 0 ] && [ "$T" = "$A" ]; } && ok "every command shim path is ABSOLUTE ($(basename "$(dirname "$DEST")"): $A/$T)" || bad "non-absolute shim path ($A/$T)"
  { [ "$T" = "$F" ]; } && ok "every command shim path resolves to an existing file ($F/$T)" || bad "a shim path does not exist on disk ($F/$T)"
  { [ "$T" = "$B" ]; } && ok "every wrapped \$1 stays a BARE name in the generated file ($B/$T)" || bad "a wrapped \$1 has a slash ($B/$T)"
done

# CLI hooks.json commands point at the SINGLE IDE runtime (ZENSU_HOME = IDE dest)
if grep -q "$IDE/hooks/antigravity/antigravity-shim.sh" "$CLI/hooks.json"; then
  ok "CLI hooks.json commands point at the single IDE runtime (ZENSU_HOME)"
else
  bad "CLI hooks.json does not reference the IDE runtime"
fi

# 5) idempotency: re-run -> NOOP (portable mtime)
M1="$(mt "$IDE/plugin.json")"
sleep 1
bash "$INSTALL" >/dev/null 2>&1
M2="$(mt "$IDE/plugin.json")"
[ "$M1" = "$M2" ] && ok "re-run is NOOP (mtime stable)" || bad "re-run rewrote files"

# 6) user-modified file SKIPped, survives a FURTHER upgrade
EDIT="$IDE/skills/zensu-help/SKILL.md"
[ -f "$EDIT" ] || EDIT="$IDE/skills/tdd/SKILL.md"
printf '\n# user tweak\n' >> "$EDIT"
S1="$(shasum "$EDIT" | cut -d' ' -f1 2>/dev/null || sha256sum "$EDIT" | cut -d' ' -f1)"
OUT="$(bash "$INSTALL" 2>&1)"
printf '%s' "$OUT" | grep -qi "skip" && ok "user-modified file SKIP warned (1st upgrade)" || bad "no SKIP warning (1st upgrade)"
bash "$INSTALL" >/dev/null 2>&1
S2="$(shasum "$EDIT" | cut -d' ' -f1 2>/dev/null || sha256sum "$EDIT" | cut -d' ' -f1)"
[ "$S1" = "$S2" ] && ok "user-modified file preserved across TWO upgrades (guard survives manifest rewrite)" || bad "guard lost after manifest rewrite"

# 7) uninstall removes only in-root manifest files; ~/.zensu untouched
bash "$INSTALL" --uninstall --force >/dev/null 2>&1
[ -f "$IDE/plugin.json" ] && bad "IDE survived uninstall" || ok "IDE removed by uninstall"
[ -f "$CLI/plugin.json" ] && bad "CLI survived uninstall" || ok "CLI removed by uninstall"
[ -f "$HOME/.zensu/config.json" ] && ok "uninstall kept ~/.zensu/config.json (user data)" || bad "uninstall deleted user config"

# 8) path-traversal + out-of-root entries refused on uninstall
bash "$INSTALL" >/dev/null 2>&1
SENTINEL="$HOME/precious.txt"; printf 'keep me\n' > "$SENTINEL"
MAN="$IDE/.zensu-install-manifest.tsv"
ZHASH="$(printf '0%.0s' $(seq 1 64))"
printf '%s\t%s\n' "../../../precious.txt" "$ZHASH" >> "$MAN"
printf '%s\t%s\n' "$SENTINEL" "$ZHASH" >> "$MAN"
UOUT="$(bash "$INSTALL" --uninstall --force 2>&1)"
[ -f "$SENTINEL" ] && ok "uninstall refuses out-of-root + ../ entries (sentinel intact)" || bad "uninstall deleted an out-of-root file"
printf '%s' "$UOUT" | grep -qF "REFUSE" && ok "uninstall logs REFUSE for the tampered entries" || bad "no REFUSE for tampered manifest"

# 8b) sibling-prefix collision: $HOME/.gemini/config/plugins/zensu-evil refused
bash "$INSTALL" >/dev/null 2>&1
EVIL_DIR="$HOME/.gemini/config/plugins/zensu-evil"
mkdir -p "$EVIL_DIR"; printf 'owned\n' > "$EVIL_DIR/owned.txt"
printf '%s\t%s\n' "$EVIL_DIR/owned.txt" "$ZHASH" >> "$IDE/.zensu-install-manifest.tsv"
bash "$INSTALL" --uninstall --force >/dev/null 2>&1
[ -f "$EVIL_DIR/owned.txt" ] && ok "sibling-prefix path refused (zensu-evil intact)" || bad "uninstall deleted under zensu-evil sibling"

# 9) --target ide / cli select only one dest
rm -rf "$HOME/.gemini" "$HOME/.zensu"
bash "$INSTALL" --target ide >/dev/null 2>&1
{ [ -f "$IDE/plugin.json" ] && [ ! -f "$CLI/plugin.json" ]; } && ok "--target ide stages only the IDE dest" || bad "--target ide scope wrong"
rm -rf "$HOME/.gemini" "$HOME/.zensu"
bash "$INSTALL" --target cli >/dev/null 2>&1
{ [ -f "$CLI/plugin.json" ] && [ ! -f "$IDE/plugin.json" ]; } && ok "--target cli stages only the CLI dest" || bad "--target cli scope wrong"

# 10) install.ps1 literal pins (cannot run on the Linux runner)
PS1="$ROOT/install.ps1"
if [ -f "$PS1" ]; then
  grep -q 'env:ProgramFiles(x86)}' "$PS1" && ok "install.ps1 uses \${env:ProgramFiles(x86)} brace form" || bad "install.ps1 ProgramFiles(x86) interpolation broken"
  grep -q "notmatch '..Windows..(System32|Sysnative)" "$PS1" && ok "install.ps1 excludes WSL System32/Sysnative bash" || bad "install.ps1 lacks the -notmatch System32/Sysnative filter"
else
  bad "install.ps1 missing"
fi

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
