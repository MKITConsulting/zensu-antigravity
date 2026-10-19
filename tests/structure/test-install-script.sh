#!/usr/bin/env bash
# install.sh contract.
#
# The host owns the installed tree: `agy plugin install <dir>` copies the given
# directory into its plugin root and registers what it finds. install.sh's job is
# to produce a CURATED tree outside that root, render hooks.json against the
# final destination (the importer expands nothing), and hand it over.
#
# HERMETIC BY CONSTRUCTION: `HOME` is redirected into a temp dir AND a stub `agy`
# is prepended to `PATH`. Relying on the HOME redirect alone was not enough — the
# uninstall path reaches `agy plugin uninstall`, and whether the real host scopes
# its registry to HOME is exactly the kind of behaviour this repo now refuses to
# assume. The stub also makes the install path testable end to end: it records
# its argv, so the effects install.sh produces can be pinned instead of inferred.
set -u

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL="$PLUGIN_DIR/install.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

[ -f "$INSTALL" ] || { bad "install.sh missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
# Sibling suites hard-require node; a soft skip here would drop the strongest
# assertions while the suite still reported green.
command -v node >/dev/null 2>&1 || { bad "node required"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
bash -n "$INSTALL" 2>/dev/null && ok "install.sh passes bash -n" || bad "install.sh fails bash -n"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAKE_HOME="$TMP/home"; mkdir -p "$FAKE_HOME"
BIN="$TMP/bin"; mkdir -p "$BIN"
AGY_LOG="$TMP/agy.log"
USER_WORKSPACE="$TMP/user-workspace"; mkdir -p "$USER_WORKSPACE"
printf "User-owned workspace policy\n" > "$USER_WORKSPACE/AGENTS.md"
cp "$USER_WORKSPACE/AGENTS.md" "$TMP/workspace-policy.expected"

# Stub host: records argv, and materialises the destination on `plugin install`
# the way the real importer would, so the post-import assertions are exercised.
cat > "$BIN/agy" <<'STUB'
#!/usr/bin/env bash
[ -n "${ZENSU_TEST_HOME:-}" ] && [ "$HOME" = "$ZENSU_TEST_HOME" ] \
  || { echo "stub agy refuses: HOME is not the test home" >&2; exit 90; }
printf '%s\n' "$*" >> "$AGY_LOG"
case "$1 $2" in
  "plugin install")
    # MERGE, do not replace: install.sh clears $DEST itself precisely because the
    # host importer copies INTO an existing destination. A clearing stub would
    # make that assertion pass even with install.sh's own cleanup deleted.
    dest="$HOME/.gemini/config/plugins/zensu"
    mkdir -p "$dest"
    cp -R "$3"/. "$dest"/
    ;;
  "plugin validate") ;;
  "plugin uninstall") ;;
esac
exit 0
STUB
chmod +x "$BIN/agy"
run_install() { (cd "$USER_WORKSPACE" && HOME="$FAKE_HOME" ZENSU_TEST_HOME="$FAKE_HOME" AGY_LOG="$AGY_LOG" PATH="$BIN:$PATH" bash "$INSTALL" "$@"); }

# --- dry run writes nothing --------------------------------------------------
run_install --dry-run >"$TMP/dry.out" 2>&1
[ "$?" = "0" ] && ok "dry-run exits 0" || bad "dry-run exited non-zero"
[ -d "$FAKE_HOME/.gemini" ] && bad "dry-run created a plugin dir" || ok "dry-run: no plugin dir"
[ -d "$FAKE_HOME/.zensu" ] && bad "dry-run created ~/.zensu" || ok "dry-run: no ~/.zensu"
[ -s "$AGY_LOG" ] && bad "dry-run invoked the host" || ok "dry-run: host never invoked"
for marker in RENDER IMPORT CLEAR WRITE SEED; do
  grep -q "$marker" "$TMP/dry.out" && ok "dry-run announces $marker" || bad "dry-run hides the $marker step"
