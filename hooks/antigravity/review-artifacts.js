#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseWorkerResult } = require('../lib/review-evidence-lease-v1.js');
const LIMIT = 16 * 1024 * 1024;
function fail(message) { throw new Error(message); }
function read(file) {
  if (!path.isAbsolute(file || '')) fail('every artifact path must be absolute');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > LIMIT) fail('artifact is not a bounded regular file');
  if (fs.realpathSync(file) !== path.resolve(file)) fail('artifact traverses a symbolic link');
  return fs.readFileSync(file);
}
function lines(file) { return read(file).toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
function digest(file) { return crypto.createHash('sha256').update(read(file)).digest('hex'); }
function parse(argv) {
  const operation = argv.shift(); const args = {};
  const flags = { snapshot: ['--manifest','--output'], check: ['--snapshot'], validate: ['--snapshot','--kind','--role','--report','--paths','--production-paths'] };
  if (!flags[operation]) fail('use snapshot, check or validate');
  while (argv.length) {
    const name = argv.shift(); if (!flags[operation].includes(name) || !argv.length || Object.hasOwn(args, name)) fail('invalid or duplicate argument');
    args[name] = argv.shift();
  }
  return { operation, args };
}
function check(file) {
  const snapshot = JSON.parse(read(file).toString('utf8'));
  if (snapshot.schema !== 'zensu-in-thread-evidence/v1' || !Array.isArray(snapshot.files) || !snapshot.files.length) fail('invalid evidence snapshot');
  const seen = new Set();
  for (const entry of snapshot.files) {
    if (!entry || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) fail('invalid snapshot entry');
    seen.add(entry.path); if (digest(entry.path) !== entry.sha256) fail('evidence changed: ' + entry.path);
  }
  return snapshot;
}
function main(argv) {
  const { operation, args } = parse(argv);
  if (operation === 'snapshot') {
    const files = [...new Set(lines(args['--manifest']))];
    if (!files.length) fail('empty evidence manifest');
    const output = args['--output'];
    if (!path.isAbsolute(output || '') || files.includes(output)) fail('invalid snapshot output');
    const parent = fs.realpathSync(path.dirname(output));
    if (parent !== path.dirname(output)) fail('snapshot output traverses a symbolic link');
    const snapshot = { schema: 'zensu-in-thread-evidence/v1', execution: 'in-thread', files: files.map(file => ({ path: file, sha256: digest(file) })) };
    fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    process.stdout.write('snapshot=' + output + '\n');
  } else if (operation === 'check') {
    const snapshot = check(args['--snapshot']); process.stdout.write('evidence-unchanged=' + snapshot.files.length + '\n');
  } else if (operation === 'validate') {
    const snapshot = check(args['--snapshot']);
    for (const key of ['--paths', '--production-paths']) {
      if (args[key] && !snapshot.files.some(entry => entry.path === args[key])) fail('path inventory is outside the evidence snapshot');
    }
    const kind = args['--kind']; if (!['plan-review','pr-review'].includes(kind)) fail('unsupported review kind');
    if (kind === 'pr-review' && (!args['--paths'] || !args['--production-paths'])) fail('PR validation needs both path inventories');
    const allowed = args['--paths'] ? lines(args['--paths']) : undefined;
    const production = args['--production-paths'] ? lines(args['--production-paths']) : undefined;
    const value = parseWorkerResult(read(args['--report']).toString('utf8'), kind, allowed, production);
    if (value.role !== args['--role']) fail('report role does not match the expected pass');
    process.stdout.write(JSON.stringify(value) + '\n');
  } else fail('use snapshot, check or validate');
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write('review-artifacts: ' + error.message + '\n'); process.exitCode = 2; } }
module.exports = { main, check };
