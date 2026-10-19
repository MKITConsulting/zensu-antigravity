#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');
const runtime = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'work-order-v1.js'));
const supervisor = require(path.join(PLUGIN_ROOT, 'scripts', 'process-supervisor.js'));

const STATE_LIBRARY = path.join(PLUGIN_ROOT, 'hooks', 'lib', 'zensu-autopilot-state.sh');
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const native = require('./worker-launch.js');
const EXIT_CODES = Object.freeze({ success: 0, failure: 1, cancelled: 143 });
const USAGE = native.USAGE;
const parseLauncherArgs = native.parseLauncherArgs;
const runtimeArguments = native.runtimeArguments;
const translate = native.translate;
function boundedNumber(env, name, fallback, min, max) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// A private per-launch shim witness correlates initialization to the resumed
// conversation. Streamed model text is never an initialization signal.
function decisionWitnessStarted(file, conversationId) {
  if (!UUID_RE.test(conversationId || '')) return false;
  let fd;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024
        || (stat.mode & 0o077) || fs.realpathSync(file) !== file
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) return false;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) return false;
    const text = fs.readFileSync(fd, 'utf8');
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) return false;
    // Ignore an incomplete append; a later poll reads it once the newline lands.
    const rows = text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (rows.some(row => !row || row.sessionId !== conversationId)) return false;
    return rows.some(row => row.event === 'PreInvocation' && typeof row.script === 'string' && row.script.length > 0);
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function currentContext(env, projectRoot, sessionKey, orderId) {
  let context;
  try {
    context = runtime.loadContext({ env, projectRoot, sessionKey });
  } catch (_) {
    return null;
  }
  if (!context || context.fault || !context.marker) return null;
  return String(context.marker.orderId).toLowerCase() === orderId.toLowerCase() ? context : null;
}

function watchdog(env, projectRoot, sessionKey, orderId) {
  const context = currentContext(env, projectRoot, sessionKey, orderId);
  if (!context) return null;
  let lease = null;
  try {
    lease = runtime.readState(context.files.lease);
  } catch (_) {
    lease = null;
  }
  const leaseSeconds = lease && Number.isFinite(lease.leaseSeconds) && lease.leaseSeconds > 0 ? lease.leaseSeconds : null;
  return runtime.renew(context, { env, thresholdMs: leaseSeconds ? Math.floor((leaseSeconds * 1000) / 3) : null }).verdict;
}

function releaseRuns(env, projectRoot, sessionKey, orderId) {
  const context = currentContext(env, projectRoot, sessionKey, orderId);
  if (!context) return;
  const below = context.marker.attempt + 1;
  for (const runId of runtime.releasePlan(projectRoot, context.marker.orderId, below)) {
    spawnSync('bash', ['-c', 'source "$1" && autopilot_release_work_order_run "$2" "$3" "$4" "$5"', 'zensu-launcher-release',
      STATE_LIBRARY, runId, context.marker.orderId, String(below), projectRoot], { env, stdio: 'ignore', timeout: 60000 });
  }
}

