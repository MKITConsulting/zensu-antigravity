#!/usr/bin/env bash
# zensu-antigravity installer.
#
# The host owns the installed tree. `agy plugin install <dir>` COPIES the given
# directory into its own plugin root and registers the components it finds; it
# does not render templates and it does not filter anything out. Three facts
# follow, and this script is built around them:
#
#   1. Hand-placing files inside the host's plugin directory does NOT register
#      the plugin — `agy plugin list` stays empty and no command exists.
#   2. Pointing the importer at a directory INSIDE the host's plugin root makes
#      source and destination the same path, and the copy truncates the plugin's
#      own files to zero bytes. There is no guard on the host side, so there is
#      one here — applied to every path this script would write to.
#   3. Importing the repository directly would copy `node_modules/`, `tests/`,
#      `evals/` and the local `.zensu/` runtime state into the plugin.
#
# So: build a CURATED staging tree outside the plugin root, render hooks.json
# into it with the FINAL destination baked in, then hand it to the host importer.
# Portable staging instead uses relative commands: agy executes each command in
# the directory containing hooks.json (verified on 1.4.2).
#
# Usage:
#   install.sh [--dry-run] [--uninstall] [--stage-only <dir>]
#   install.sh --portable-stage-only <dir> [--dry-run]
#
# ~/.zensu user data (config.json) is never removed by --uninstall.

set -u

PLUGIN_NAME="zensu"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEST="$HOME/.gemini/config/plugins/$PLUGIN_NAME"
# The previous installer staged into this second root by default, so an upgrade
# has to clean it even though the current design never writes there.
LEGACY_CLI_DEST="$HOME/.gemini/antigravity-cli/plugins/$PLUGIN_NAME"
ZENSU_HOME_DIR="$HOME/.zensu"
ZENSU_HOST_HOME_DIR="$ZENSU_HOME_DIR/antigravity"
PLUGIN_PARENTS=("$HOME/.gemini/config/plugins" "$HOME/.gemini/antigravity-cli/plugins")

DRY=0; UNINSTALL=0; STAGE_ONLY=""; STAGE_ONLY_SET=0; PORTABLE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY=1 ;;
    --uninstall)  UNINSTALL=1 ;;
    --stage-only|--portable-stage-only)
      # A missing value used to fall through to a REAL install, and a following
      # flag was swallowed as the directory name.
      [ "$STAGE_ONLY_SET" -eq 0 ] || { echo "install.sh: choose one staging mode" >&2; exit 2; }
      [ "$#" -ge 2 ] || { echo "install.sh: $1 needs a directory" >&2; exit 2; }
      [ -n "$2" ] || { echo "install.sh: $1 needs a NON-EMPTY directory" >&2; exit 2; }
      case "$2" in -*) echo "install.sh: $1 needs a directory, got '$2'" >&2; exit 2 ;; esac
      [ "$1" != "--portable-stage-only" ] || PORTABLE=1
      shift; STAGE_ONLY="$1"; STAGE_ONLY_SET=1
      ;;
    -h|--help)    sed -n '2,/^set -u/{ /^set -u/d; p; }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "install.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done
[ "$STAGE_ONLY_SET" -eq 0 ] || [ "$UNINSTALL" -eq 0 ] \
  || { echo "install.sh: staging cannot be combined with --uninstall" >&2; exit 2; }
HOOK_ROOT="$DEST"
[ "$PORTABLE" -eq 0 ] || HOOK_ROOT="."

