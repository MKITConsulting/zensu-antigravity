'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function inventory(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json.template'), 'utf8'));
  const result = [];
  for (const group of Object.values(manifest)) for (const [event, entries] of Object.entries(group)) {
    for (const entry of entries) for (const handler of entry.hooks || [entry]) {
      const match = handler.command.match(/antigravity-shim\.sh\s+([\w.-]+\.sh)\s+(\w+)$/);
      if (!match || match[2] !== event) throw new Error('Invalid host shim registration');
      for (const entryName of event === 'PreInvocation' ? ['startup-chain.sh', match[1]] : [match[1]]) for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Agent']) {
        const scripts = execFileSync('bash', [path.join(root, 'hooks/antigravity/antigravity-shim.sh'), '--list-handlers', entryName, tool], { encoding: 'utf8' }).trim().split('\n');
        for (const script of scripts) result.push({ event, script, tool, entry: entryName, matcher: entry.matcher });
      }
    }
  }
  return result;
}
module.exports = { inventory };
