'use strict';

// Single source of truth for the shape promptfoo writes into `--output`.
//
// promptfoo has shipped two envelopes over its life: a top-level `results`
// array, and a nested `results.results` array. Every consumer that reads a
// result file has to know which one it got, and each copy of that knowledge is
// a place the suite can start reading zero rows — which looks exactly like a
// clean run. The gatekeeper (verify-results.js) and the live suite's
// unverified-scan both read the same files for different reasons, so the shape
// lives here once and both import it.
//
// `resultRows` THROWS on an unrecognised envelope rather than defaulting to an
// empty array: "I could not understand the results" and "every scenario passed"
// must never render the same.

function resultRows(payload) {
  const nested = payload && payload.results && payload.results.results;
  const rows = Array.isArray(nested) ? nested : payload && payload.results;
  if (!Array.isArray(rows)) throw new Error('unrecognised promptfoo results shape');
  return rows;
}

function rowScenarioId(row) {
  return (row && row.vars && row.vars.scenario_id) || '<unnamed>';
}

function rowPassed(row) {
  return Boolean(row) && row.success === true;
}

function rowReason(row) {
  if (!row) return 'no reason reported';
  return (
    (row.gradingResult && row.gradingResult.reason) ||
    (row.error ? String(row.error) : 'no reason reported')
  );
}

// The provider's stdout as TEXT. promptfoo may hand back the parsed object
// instead of the raw string; scanning that object directly finds nothing and
// stringifying it naively yields "[object Object]", so a marker the provider
// definitely emitted reads as absent.
function rowOutputText(row) {
  const raw = row && row.response && row.response.output;
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw == null ? '' : raw);
}

module.exports = { resultRows, rowScenarioId, rowPassed, rowReason, rowOutputText };