say()  { printf '%s\n' "$*"; }
step() { printf '%-8s %s\n' "$1" "$2"; }
die()  { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

# --- Guard: never write to (or import from) the host's plugin root -----------
# The hazard is not only "source == destination": any path this script deletes
# or builds inside a plugin root can clobber a live installation.
guard_plugin_root() { # $1 = candidate path, $2 = what it is used for
  local candidate="$1" role="$2" resolved
  require_node
  # Resolve both sides even on a fresh machine whose host roots do not exist.
  # Resolve existing symlinks before normalizing the missing path suffix.
  resolved="$(node - "$candidate" "${PLUGIN_PARENTS[@]}" <<'JS'
const fs = require('node:fs'), path = require('node:path');
function proposed(input) {
  let probe = path.isAbsolute(input) ? input : `${process.cwd()}/${input}`;
  const tail = [];
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) throw Error('Cannot resolve path');
    tail.unshift(path.basename(probe)); probe = parent;
  }
  return path.resolve(fs.realpathSync(probe), ...tail);
}
const candidate = proposed(process.argv[2]);
for (const parent of process.argv.slice(3)) {
  const root = proposed(parent);
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    process.stdout.write(parent); break;
  }
}
JS
)" || die "cannot safely resolve the $role"
  if [ -n "$resolved" ]; then
    die "refusing to use '$candidate' as the $role: it is inside the host plugin root ($resolved).
     The host copies a plugin directory onto itself there, truncating the plugin's own files.
     Run install.sh from the repository checkout and stage somewhere outside that root."
  fi
}

# --- Curated stage -----------------------------------------------------------
# Only what the plugin needs at runtime. `tests/`, `evals/`, `node_modules/` and
# the local `.zensu/` state stay out. `docs/`, `README.md`, `CHANGELOG.md` and
# `LICENSE` DO ship: several skills and the plm agent read them by path at
# runtime (skills/docs and agents/zensu-plm require docs/documentation-guide.md;
# skills/zensu-help routes topics to README.md and docs/architecture.md), so
# excluding them would leave documented prerequisites unreachable once installed.
STAGE_ENTRIES="plugin.json config.example.json skills agents rules templates hooks docs scripts harness README.md CHANGELOG.md LICENSE"

require_node() {
  command -v node >/dev/null 2>&1 \
    || die "node is required to render and validate hooks.json"
}

build_stage() { # $1 = stage root; sets STAGE (no subshell: `die` must reach the caller)
  require_node
  local stage_root="$1" entry
  STAGE="$stage_root/$PLUGIN_NAME"
  guard_plugin_root "$STAGE" "staging directory"
  rm -rf -- "$STAGE"
  mkdir -p -- "$STAGE" || die "cannot create staging dir '$STAGE'"
  for entry in $STAGE_ENTRIES; do
    if [ "$PORTABLE" -eq 1 ]; then
      [ -e "$SRC/$entry" ] || die "portable package is missing required entry '$entry'"
      [ -z "$(find "$SRC/$entry" -type l -print)" ] \
        || die "portable package cannot contain symbolic links: $entry"
    fi
    [ -e "$SRC/$entry" ] || continue
    cp -R "$SRC/$entry" "$STAGE/" || die "staging failed for '$entry'"
  done
  # hooks.json carries absolute command paths and the host expands nothing, so
  # render it against the FINAL destination, not against the staging path.
  [ -f "$SRC/hooks.json.template" ] || die "hooks.json.template is missing — the staged plugin would declare hooks that do not exist"
  render_hooks_json "$SRC/hooks.json.template" "$STAGE/hooks.json"
}

render_hooks_json() { # $1 = template, $2 = output
  # The output becomes the command strings the host EXECUTES on every tool call,
  # so the substitution must be LITERAL. Neither `sed` nor `awk` gives that: sed
  # interprets the delimiter, `&` and `\` in its replacement, and awk's `gsub`
  # replacement expands `&` to the matched text — swapping one for the other only
  # changes which character bites (a destination containing `&` came out with
  # `__ZENSU_HOME__` re-inserted). node is already a hard requirement here, and
  # split/join has no metacharacter semantics at all.
  #
  # The rendered value lands mid-word in an UNQUOTED command string that the host
  # shell-splits: `bash <DEST>/hooks/antigravity/antigravity-shim.sh <script>.sh`.
  # A denylist of JSON metacharacters is the wrong shape for that consumer — a
  # plain SPACE is enough to split the path so all 8 hooks resolve to nothing
  # while JSON.parse and `agy plugin validate` both still pass. An allowlist
  # covers the JSON, shell and control-character cases in one rule.
  case "$HOOK_ROOT" in
    *[!A-Za-z0-9/._-]*)
      die "the install destination contains a character that cannot be embedded safely in a
     hook command string: $DEST
     Only letters, digits and / . _ - are safe here, because the host shell-splits the
     rendered command. Install under a path without spaces or punctuation." ;;
  esac
  ZENSU_RENDER_ROOT="$HOOK_ROOT" node -e '
    const fs = require("fs");
    const out = fs.readFileSync(process.argv[1], "utf8").split("__ZENSU_HOME__").join(process.env.ZENSU_RENDER_ROOT);
    fs.writeFileSync(process.argv[2], out);
  ' "$1" "$2" || die "rendering hooks.json failed"
}

