'use strict';
// Local comparison harness; it never invokes a host or a model.
const fs = require('node:fs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const template = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta = /m, 'const meta = ');
const fixture = JSON.parse(fs.readFileSync(0, 'utf8'));
const agent = async (_prompt, options) => {
  const value = Object.hasOwn(fixture.responses, options.label)
    ? fixture.responses[options.label]
    : options.label.startsWith('find:') ? {findings: []}
    : {outcome: 'real', severity: 'CRITICAL', reasoning: 'Verified current source.'};
  if (value === '$FAIL') throw new Error('fixture failure');
  return value;
};
const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'budget', template);
fn(fixture.args, agent, calls => Promise.all(calls.map(call => call())), () => {}, () => {}, null)
  .then(value => process.stdout.write(JSON.stringify(value)), error => { process.stderr.write(String(error)); process.exitCode = 1; });