done

# --- argument contract -------------------------------------------------------
run_install --stage-only >"$TMP/a1.out" 2>&1
[ "$?" != "0" ] && ok "--stage-only without a value is refused" || bad "--stage-only without a value fell through to a real install"
run_install --stage-only --dry-run >"$TMP/a2.out" 2>&1
[ "$?" != "0" ] && ok "--stage-only does not swallow the next flag" || bad "--stage-only swallowed the following flag"
run_install --stage-only "" >"$TMP/a1b.out" 2>&1
[ "$?" != "0" ] && ok "--stage-only with an empty value is refused" || bad "--stage-only '' fell through to a real install"
run_install --bogus >"$TMP/a3.out" 2>&1
[ "$?" = "2" ] && ok "unknown argument exits 2" || bad "unknown argument did not exit 2"
run_install --help >"$TMP/a4.out" 2>&1
grep -q 'set -u' "$TMP/a4.out" && bad "--help spills past the usage block" || ok "--help prints only the usage block"

# A destination the host shell would split (or that breaks JSON) must be refused
# BEFORE anything is written: the rendered command is unquoted, so a single space
# silently reduces all 8 hooks to nothing while every other check still passes.
for badhome in "$TMP/has space" "$TMP/has\"quote"; do
  mkdir -p "$badhome"
  HOME="$badhome" ZENSU_TEST_HOME="$badhome" AGY_LOG="$AGY_LOG" PATH="$BIN:$PATH" \
    bash "$INSTALL" --stage-only "$TMP/badstage" >"$TMP/badhome.out" 2>&1
  [ "$?" != "0" ] && ok "refuses an unsafe destination ($(basename "$badhome"))" \
    || bad "accepted an unsafe destination ($(basename "$badhome")) — hooks would silently die"
  rm -rf "$badhome" "$TMP/badstage"
done

# --- self-destruction guard, BOTH plugin roots -------------------------------
for parent in ".gemini/config/plugins" ".gemini/antigravity-cli/plugins"; do
  EVIL="$FAKE_HOME/$parent/zensu"
  mkdir -p "$EVIL"
  cp "$INSTALL" "$EVIL/install.sh"
  HOME="$FAKE_HOME" ZENSU_TEST_HOME="$FAKE_HOME" AGY_LOG="$AGY_LOG" PATH="$BIN:$PATH" bash "$EVIL/install.sh" --dry-run >"$TMP/guard.out" 2>&1
  [ "$?" != "0" ] && ok "refuses to install from inside $parent" || bad "installed from inside $parent — this truncates the plugin"
  grep -qi 'inside the host plugin root' "$TMP/guard.out" && ok "guard explains the refusal ($parent)" || bad "guard gives no reason ($parent)"
done
# The stage target is guarded too — it used to be deleted unchecked.
run_install --stage-only "$FAKE_HOME/.gemini/config/plugins" >"$TMP/guard2.out" 2>&1
[ "$?" != "0" ] && ok "refuses a --stage-only target inside a plugin root" || bad "staged into a plugin root — rm -rf would destroy the live install"
[ -d "$FAKE_HOME/.gemini/config/plugins/zensu" ] && ok "the live plugin dir survived the refused stage" || bad "the refused stage still deleted the plugin dir"
# --stage-only must honour --dry-run rather than writing.
rm -rf "$TMP/preview"
run_install --dry-run --stage-only "$TMP/preview" >/dev/null 2>&1
[ -d "$TMP/preview" ] && bad "--dry-run --stage-only wrote to disk" || ok "--dry-run --stage-only writes nothing"
rm -rf "$FAKE_HOME/.gemini"

# --- curated stage -----------------------------------------------------------
run_install --stage-only "$TMP/stage" >"$TMP/stage.out" 2>&1
[ "$?" = "0" ] && ok "--stage-only exits 0" || { bad "--stage-only failed"; head -5 "$TMP/stage.out"; }
S="$TMP/stage/zensu"