verify_stage() { # $1 = staged plugin dir
  local stage="$1" script
  [ -f "$stage/plugin.json" ] || die "staged tree has no plugin.json"
  [ -f "$stage/rules/AGENTS.md" ] && [ ! -L "$stage/rules/AGENTS.md" ] \
    || die "staged tree has no regular plugin-owned rules/AGENTS.md"
  [ -f "$stage/hooks.json" ] || die "staged tree has no rendered hooks.json"
  # `grep -q`, not `grep -c`: with no match `grep -c` prints 0 AND exits 1, so a
  # `|| echo 0` fallback appends a second line and the comparison never holds.
  ! grep -q '__ZENSU_HOME__' "$stage/hooks.json" 2>/dev/null \
    || die "hooks.json still contains unexpanded __ZENSU_HOME__ placeholders"
  command -v node >/dev/null 2>&1 \
    || die "node is required to validate the rendered hooks.json"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$stage/hooks.json" \
    2>/dev/null || die "rendered hooks.json is not valid JSON"
  # Every command the host will run must resolve inside the staged tree, or the
  # gates silently disappear while the installer still reports success.
  [ -f "$stage/hooks/antigravity/antigravity-shim.sh" ] \
    || die "staged tree has no hooks/antigravity/antigravity-shim.sh — every hook would resolve to nothing"
  while IFS= read -r script; do
    [ -n "$script" ] || continue
    case "$script" in
      pre-tool-chain.sh|post-tool-chain.sh|pre-invocation-chain.sh|stop-chain.sh)
        local handler listed
        for tool in Bash Write Edit MultiEdit Read Agent NotebookEdit; do
          listed="$(bash "$stage/hooks/antigravity/antigravity-shim.sh" --list-handlers "$script" "$tool")" \
            || die "cannot resolve chain '$script' for '$tool'"
          [ -n "$listed" ] || die "chain '$script' is empty for '$tool'"
          while IFS= read -r handler; do
            [ -f "$stage/hooks/$handler" ] || die "chain '$script' references missing '$handler'"
          done <<EOF_HANDLERS
$listed
EOF_HANDLERS
        done
        ;;
      *) [ -f "$stage/hooks/$script" ] || die "hooks.json wraps '$script', which is not in the staged tree" ;;
    esac
  done < <(grep -oE 'antigravity-shim\.sh [A-Za-z0-9._-]+\.sh' "$stage/hooks.json" | awk '{print $2}' | sort -u)

  # The event argument decides which verdict dialect emit-verdict speaks. Without it
  # the shim blanks HOOK_EVENT and every deny collapses to {} — a silent allow on all
  # four gates. A rendered hooks.json that lost it must never pass verification.
  command -v node >/dev/null 2>&1 || return 0
  local ev_problems
  ev_problems="$(node -e '
    const fs = require("fs");
    let t;
    try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (_) { process.stdout.write("unparseable hooks.json"); process.exit(0); }
    const EVENTS = new Set(["PreToolUse","PostToolUse","PreInvocation","PostInvocation","Stop"]);
    const bad = [];
    const check = (event, h) => {
      const m = String((h && h.command) || "").match(/antigravity-shim\.sh\s+(\S+)(?:\s+(\S+))?\s*$/);
      if (!m) return;
      const declared = m[2] || "";
      if (!declared) bad.push(m[1] + ":no-event");
      else if (!EVENTS.has(declared)) bad.push(m[1] + ":unknown-event-" + declared);
      else if (declared !== event) bad.push(m[1] + ":" + declared + "-under-" + event);
    };
    for (const events of Object.values(t || {}))
      for (const [event, arr] of Object.entries(events || {})) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (Array.isArray(e && e.hooks)) e.hooks.forEach(h => check(event, h));
          else check(event, e);
        }
      }
    process.stdout.write(bad.join(" "));
  ' "$stage/hooks.json" 2>/dev/null)"
  [ -z "$ev_problems" ] || die "rendered hooks.json has bad event argument(s), which would make every gate deny nothing: $ev_problems"
}

