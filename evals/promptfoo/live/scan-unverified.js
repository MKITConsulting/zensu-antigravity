#!/usr/bin/env node
'use strict';

// Which live scenarios verified NOTHING.
//
// A scenario that could not reach agy — quota wall, expired login, network, a
// killed process — is not a pass. promptfoo reports it green because the
// scenario legitimately accepts the LIVE-UNAVAILABLE marker; this scan is where
// that is called out and turned back into a failure.
//
// It reads the result ROWS rather than grepping the result blob. The scenarios
// list "LIVE-UNAVAILABLE" as an accepted marker, so that literal appears in
// every test's assertion CONFIG: a naive grep counts the config and reports a
// wall of failures on a run where nothing even tried to reach agy.
//
// It lived as a heredoc inside run-live.sh, which put a second copy of the
// promptfoo row shape in a file no test could load. Both now come from
// lib/results-shape.js.

const fs = require('node:fs');
const path = require('node:path');
const { resultRows, rowOutputText } = require(path.join(__dirname, '..', 'lib', 'results-shape'));

// `optedIn` decides whether a SKIP also counts as unverified. Without the
// opt-in a fully skipped run is the expected hermetic outcome; with it, a skip
// means the run was asked to reach the host and did not.
function scanUnverified(payload, optedIn) {
  const hits = [];
  for (const row of resultRows(payload)) {
    const out = rowOutputText(row);
    // Stop at the first quote or backslash: the marker is embedded in a JSON
    // envelope, so the rest of the line is the envelope, not the reason.
    const match = out.match(/LIVE-(?:UNAVAILABLE|INCONCLUSIVE)[^"\\]*/);
    if (match) {
      hits.push(match[0].trim());
      continue;
    }
    if (optedIn && out.includes('LIVE-SKIPPED')) {
      hits.push('LIVE-SKIPPED (opted in, but the scenario skipped)');
    }
  }
  return hits;
}

function main(argv, env) {
  const file = argv[2];
  if (!file) {
    process.stderr.write('usage: scan-unverified.js <results.json>\n');
    return 2;
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`live scan: cannot read ${file}: ${(error && error.message) || error}\n`);
    return 2;
  }

  let hits;
  try {
    hits = scanUnverified(payload, env.ZENSU_LIVE_AGY === '1');
  } catch (error) {
    // An envelope this scan cannot read must not render as "nothing
    // unverified" — that is the silent green the whole suite is built against.
    process.stderr.write(`live scan: ${(error && error.message) || error}\n`);
    return 2;
  }

  if (!hits.length) return 0;
  process.stdout.write(`${hits.length}\n${[...new Set(hits)].slice(0, 5).join('\n')}`);
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv, process.env));
}

module.exports = { scanUnverified };
