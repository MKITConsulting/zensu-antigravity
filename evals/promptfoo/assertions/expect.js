'use strict';

// Shared deterministic assertion for every Zensu promptfoo suite.
//
// The provider returns a JSON envelope; each scenario declares an `expect`
// object describing what must hold. Every declared predicate must pass, and a
// scenario with no predicate at all is a failure — an empty expectation would
// otherwise look green while proving nothing.

function parseEnvelope(output) {
  if (output && typeof output === 'object') return output;
  try {
    return JSON.parse(String(output));
  } catch (_) {
    return null;
  }
}

function readPath(value, dotted) {
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc == null ? acc : acc[key]), value);
}

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = (output, context) => {
  const envelope = parseEnvelope(output);
  if (!envelope) {
    return { pass: false, score: 0, reason: 'provider did not return a JSON envelope' };
  }
  if (envelope.error) {
    return { pass: false, score: 0, reason: `provider error: ${envelope.error}` };
  }

  const expect = (context && context.vars && context.vars.expect) || {};
  const failures = [];
  let checks = 0;

  const stdout = String(envelope.stdout || '');
  const stderr = String(envelope.stderr || '');
  const combined = `${stdout}\n${stderr}`;

  if (Object.prototype.hasOwnProperty.call(expect, 'exit_code')) {
    checks += 1;
    if (envelope.exit_code !== expect.exit_code) {
      failures.push(`exit_code ${envelope.exit_code} != ${expect.exit_code}`);
    }
  }

  for (const needle of asList(expect.stdout_contains)) {
    checks += 1;
    if (!stdout.includes(needle)) failures.push(`stdout missing ${JSON.stringify(needle)}`);
  }
  for (const needle of asList(expect.stdout_not_contains)) {
    checks += 1;
    if (stdout.includes(needle)) failures.push(`stdout unexpectedly contains ${JSON.stringify(needle)}`);
  }
  // At least one of the alternatives must appear. The live suite needs this: a
  // scenario legitimately passes either with its real result OR with the
  // LIVE-SKIPPED marker when the opt-in env var is unset — and a skip must stay
  // visible in the report rather than being asserted away.
  const anyOf = asList(expect.stdout_contains_any);
  if (anyOf.length) {
    checks += 1;
    if (!anyOf.some(needle => stdout.includes(needle))) {
      failures.push(`stdout contains none of ${JSON.stringify(anyOf)}`);
    }
  }
  for (const needle of asList(expect.contains)) {
    checks += 1;
    if (!combined.includes(needle)) failures.push(`output missing ${JSON.stringify(needle)}`);
  }
  for (const needle of asList(expect.not_contains)) {
    checks += 1;
    if (combined.includes(needle)) failures.push(`output unexpectedly contains ${JSON.stringify(needle)}`);
  }
  for (const pattern of asList(expect.matches)) {
    checks += 1;
    if (!new RegExp(pattern).test(combined)) failures.push(`output does not match /${pattern}/`);
  }
  for (const pattern of asList(expect.not_matches)) {
    checks += 1;
    if (new RegExp(pattern).test(combined)) failures.push(`output unexpectedly matches /${pattern}/`);
  }

  if (expect.stdout_json) {
    checks += 1;
    let parsed = null;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (_) {
      failures.push('stdout is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object') {
      // A falsy-but-valid JSON body (null, 0, false, "") used to skip every declared
      // key comparison while still counting as a check, so a scenario could pass
      // having verified nothing at all.
      if (parsed !== null) failures.push(`stdout parsed to ${JSON.stringify(parsed)}, not an object`);
    } else {
      for (const [dotted, want] of Object.entries(expect.stdout_json)) {
        checks += 1;
        const got = readPath(parsed, dotted);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          failures.push(`stdout.${dotted} = ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
        }
      }
    }
  }

  if (checks === 0) {
    return { pass: false, score: 0, reason: 'scenario declared no expectation' };
  }
  if (failures.length) {
    // Carry a slice of what the scenario actually produced. Without it a
    // failure on a host you cannot reach — a CI runner — reports only which
    // expectation missed, never why, and every diagnosis costs a full push.
    const clip = (label, text) => {
      const trimmed = String(text || '').trim();
      if (!trimmed) return '';
      const shown = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
      return ` | ${label}: ${shown.replace(/\s+/g, ' ')}`;
    };
    return {
      pass: false,
      score: 0,
      reason: `${failures.join('; ')}${clip('stdout', stdout)}${clip('stderr', stderr)}`,
    };
  }
  return { pass: true, score: 1, reason: `${checks} expectation(s) held` };
};