# Deliberately removing OUR OWN installed tree is the intended cleanup, not the
# hazard the guard exists for — so this does not consult it. Instead it refuses
# anything that is not one of the two fixed, $HOME-derived paths this script
# owns, which is a tighter constraint than a path-prefix check.
remove_tree() { # $1 = path, $2 = label
  case "$1" in
    "$DEST"|"$LEGACY_CLI_DEST") ;;
    *) die "internal error: refusing to remove '$1' — not a plugin path this installer owns" ;;
  esac
  [ -d "$1" ] || return 0
  rm -rf -- "$1" && step REMOVE "$2"
}

# --- Uninstall ---------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  if [ "$DRY" -eq 1 ]; then
    step DRY "agy plugin uninstall $PLUGIN_NAME"
    step DRY "rm -rf $DEST"
    step DRY "rm -rf $LEGACY_CLI_DEST  (populated by the previous installer)"
    step DRY "rm $ZENSU_HOST_HOME_DIR/plugin-root"
    say ""
    say "dry-run: nothing was written. ~/.zensu/config.json is never removed."
    exit 0
  fi
  if command -v agy >/dev/null 2>&1; then
    if agy plugin uninstall "$PLUGIN_NAME" >/dev/null 2>&1; then
      step REMOVE "registered plugin '$PLUGIN_NAME'"
    else
      say "note: 'agy plugin uninstall $PLUGIN_NAME' did not succeed — it may not have been registered; continuing with the filesystem cleanup"
    fi
  fi
  remove_tree "$DEST" "$DEST"
  remove_tree "$LEGACY_CLI_DEST" "$LEGACY_CLI_DEST (previous installer's CLI copy)"
  [ -f "$ZENSU_HOST_HOME_DIR/plugin-root" ] && rm -f "$ZENSU_HOST_HOME_DIR/plugin-root" && step REMOVE "$ZENSU_HOST_HOME_DIR/plugin-root"
  say ""
  say "done. ~/.zensu/config.json was kept (user data)."
  exit 0
fi

# --- Install -----------------------------------------------------------------
if [ "$STAGE_ONLY_SET" -eq 0 ] && [ "$DRY" -eq 0 ]; then
  command -v agy >/dev/null 2>&1 || die "the 'agy' CLI is not on PATH. Install Antigravity first."
fi
guard_plugin_root "$SRC" "install source"

say "zensu-antigravity installer -> $DEST$([ "$DRY" -eq 1 ] && echo ' (dry-run)')"

# --stage-only must honour --dry-run: it used to run a real `rm -rf` on a
# caller-supplied path even when a no-write preview was requested.
if [ "$STAGE_ONLY_SET" -eq 1 ] && [ "$DRY" -eq 1 ]; then
  guard_plugin_root "$STAGE_ONLY/$PLUGIN_NAME" "staging directory"
  step DRY "rm -rf $STAGE_ONLY/$PLUGIN_NAME"
  step DRY "stage: $STAGE_ENTRIES"
  step DRY "render hooks.json (__ZENSU_HOME__ -> $HOOK_ROOT)"
  say ""
  say "dry-run: nothing was written."
  exit 0