# Pin the STAGE LIST itself rather than eight of its complements: a denylist
# rewrite would silently pass a per-entry exclusion check.
STAGED="$(cd "$S" && LC_ALL=C ls -A | LC_ALL=C sort | tr '\n' ' ')"
EXPECT_STAGED="CHANGELOG.md LICENSE README.md agents commands config.example.json docs harness hooks hooks.json plugin.json rules scripts skills templates "
[ "$STAGED" = "$EXPECT_STAGED" ] && ok "staged tree is exactly the curated set" || bad "staged tree differs: got [$STAGED]"
[ -e "$S/hooks/antigravity/antigravity-shim.sh" ] && ok "hooks/ staged recursively (antigravity/)" || bad "hooks/antigravity missing"
[ -d "$S/hooks/lib" ] && ok "hooks/ staged recursively (lib/)" || bad "hooks/lib missing"
# Runtime-referenced docs must ship: skills/docs and agents/zensu-plm read
# docs/documentation-guide.md by path, and zensu-help routes topics to README.
[ -f "$S/docs/documentation-guide.md" ] && ok "docs/documentation-guide.md ships (skills read it by path)" || bad "docs/documentation-guide.md missing from the stage"
cmp -s "$PLUGIN_DIR/rules/AGENTS.md" "$S/rules/AGENTS.md" \
  && ok "plugin-owned always-on policy ships byte-exact in rules/AGENTS.md" || bad "native rules policy missing or changed in stage"
[ -e "$S/AGENTS.md" ] && bad "staged repository development instructions as product rules" || ok "repository development AGENTS.md is not staged"
[ -d "$S/workflows" ] && bad "staged an inert workflows/ directory" || ok "no inert workflows/ in the staged tree"

# The copied package must initialize and use its own canonical engine with no
# source-host installation, repository path, or inherited plugin selectors.
HOME="$FAKE_HOME" node - "$S" "$TMP" <<'NODE' >"$TMP/standalone.out" 2>&1
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict');
const root = fs.realpathSync(process.argv[2]), tmp = fs.realpathSync(process.argv[3]);
const project = path.join(tmp, 'standalone-project'), data = path.join(tmp, 'standalone-data');
for (const dir of [project, data]) fs.mkdirSync(dir, { mode: 0o700 });
assert.equal(fs.existsSync(path.join(process.env.HOME, '.claude')), false);
const bootstrap = require(path.join(root, 'hooks/antigravity/session-bootstrap.js'));
const helpers = require(path.join(root, 'hooks/antigravity/session-helper.js'));
const result = bootstrap.bootstrap({session_id:'standalone-install',workspace_root:project}, {pluginRoot:root,pluginData:data});
assert.equal(result.created, true);
const environment = helpers.helperEnvironment({sessionId:'standalone-install',helper:'log'}, {
  pluginRoot:root, pluginData:data, environment:{PATH:process.env.PATH,HOME:process.env.HOME}
});
const status = cp.spawnSync('bash', [path.join(root,'hooks/lib/zensu-log.sh'),'--chain-status'], {
  cwd:project,env:environment,encoding:'utf8',timeout:30000
});
assert.equal(status.status, 0, status.stderr);
assert.ok(status.stdout.trim(), 'the standalone engine must return actual state');
for (const [, relative] of Object.values(helpers.HELPERS)) assert.ok(fs.statSync(path.join(root,relative)).isFile());
assert.equal(Object.hasOwn(helpers.HELPERS,'review-in-thread'), false);
NODE
[ "$?" = "0" ] && ok "relocated package initializes and reads canonical state without a source-host installation" \
  || { bad "standalone package smoke failed"; cat "$TMP/standalone.out"; }

