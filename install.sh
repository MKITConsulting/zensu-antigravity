#!/usr/bin/env bash
# zensu-antigravity installer. Google Antigravity discovers a whole plugin
# DIRECTORY at a fixed path, so — unlike the Kiro port, which scattered files
# onto shared surfaces — this stages the ENTIRE plugin subtree into the plugin
# dirs:
#
#   ~/.gemini/config/plugins/zensu/            IDE plugins   (the ZENSU_HOME runtime)
#   ~/.gemini/antigravity-cli/plugins/zensu/   CLI plugins
#   ~/.zensu/plugin-root                       runtime-home pointer the libs read
#   ~/.zensu/config.json                       seeded from config.example.json if missing
#
# Antigravity's hooks.json `command` MUST be an absolute path and has no
# documented ${VAR} expansion, so install renders the tracked hooks.json.template
# (placeholder __ZENSU_HOME__) into a real hooks.json at EACH dest, with every
# command pointing at the SINGLE ZENSU_HOME runtime (the IDE dest) so one hook
# runtime + one FSM state root is authoritative even when both dests are staged.
#
# Usage:
#   install.sh [--target ide|cli|both] [--uninstall] [--dry-run] [--force]
#
# Idempotent via a plain-TSV manifest (path<TAB>sha256) per dest: unchanged files
# are NOOP on re-run, user-modified files are SKIPped on every upgrade (the prior
# record is carried forward; --force overwrites), re-running the same version is a
# NOOP. --uninstall removes only manifest-recorded files under the allowed plugin
# roots, refusing any path with parent traversal; ~/.zensu user data is left
# untouched. No node JSON surgery (no MCP merge) — only `sed` renders hooks.json.
set -u

SRC="$(cd "$(dirname "$0")" && pwd)"
TARGET="both"
DRY=0
FORCE=0
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || { echo "FATAL: --target needs a value (ide|cli|both)" >&2; exit 2; }
      TARGET="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

case "$TARGET" in ide|cli|both) ;; *) echo "FATAL: --target must be ide, cli, or both" >&2; exit 2 ;; esac

if command -v shasum >/dev/null 2>&1; then
  sha()       { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
  sha_stdin() { shasum -a 256 | cut -d' ' -f1; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha()       { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
  sha_stdin() { sha256sum | cut -d' ' -f1; }
else
  echo "FATAL: neither shasum nor sha256sum found (manifest integrity needs one)" >&2
  exit 1
fi

IDE_DEST="$HOME/.gemini/config/plugins/zensu"
CLI_DEST="$HOME/.gemini/antigravity-cli/plugins/zensu"
# ZENSU_HOME is the single absolute runtime root substituted into hooks.json
# `command` paths at BOTH dests, so one hook runtime + one FSM state root is
# authoritative even when both IDE and CLI plugins are installed.
ZENSU_HOME="$IDE_DEST"

# Which dests to act on for this --target.
DESTS=""
case "$TARGET" in
  ide)  DESTS="$IDE_DEST" ;;
  cli)  DESTS="$CLI_DEST" ;;
  both) DESTS="$IDE_DEST $CLI_DEST" ;;
esac

say() { printf '%s\n' "$*"; }

manifest_path() { printf '%s/.zensu-install-manifest.tsv' "$1"; }

manifest_lookup() { # $1=manifest-file $2=abs-path -> recorded hash or empty
  [ -f "$1" ] || return 0
  # plain TSV: path<TAB>hash ; exact path match on the first field
  awk -F'\t' -v p="$2" '$1==p {print $2; exit}' "$1" 2>/dev/null
}

# Allowed deletion root: a manifest entry may only be removed when it is an
# absolute path under one of the plugin dirs AND contains no parent traversal.
# The trailing slash keeps sibling prefixes (…/zensu-evil) out.
path_allowed() { # $1=abs path
  case "$1" in
    *..*) return 1 ;;
    "$IDE_DEST/"*|"$CLI_DEST/"*) return 0 ;;
  esac
  return 1
}

# install_file <src-abs> <dst-abs> <list-file> [render]
#   render: sed-substitute __ZENSU_HOME__ -> $ZENSU_HOME (for hooks.json)
install_file() {
  local src="$1" dst="$2" list="$3" render="${4:-no}" content tmp old want recorded
  if [ "$render" = "render" ]; then
    content="$(sed "s|__ZENSU_HOME__|$ZENSU_HOME|g" "$src")"
  else
    content="$(cat "$src")"
  fi
  want="$(printf '%s\n' "$content" | sha_stdin)"
  if [ -f "$dst" ]; then
    old="$(sha "$dst")"
    if [ "$old" = "$want" ]; then
      say "NOOP    $dst"
      printf '%s\t%s\n' "$dst" "$want" >> "$list"
      return 0
    fi
    recorded="$(manifest_lookup "$MANIFEST" "$dst")"
    if [ "$FORCE" -ne 1 ] && { { [ -n "$recorded" ] && [ "$old" != "$recorded" ]; } || [ -z "$recorded" ]; }; then
      say "SKIP    $dst (pre-existing/user-modified; --force to overwrite)"
      # Carry our previous record forward so the guard survives the manifest
      # rewrite. FOREIGN file (no record): record NOTHING.
      [ -n "$recorded" ] && printf '%s\t%s\n' "$dst" "$recorded" >> "$list"
      return 0
    fi
    say "UPDATE  $dst"
  else
    say "CREATE  $dst"
  fi
  [ "$DRY" -eq 1 ] && { printf '%s\t%s\n' "$dst" "$want" >> "$list"; return 0; }
  mkdir -p "$(dirname "$dst")"
  tmp="$(mktemp "$(dirname "$dst")/.zensu-install.XXXXXX")" || return 1
  if printf '%s\n' "$content" > "$tmp" && mv "$tmp" "$dst"; then
    case "$dst" in *.sh) chmod +x "$dst" ;; esac
    printf '%s\t%s\n' "$dst" "$want" >> "$list"
  else
    rm -f "$tmp" 2>/dev/null
    say "ERROR   $dst (write failed; not recorded)"
    INSTALL_FAILED=1
    return 1
  fi
}

