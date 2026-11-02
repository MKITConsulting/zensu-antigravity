'use strict';

const fs = require('node:fs');
const path = require('node:path');

function within(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Shared by shell storage checks and in-process mutations. The trusted root may
// itself be an OS alias; every descendant is checked without following links.
function assertPathsSafe(roots, ...args) {
  if (!args.length || args.length % 2 !== 0) throw new Error('invalid storage path pairs');
  const trusted = roots.filter(Boolean).map(value => path.resolve(value));
  const validModes = new Set(['regular', 'regular-or-absent', 'directory', 'directory-or-absent']);
  for (let pair = 0; pair < args.length; pair += 2) {
    const target = path.resolve(args[pair]);
    const mode = args[pair + 1];
    if (!validModes.has(mode)) throw new Error('invalid storage path mode');
    const checkLeaf = stat => {
      if (stat.isSymbolicLink()) throw new Error('symlink storage path');
      if (mode.startsWith('regular') && (!stat.isFile() || stat.nlink !== 1)) throw new Error('unsafe regular storage file');
      if (mode.startsWith('directory') && !stat.isDirectory()) throw new Error('unsafe storage directory');
    };
    try { checkLeaf(fs.lstatSync(target)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const candidates = trusted.filter(value => within(value, target)).sort((a, b) => b.length - a.length);
    let anchor = candidates[0] || '';
    if (!anchor) {
      let cursor = path.dirname(target);
      for (;;) {
        try {
          const stat = fs.lstatSync(cursor);
          if (stat.isDirectory() && !stat.isSymbolicLink()) { anchor = cursor; break; }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error('no safe storage anchor');
        cursor = parent;
      }
    }
    const physicalAnchor = fs.realpathSync(anchor);
    if (!within(anchor, target)) throw new Error('storage path escapes anchor');
    const relative = path.relative(anchor, target);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    let current = physicalAnchor;
    let missing = false;
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      if (missing) continue;
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        missing = true;
        continue;
      }
      if (stat.isSymbolicLink()) throw new Error('symlink storage ancestor');
      if (index === parts.length - 1) checkLeaf(stat);
      else if (!stat.isDirectory()) throw new Error('non-directory storage ancestor');
    }
    if (missing && !mode.endsWith('-or-absent')) throw new Error('required storage path absent');
  }
}

function replaceRegular(source, target, roots) {
  assertPathsSafe(roots, source, 'regular', target, 'regular-or-absent');
  const before = fs.lstatSync(source);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('unsafe replacement source');
  try {
    const existing = fs.lstatSync(target);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error('unsafe replacement target');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.renameSync(source, target);
  const after = fs.lstatSync(target);
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1) throw new Error('unsafe replaced file');
}

module.exports = { assertPathsSafe, replaceRegular };
