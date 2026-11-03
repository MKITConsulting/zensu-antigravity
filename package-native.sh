#!/usr/bin/env bash
# Build an installable native Antigravity ZIP without invoking or modifying agy.
# Usage: bash package-native.sh <output-directory>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: bash package-native.sh <output-directory>" >&2
  exit 2
fi
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
VERSION="$(node -e 'const v=require(process.argv[1]).version; if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error("Invalid plugin version"); process.stdout.write(v)' "$ROOT/plugin.json")"
NAME="zensu-antigravity-native-v$VERSION.zip"
mkdir -p -- "$1"
OUTPUT="$(cd "$1" && pwd -P)"
for artifact in "$OUTPUT/$NAME" "$OUTPUT/$NAME.sha256"; do
  [ ! -e "$artifact" ] && [ ! -L "$artifact" ] || { echo "Refusing to replace $artifact" >&2; exit 1; }
done
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/zensu-native-package-XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
bash "$ROOT/install.sh" --portable-stage-only "$STAGING/stage" >&2

node - "$STAGING/stage/zensu" "$ROOT" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.argv[2];
const source = process.argv[3];
const repository = spawnSync('git', ['-C', source, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (repository.status !== 0 || fs.realpathSync(repository.stdout.trim()) !== source) throw Error('Build the native package from the repository checkout');
const inventory = spawnSync('git', ['-C', source, 'ls-files', '-z'], { encoding: 'utf8' });
if (inventory.status !== 0) throw Error('Cannot verify tracked source inventory');
const tracked = new Set(inventory.stdout.split('\0').filter(Boolean));
function walk(directory) {
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry), stat = fs.lstatSync(file);
    if (stat.isDirectory()) walk(file);
    else {
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Non-regular package entry: ${file}`);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative !== 'hooks.json' && !tracked.has(relative)) throw Error(`Untracked package entry: ${relative}`);
      if (relative.split('/').some(part => part === '.git' || part === '.zensu' || part === 'node_modules' || /^\.env(?:\.|$)/.test(part))) throw Error(`Private package entry: ${relative}`);
    }
  }
}
walk(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
if (manifest.name !== 'zensu') throw Error('Unexpected plugin identity');
const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
const expected = new Map([
  ['PreToolUse', 'pre-tool-chain.sh'], ['PostToolUse', 'post-tool-chain.sh'],
  ['PreInvocation', 'pre-invocation-chain.sh'], ['Stop', 'stop-chain.sh'],
]);
for (const group of Object.values(hooks)) {
  for (const [event, entries] of Object.entries(group)) {
    const script = expected.get(event);
    if (!script || !Array.isArray(entries) || entries.length !== 1) throw Error(`Unexpected event: ${event}`);
    const entry = entries[0];
    const toolEvent = event === 'PreToolUse' || event === 'PostToolUse';
    if (toolEvent && (entry.matcher !== '.*' || !Array.isArray(entry.hooks) || entry.hooks.length !== 1)) throw Error('Invalid tool hook wrapper');
    const handler = toolEvent ? entry.hooks[0] : entry;
    if (handler.type !== 'command' || handler.command !== `bash ./hooks/antigravity/antigravity-shim.sh ${script} ${event}`) throw Error('Non-portable hook command');
    expected.delete(event);
  }
}
if (expected.size) throw Error('Missing hook events');
for (const excluded of ['.git', '.zensu', 'tests', 'evals', 'node_modules', 'AGENTS.md', 'install.sh', 'hooks.json.template', 'commands', 'hooks/hooks.json']) {
  if (fs.existsSync(path.join(root, excluded))) throw Error(`Development entry leaked: ${excluded}`);
}
JS

(cd "$STAGING/stage" && zip -X -q -r "$STAGING/$NAME" zensu)
node - "$STAGING/$NAME" "$NAME" > "$STAGING/$NAME.sha256" <<'JS'
const fs = require('node:fs'), crypto = require('node:crypto');
console.log(`${crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex')}  ${process.argv[3]}`);
JS
# Exclusive copies also refuse a destination created while packaging was running.
node - "$STAGING" "$OUTPUT" "$NAME" <<'JS'
const fs = require('node:fs'), path = require('node:path');
for (const name of [process.argv[4], `${process.argv[4]}.sha256`]) {
  fs.copyFileSync(path.join(process.argv[2], name), path.join(process.argv[3], name), fs.constants.COPYFILE_EXCL);
}
JS
printf '%s\n' "$OUTPUT/$NAME" "$OUTPUT/$NAME.sha256"
