'use strict';

// Bound fixtures exercise the real installed-manifest contract. A clean source
// checkout omits this generated file; prepare it before any parallel workers.
// Existing local output is never rewritten and no host registration is performed.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function prepareRuntime(directory) {
  const root = fs.realpathSync(directory);
  const target = path.join(root, 'hooks.json');
  function validateExisting() {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('hooks.json must be a regular file');
    JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  try {
    validateExisting();
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const rendered = fs.readFileSync(path.join(root, 'hooks.json.template'), 'utf8')
    .split('__ZENSU_HOME__').join(root);
  JSON.parse(rendered);
  const temporary = path.join(root, `.hooks-test-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, rendered, { flag: 'wx', mode: 0o600 });
    try {
      fs.linkSync(temporary, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    validateExisting();
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

if (require.main === module) {
  try {
    prepareRuntime(process.argv[2] || path.resolve(__dirname, '..'));
  } catch (error) {
    console.error(`Test runtime preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { prepareRuntime };