async function launch(argv, env = process.env) {
  const parsed = parseLauncherArgs(argv);
  if (parsed.error) {
    process.stderr.write(`zensu launcher: ${parsed.error}\n${USAGE}\n`);
    return 2;
  }
  const { options } = parsed;
  env = { ...env, ZENSU_CLIENT_NAME: 'zensu-antigravity', ZENSU_REVIEW_EXECUTION: 'delegated' };
  if (options.prepare) return native.prepare(options, env);
  if (!runtime.tokenPresent(env)) {
    process.stderr.write('zensu launcher: ZENSU_SESSION_TOKEN is not set\n');
    return 2;
  }
  let projectRoot;
  try {
    projectRoot = fs.realpathSync(options.project || process.cwd());
    if (!fs.statSync(projectRoot).isDirectory()) throw new Error('not a directory');
  } catch (_) {
    process.stderr.write('zensu launcher: the project directory cannot be read\n');
    return 2;
  }
  let logFd = null;
  if (options.log) {
    try {
      logFd = fs.openSync(options.log, 'a', 0o600);
    } catch (_) {
      process.stderr.write('zensu launcher: the log file cannot be opened\n');
      return 2;
    }
  }
  const sessionKey = runtime.sessionKeyOf(options.conversation);
  if (!native.prepared(options.conversation, projectRoot)) {
    process.stderr.write('zensu launcher: this conversation was not prepared for this workspace; use --prepare before claiming a work order\n');
    if (logFd !== null) fs.closeSync(logFd);
    return 2;
  }
  let witnessDirectory, witnessFile;
  try {
    witnessDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-worker-run-')));
    fs.chmodSync(witnessDirectory, 0o700);
    witnessFile = path.join(witnessDirectory, 'decisions.jsonl');
    fs.writeFileSync(witnessFile, '', { flag: 'wx', mode: 0o600 });
  } catch {
    if (witnessDirectory) fs.rmSync(witnessDirectory, { recursive: true, force: true });
    if (logFd !== null) fs.closeSync(logFd);
    process.stderr.write('zensu launcher: a private native lifecycle witness could not be created\n');
    return 2;
  }
  const cleanupWitness = () => fs.rmSync(witnessDirectory, { recursive: true, force: true });
  const tickMs = boundedNumber(env, 'ZENSU_LAUNCHER_TICK_MS', 5000, 50, 60000);
  const graceMs = boundedNumber(env, 'ZENSU_LAUNCHER_STOP_GRACE_MS', 10000, 0, 60000);
  const state = { started: false, cancelled: false, leaseLost: false, result: null, stopping: null, pid: null };
  const observeStarted = () => {
    if (!state.started && decisionWitnessStarted(witnessFile, options.conversation)) {
      state.started = true;
      emit({ event: 'session_started', client_session_id: options.conversation });
    }
  };
  const stop = () => {
    if (state.stopping) return state.stopping;
    if (state.pid === null) return Promise.resolve();
    state.stopping = (async () => {
      supervisor.signalGroup(state.pid, 'SIGTERM');
      const remaining = await supervisor.waitForGroupExit(state.pid, graceMs);
      if (remaining !== 'gone') {
        supervisor.signalGroup(state.pid, 'SIGKILL');
        await supervisor.waitForGroupExit(state.pid, 3000);
      }
    })();
    return state.stopping;
  };
  const cancel = () => {
    state.cancelled = true;
    stop();
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, cancel);
  const child = spawn('agy', runtimeArguments(options), {
    cwd: projectRoot,
    env: { ...env, ZENSU_SHIM_DECISIONS: witnessFile },
    detached: true,
    stdio: ['ignore', 'pipe', logFd === null ? 'ignore' : logFd],
  });
  const spawned = await new Promise((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  if (!spawned) {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeListener(signal, cancel);
    if (logFd !== null) fs.closeSync(logFd);
    cleanupWitness();
    emit({ event: 'exited', status: state.cancelled ? 'cancelled' : 'failure', exit_code: null, reason: 'harness_unavailable' });
    return state.cancelled ? EXIT_CODES.cancelled : EXIT_CODES.failure;
  }
  state.pid = child.pid;
  if (state.cancelled) stop();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (logFd !== null) {
      try {
        fs.writeSync(logFd, `${line}\n`);
      } catch (_) {}
    }
    // Native stream records are kept only in the operator's log. The private
    // hook witness supplies session initialization; the lease state supplies completion.

  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const timer = setInterval(() => {
    observeStarted();
    if (state.stopping || state.leaseLost) return;
    if (watchdog(env, projectRoot, sessionKey, options.order) === runtime.VERDICTS.LOST) {
      state.leaseLost = true;
      stop();
    }
  }, tickMs);
  const exit = await exited;
  clearInterval(timer);
  observeStarted();
  await stop();
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeListener(signal, cancel);
  if (logFd !== null) fs.closeSync(logFd);
  cleanupWitness();
  releaseRuns(env, projectRoot, sessionKey, options.order);
  const finalState = runtime.status({ env, projectRoot, sessionKey });
  let status = 'failure';
  let reason = null;
  if (state.cancelled) status = 'cancelled';
  else if (state.leaseLost) reason = 'lease_lost';
  else if (exit.code === 0 && finalState.orderId === options.order && finalState.ended?.delivered === true && finalState.ended?.outcome === 'success') status = 'success';
  else if (exit.code === 0) reason = 'work_order_completion_unverified';
  else reason = state.result && state.result.isError ? 'harness_error' : 'harness_failed';
  emit({ event: 'exited', status, exit_code: exit.code, ...(reason ? { reason } : {}) });
  return EXIT_CODES[status];
}

module.exports = { EXIT_CODES, runtimeArguments, launch, parseLauncherArgs, translate, decisionWitnessStarted };

if (require.main === module) {
  launch(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`zensu launcher: ${error && error.message ? error.message : 'internal fault'}\n`);
    process.exitCode = 2;
  });
}