# ── Uninstall ────────────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
  REMOVED_ANY=0
  for DEST in $DESTS; do
    MANIFEST="$(manifest_path "$DEST")"
    [ -f "$MANIFEST" ] || { say "nothing to uninstall at $DEST (no manifest)"; continue; }
    REMOVED_ANY=1
    while IFS="$(printf '\t')" read -r p hash; do
      [ -n "$p" ] || continue
      if ! path_allowed "$p"; then
        say "REFUSE  $p (outside allowed plugin roots)"
        continue
      fi
      [ -f "$p" ] || continue
      cur="$(sha "$p")"
      if [ "$cur" = "$hash" ] || [ "$FORCE" -eq 1 ]; then
        say "REMOVE  $p"
        [ "$DRY" -eq 1 ] || rm -f "$p"
      else
        say "KEEP    $p (user-modified)"
      fi
    done < "$MANIFEST"
    if [ "$DRY" -ne 1 ]; then
      rm -f "$MANIFEST"
      # prune now-empty dirs under this dest only
      find "$DEST" -type d -empty -delete 2>/dev/null || true
    fi
  done
  [ "$REMOVED_ANY" -eq 1 ] || exit 0
  say "uninstalled (target=$TARGET). ~/.zensu user data (config + state) left untouched."
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────
say "zensu-antigravity installer -> target=$TARGET$([ "$DRY" -eq 1 ] && echo ' (dry-run)')"
INSTALL_FAILED=0

# Stage list (relative to SRC). Plugin RUNTIME only — meta/test files excluded.
#   plugin.json, skills/, rules/, workflows/, agents/, hooks/ (RECURSIVE incl.
#   hooks/antigravity + hooks/lib), config.example.json, mcp_config.json
stage_into() { # $1=dest plugin root
  local DEST="$1" LIST f rel
  MANIFEST="$(manifest_path "$DEST")"
  LIST="$(mktemp)"

  # top-level runtime files
  for f in plugin.json config.example.json mcp_config.json; do
    [ -f "$SRC/$f" ] && install_file "$SRC/$f" "$DEST/$f" "$LIST"
  done

  # recursive subtrees: skills, rules, workflows, agents, hooks (incl. antigravity + lib)
  while IFS= read -r f; do
    rel="${f#"$SRC"/}"
    install_file "$f" "$DEST/$rel" "$LIST"
  done < <(find "$SRC/skills" "$SRC/rules" "$SRC/workflows" "$SRC/agents" "$SRC/hooks" -type f 2>/dev/null | sort)

  # generated hooks.json (absolute paths, rendered from the template into THIS dest)
  if [ -f "$SRC/hooks.json.template" ]; then
    install_file "$SRC/hooks.json.template" "$DEST/hooks.json" "$LIST" render
  fi

  # write the manifest (plain TSV) for this dest
  if [ "$DRY" -ne 1 ]; then
    mkdir -p "$DEST"
    sort -u "$LIST" > "$MANIFEST"
    say "WRITE   $MANIFEST"
  fi
  rm -f "$LIST"
}

for DEST in $DESTS; do
  stage_into "$DEST"
done

# ~/.zensu seeding (pointer + config; never overwrite an existing config)
if [ "$DRY" -ne 1 ]; then
  mkdir -p "$HOME/.zensu"
  printf '%s\n' "$ZENSU_HOME" > "$HOME/.zensu/plugin-root"
  say "WRITE   $HOME/.zensu/plugin-root -> $ZENSU_HOME"
  if [ ! -f "$HOME/.zensu/config.json" ]; then
    cp "$SRC/config.example.json" "$HOME/.zensu/config.json"
    say "SEED    $HOME/.zensu/config.json (from config.example.json)"
  fi
  # ensure the entry scripts are executable at the runtime (defensive: the
  # source may be checked out without the +x bit on some platforms)
  for s in "$ZENSU_HOME/hooks/antigravity/antigravity-shim.sh" \
           "$ZENSU_HOME/hooks/antigravity/lazy-init.sh"; do
    [ -f "$s" ] && chmod +x "$s" 2>/dev/null || true
  done
fi

say ""
say "done. Next steps:"
say "  restart Antigravity so it discovers the freshly-staged plugin dir"
say "  /zensu-help          # orientation; /zensu-tdd for gate-enforced TDD"
if [ "$INSTALL_FAILED" -ne 0 ]; then
  echo "install completed WITH ERRORS (see ERROR lines above)" >&2
  exit 1
fi
exit 0