# --- rendered hooks.json -----------------------------------------------------
grep -q '__ZENSU_HOME__' "$S/hooks.json" \
  && bad "hooks.json still carries __ZENSU_HOME__ placeholders" || ok "hooks.json: zero __ZENSU_HOME__ placeholders"
grep -qE '\$\{[A-Za-z_]' "$S/hooks.json" \
  && bad "hooks.json carries \${VAR} placeholders the host will not expand" || ok "hooks.json: zero \${VAR} placeholders"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$S/hooks.json" 2>/dev/null \
  && ok "hooks.json parses" || bad "hooks.json is not valid JSON"

# EVERY command is counted — a `continue` past non-matching entries would compare
# a self-selected population against itself. The shim path and the wrapped
# script's existence are pinned again, as the pre-rewrite suite did.
node -e '
  const fs = require("fs"), path = require("path");
  const t = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const dest = process.argv[2], stage = process.argv[3];
  let total = 0, bad = [];
  const EVENTS = new Set(["PreToolUse","PostToolUse","PreInvocation","PostInvocation","Stop"]);
  // A handler sits EITHER inside a {matcher,hooks[]} wrapper (tool-scoped events)
  // OR directly in the event array (PreInvocation/PostInvocation/Stop). Walking
  // only `entry.hooks` would silently skip every flat handler and report a
  // clean install for a hooks.json whose flat commands were never rendered.
  const check = (event, h) => {
    total += 1;
    const cmd = String((h && h.command) || "");
    const m = cmd.match(/^bash (\S+antigravity-shim\.sh) (\S+) (\S+)$/);
    if (!m) { bad.push("shape:" + cmd); return; }
    if (!path.isAbsolute(m[1])) bad.push("relative:" + m[1]);
    if (!m[1].startsWith(dest + "/")) bad.push("not-at-dest:" + m[1]);
    if (m[1].startsWith(stage + "/")) bad.push("stage-leak:" + m[1]);
    if (m[2].includes("/")) bad.push("not-bare:" + m[2]);
    const resolved = require("child_process").spawnSync("bash", [path.join(stage,"hooks/antigravity/antigravity-shim.sh"), "--list-handlers", m[2], "Bash"], {encoding:"utf8"});
    const scripts = String(resolved.stdout||"").trim().split("\n").filter(Boolean);
    if(resolved.status !== 0 || !scripts.length) bad.push("unresolved-chain:"+m[2]);
    for(const script of scripts) if(!fs.existsSync(path.join(stage,"hooks",script))) bad.push("missing-script:"+script);
    if (!EVENTS.has(m[3])) bad.push("bad-event:" + m[3]);
    if (m[3] !== event) bad.push("event-mismatch:" + event + "!=" + m[3]);
  };
  for (const group of Object.values(t))
    for (const [event, arr] of Object.entries(group || {})) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (Array.isArray(entry && entry.hooks)) entry.hooks.forEach(h => check(event, h));
        else check(event, entry);
      }
    }
  process.stdout.write(total + "|" + bad.join(","));
' "$S/hooks.json" "$FAKE_HOME/.gemini/config/plugins/zensu" "$S" > "$TMP/hookstats" 2>/dev/null
IFS='|' read -r TOTAL BADLIST < "$TMP/hookstats"
[ "${TOTAL:-0}" -gt 0 ] && ok "hooks.json declares $TOTAL wrapped command(s)" || bad "hooks.json declares no wrapped command"
[ -z "${BADLIST:-}" ] && ok "every wrapped command is an absolute shim path at the destination with a bare, existing script" \
  || bad "malformed wrapped command(s): $BADLIST"