fi

if [ "$STAGE_ONLY_SET" -eq 1 ]; then
  build_stage "$STAGE_ONLY"
  verify_stage "$STAGE"
  step STAGE "$STAGE"
  say ""
  say "staged only. Register it with:  agy plugin install \"$STAGE\""
  exit 0
fi

if [ "$DRY" -eq 1 ]; then
  for entry in $STAGE_ENTRIES; do
    [ -e "$SRC/$entry" ] && step STAGE "$entry"
  done
  step RENDER "hooks.json (__ZENSU_HOME__ -> $DEST)"
  step CLEAR  "$DEST (removed before import so a stale layout cannot survive)"
  step IMPORT "agy plugin install <staged tree>"
  step WRITE  "$ZENSU_HOST_HOME_DIR/plugin-root -> $DEST"
  step SEED   "$ZENSU_HOME_DIR/config.json (only if missing)"
  say ""
  say "dry-run: nothing was written."
  exit 0
fi

command -v agy >/dev/null 2>&1 \
  || die "the 'agy' CLI is not on PATH. Install Antigravity first — hand-copying the
     plugin directory does NOT register it, so no /zensu-<name> command would exist."

STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/zensu-stage-XXXXXX")" || die "cannot create a staging dir"
trap 'rm -rf "$STAGE_ROOT"' EXIT
trap 'rm -rf "$STAGE_ROOT"; exit 130' INT
trap 'rm -rf "$STAGE_ROOT"; exit 143' TERM
build_stage "$STAGE_ROOT"
verify_stage "$STAGE"
step STAGE "$(find "$STAGE" -type f | wc -l | tr -d ' ') files (curated)"

# Clear the previous install first: the importer copies INTO the destination, so
# an upgrade would otherwise keep files the new layout no longer ships — exactly
# obsolete files from earlier layouts, including unshipped rules and workflows.
remove_tree "$DEST" "$DEST (previous install)"
remove_tree "$LEGACY_CLI_DEST" "$LEGACY_CLI_DEST (previous installer's CLI copy)"

agy plugin install "$STAGE" || die "the host importer rejected the staged tree"
step IMPORT "registered as '$PLUGIN_NAME'"

# DEST is an assumption about the host's layout, so verify it rather than
# writing a pointer and hook paths that would be dead.
[ -f "$DEST/plugin.json" ] && [ -f "$DEST/hooks/antigravity/antigravity-shim.sh" ] \
  || die "the host did not install to $DEST — the rendered hooks.json paths and the
     plugin-root pointer would both be dead. Inspect 'agy plugin list' and re-run."

mkdir -p "$ZENSU_HOST_HOME_DIR" || die "cannot create $ZENSU_HOME_DIR"
printf '%s\n' "$DEST" > "$ZENSU_HOST_HOME_DIR/plugin-root" || die "cannot write the plugin-root pointer"
step WRITE "$ZENSU_HOST_HOME_DIR/plugin-root -> $DEST"

if [ -f "$ZENSU_HOME_DIR/config.json" ]; then
  step KEEP "$ZENSU_HOME_DIR/config.json (existing user config untouched)"
elif [ -f "$SRC/config.example.json" ]; then
  cp "$SRC/config.example.json" "$ZENSU_HOME_DIR/config.json" \
    || die "seeding $ZENSU_HOME_DIR/config.json failed"
  step SEED "$ZENSU_HOME_DIR/config.json"
else
  say "note: no config.example.json to seed from — the plugin will use its built-in defaults"
fi

say ""
agy plugin validate "$DEST" >/dev/null 2>&1 \
  || die "'agy plugin validate $DEST' did not report ok — the install is not trustworthy"
step VERIFY "agy plugin validate $DEST -> ok"

say ""
say "done. Next steps:"
say "  restart Antigravity so the IDE picks up the newly registered plugin"
say "  /zensu-help          # orientation; /zensu-tdd for the gate-enforced TDD build"
