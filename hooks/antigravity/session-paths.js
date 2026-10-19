'use strict';

// This adapter owns its persistent directory. Antigravity documents no plugin
// data environment variable; model-provided selectors never choose this path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function pluginRoot() { return fs.realpathSync.native(path.resolve(__dirname, '../..')); }
function dataRoot() {
  return path.join(os.userInfo().homedir, '.zensu', 'antigravity', 'plugin-data');
}
function safeSessionId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value)
      || /^(?:scv1_[a-f0-9]{64}|sha256:[a-f0-9]{64})$/.test(value)) {
    throw new Error('A raw, safe host conversation id is required');
  }
  return value;
}
function secureDirectory(directory, create = true) {
  const absolute = path.resolve(directory);
  let ancestor = path.parse(absolute).root;
  for (const segment of absolute.slice(ancestor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, segment);
    try {
      const seen = fs.lstatSync(ancestor);
      if (!seen.isDirectory() || seen.isSymbolicLink()) throw new Error('Private directory ancestry is unsafe');
    } catch (error) { if (error.code !== 'ENOENT') throw error; break; }
  }
  const parent = path.dirname(absolute);
  if (parent !== absolute) {
    let stat;
    try { stat = fs.lstatSync(parent); } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      secureDirectory(parent, create);
    }
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Private directory parent is unsafe');
  }
  try { if (create) fs.mkdirSync(absolute, { mode: 0o700 }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('Private directory is unsafe or owned by another user');
  }
  // Only adapter-created paths are tightened. An existing public directory is
  // refused; never chmod an arbitrary caller-supplied ancestor into compliance.
  if ((stat.mode & 0o077) !== 0) throw new Error('Private directory permissions must be 0700');
  if (fs.realpathSync.native(absolute) !== absolute) throw new Error('Private directory is aliased');
  return absolute;
}
function privateDirectory(root, ...segments) {
  let current = secureDirectory(root);
  for (const segment of segments) {
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) throw new Error('Unsafe private directory segment');
    current = secureDirectory(path.join(current, segment));
  }
  return current;
}
function readPrivateJson(file, maxBytes = 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (stat.mode & 0o077) !== 0 || stat.size > maxBytes
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('Private record is unsafe');
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('Private record changed while opening');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function writePrivateJson(file, value) {
  const temporary = `${file}.${crypto.randomBytes(16).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temporary, file); } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function helperPrefix(sessionId, root = pluginRoot()) {
  return `bash ${shellQuote(path.join(root, 'hooks/antigravity/session-helper.sh'))} --session ${shellQuote(safeSessionId(sessionId))}`;
}

module.exports = { pluginRoot, dataRoot, safeSessionId, secureDirectory, privateDirectory,
  readPrivateJson, writePrivateJson, shellQuote, helperPrefix };
