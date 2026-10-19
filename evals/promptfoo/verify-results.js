#!/usr/bin/env node
'use strict';

// Gatekeeper for the promptfoo proof suite.
//
// A green promptfoo run is not sufficient on its own: a config that silently
// evaluated zero scenarios also reports zero failures. This verifier reads the
// scenario catalogs, requires that every catalogued scenario actually ran, and
// requires that every one of them passed.

const fs = require('node:fs');
const path = require('node:path');
const { resultRows, rowScenarioId, rowPassed, rowReason } = require('./lib/results-shape');

// Which suite to verify. Defaults to the offline suite that lives next to this
// file; the live suite passes its own directory so it gets the same
// "every catalogued scenario actually ran" guarantee instead of trusting a
// promptfoo run that evaluated nothing.
const EVAL_DIR = process.argv[3] ? path.resolve(process.argv[3]) : __dirname;

function catalogScenarioIds() {
  const configRaw = fs.readFileSync(path.join(EVAL_DIR, 'promptfooconfig.yaml'), 'utf8');
  const files = [...configRaw.matchAll(/file:\/\/(scenarios\/[A-Za-z0-9._-]+\.yaml)/g)].map(
    (match) => match[1]
  );
  if (!files.length) throw new Error('promptfooconfig.yaml references no scenario catalog');

  const ids = [];
  for (const relative of files) {
    const raw = fs.readFileSync(path.join(EVAL_DIR, relative), 'utf8');
    const found = [...raw.matchAll(/^\s*scenario_id:\s*([A-Za-z0-9._-]+)\s*$/gm)].map((m) => m[1]);
    if (!found.length) throw new Error(`${relative} declares no scenario_id`);
    ids.push(...found);
  }

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(`duplicate scenario_id(s): ${[...new Set(duplicates)].join(', ')}`);
  }
  return { files, ids };
}

function collectResults(payload) {
  return resultRows(payload).map((row) => ({
    id: rowScenarioId(row),
    pass: rowPassed(row),
    reason: rowReason(row),
  }));
}

function main() {
  const catalog = catalogScenarioIds();

  if (process.argv[2] === '--catalog-only') {
    process.stdout.write(
      `promptfoo catalog: ${catalog.ids.length} scenario(s) across ${catalog.files.length} file(s)\n`
    );
    return 0;
  }

  const resultsPath = process.argv[2];
  if (!resultsPath) throw new Error('usage: verify-results.js <results.json>');
  const payload = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const rows = collectResults(payload);

  const ran = new Set(rows.map((row) => row.id));
  const missing = catalog.ids.filter((id) => !ran.has(id));
  const failed = rows.filter((row) => !row.pass);

  for (const row of failed) {
    process.stderr.write(`  FAIL  ${row.id}: ${row.reason}\n`);
  }
  for (const id of missing) {
    process.stderr.write(`  MISSING  ${id} was catalogued but never evaluated\n`);
  }

  if (failed.length || missing.length) {
    process.stderr.write(
      `promptfoo suite: ${failed.length} failed, ${missing.length} missing of ${catalog.ids.length} catalogued\n`
    );
    return 1;
  }

  process.stdout.write(`promptfoo suite: ${rows.length}/${catalog.ids.length} scenarios PASS\n`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`promptfoo suite: ${(error && error.message) || error}\n`);
  process.exit(1);
}
