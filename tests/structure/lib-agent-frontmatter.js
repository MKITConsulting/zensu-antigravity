'use strict';
// Canonical role metadata uses JSON-compatible YAML flow arrays. Parse the
// sequence as data: a comma-separated YAML scalar is not an array to the host.
const fs = require('node:fs');
function parse(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('Missing frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('Unclosed frontmatter');
  const metadata = {};
  for (const line of lines.slice(1, end)) {
    const match = /^(name|tools):\s*(.*)$/.exec(line);
    if (!match) continue;
    if (Object.hasOwn(metadata, match[1])) throw new Error('Duplicate metadata key');
    metadata[match[1]] = match[1] === 'tools' ? JSON.parse(match[2]) : match[2];
  }
  if (!metadata.name || !Array.isArray(metadata.tools) || !metadata.tools.length
      || metadata.tools.some(tool => typeof tool !== 'string' || !tool)
      || new Set(metadata.tools).size !== metadata.tools.length) throw new Error('Invalid native agent metadata');
  return metadata;
}
module.exports = { parse };
if (require.main === module) {
  try { process.stdout.write(`${parse(fs.readFileSync(process.argv[2], 'utf8')).tools.join('\n')}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
