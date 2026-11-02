'use strict';

const path = require('node:path');
const core = require('./session-control-core-v1');
const { assertPathsSafe, replaceRegular } = require('./state-storage-v1');

// Keep the existing project-wide Core lease, but perform the complete budget
// transaction in its owning process. Starting shell helpers after acquisition
// makes eight short mutations exhaust the same bounded wait under host load.
function updateBudget(options, mutate) {
  const { runId } = options;
  // Native Windows operands may use either separator spelling. Compare their
  // resolved paths, just as the worker's project-root validation does.
  const projectRoot = path.resolve(options.projectRoot);
  const stateDirectory = path.resolve(options.stateDirectory);
  const runFile = path.resolve(options.runFile);
  const runOutput = path.resolve(options.runOutput);
  if (stateDirectory !== path.join(projectRoot, '.zensu', 'state')
      || runFile !== path.join(stateDirectory, `autopilot-run-${runId}.json`)
      || path.dirname(runOutput) !== stateDirectory
      || !/^\.apt-[A-Za-z0-9]+$/.test(path.basename(runOutput))) {
    throw new Error('budget storage operands do not match the project');
  }
  const sentinel = path.join(stateDirectory, 'autopilot');
  const paths = [
    stateDirectory, 'directory',
    path.join(stateDirectory, 'autopilot-active.json'), 'regular-or-absent',
    sentinel, 'regular-or-absent',
    `${sentinel}.lock`, 'regular-or-absent',
    `${sentinel}.lockd`, 'directory-or-absent',
    runFile, 'regular', runOutput, 'regular',
  ];
  assertPathsSafe([projectRoot], ...paths);
  const binding = { lockDirectory: stateDirectory, resourcePath: sentinel, ownerPid: process.pid };
  let lease;
  try { lease = core.acquireExternalProcessLock(binding); }
  catch (error) { error.exitCode = 1; throw error; }
  try {
    // Never move these checks or the state/pointer reads outside the lease.
    assertPathsSafe([projectRoot], ...paths);
    const result = mutate();
    try { replaceRegular(runOutput, runFile, [projectRoot]); }
    catch (error) { error.exitCode = 5; throw error; }
    return result;
  } finally {
    try { core.releaseExternalProcessLock({ ...binding, token: lease.token }); }
    catch (error) { error.exitCode = 1; throw error; }
  }
}

module.exports = { updateBudget };