# --- full install: pin the effects -------------------------------------------
: > "$AGY_LOG"
run_install >"$TMP/install.out" 2>&1
[ "$?" = "0" ] && ok "install exits 0" || { bad "install failed"; tail -5 "$TMP/install.out"; }
D="$FAKE_HOME/.gemini/config/plugins/zensu"
[ -f "$D/plugin.json" ] && ok "the host received the tree (plugin.json at the destination)" || bad "destination has no plugin.json"
grep -q '^plugin install ' "$AGY_LOG" && ok "install delegated to 'agy plugin install'" || bad "the host importer was never invoked"
grep -q '^plugin validate ' "$AGY_LOG" && ok "install verifies with 'agy plugin validate'" || bad "the install was never validated"
IMPORTED="$(awk '/^plugin install /{print $3}' "$AGY_LOG" | tail -1)"
case "$IMPORTED" in
  "$D"|"$D"/*) bad "imported FROM the destination — source==destination truncates the plugin" ;;
  *) ok "imported from a staging path outside the plugin root" ;;
esac
[ "$(cat "$FAKE_HOME/.zensu/antigravity/plugin-root" 2>/dev/null)" = "$D" ] \
  && ok "plugin-root pointer contains the destination" || bad "plugin-root pointer wrong or missing"
[ -f "$FAKE_HOME/.zensu/config.json" ] && ok "config.json seeded on a fresh install" || bad "config.json was not seeded"

# An upgrade must not leave the previous layout behind.
mkdir -p "$D/workflows" "$D/rules"
printf "obsolete policy\n" > "$D/rules/obsolete.md"
run_install >/dev/null 2>&1
{ [ ! -d "$D/workflows" ] && [ ! -e "$D/rules/obsolete.md" ] && cmp -s "$PLUGIN_DIR/rules/AGENTS.md" "$D/rules/AGENTS.md"; } \
  && ok "re-install removes obsolete rules while preserving the current native policy" || bad "an upgrade kept obsolete files or lost the native policy"

# A user-edited config survives an upgrade.
printf '{"hooks":{"autoTdd":false}}\n' > "$FAKE_HOME/.zensu/config.json"
run_install >/dev/null 2>&1
grep -q '"autoTdd":false' "$FAKE_HOME/.zensu/config.json" \
  && ok "an existing user config survives a re-install" || bad "re-install overwrote the user's config.json"

cmp -s "$USER_WORKSPACE/AGENTS.md" "$TMP/workspace-policy.expected" \
  && ok "install and upgrade preserve the user workspace AGENTS.md" || bad "installer changed user workspace policy"

# --- uninstall ---------------------------------------------------------------
mkdir -p "$FAKE_HOME/.gemini/antigravity-cli/plugins/zensu"
run_install --uninstall >"$TMP/uninstall.out" 2>&1
[ -d "$D" ] && bad "uninstall left the installed tree" || ok "uninstall removes the installed tree"
[ -d "$FAKE_HOME/.gemini/antigravity-cli/plugins/zensu" ] \
  && bad "uninstall left the previous installer's CLI copy" || ok "uninstall removes the legacy CLI copy"
[ -f "$FAKE_HOME/.zensu/antigravity/plugin-root" ] && bad "uninstall left the plugin-root pointer" || ok "uninstall removes the plugin-root pointer"
[ -f "$FAKE_HOME/.zensu/config.json" ] && ok "uninstall keeps ~/.zensu/config.json (user data)" || bad "uninstall deleted the user's config.json"
grep -q '^plugin uninstall zensu' "$AGY_LOG" && ok "uninstall deregisters with the host" || bad "the host was never asked to deregister"

# --- the installer refuses to pretend without the host -----------------------
# PATH scrubbed of agy (the stub AND any real one) — this asserts the refusal,
# not the developer's environment.
HOME="$FAKE_HOME" PATH="/usr/bin:/bin" bash "$INSTALL" >"$TMP/noagy.out" 2>&1
[ "$?" != "0" ] && ok "install refuses when the agy CLI is absent" || bad "install proceeded without the host — nothing would be registered"
grep -qi 'not on PATH' "$TMP/noagy.out" && ok "the refusal names the missing host CLI" || bad "the refusal does not explain that agy is missing"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
