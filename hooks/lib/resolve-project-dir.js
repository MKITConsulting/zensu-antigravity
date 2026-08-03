#!/usr/bin/env node
'use strict';

// Cwd-independent project-dir recovery for NON-HOOK state writers.
//
// Antigravity exports the project dir to HOOKS only: the shim reads the
// workspace root out of the tool payload and exports ZENSU_PROJECT_DIR before it
// runs a wrapped hook. A plain shell invocation of a state writer — the model
// running `bash .../hooks/lib/zensu-log.sh --chain-done` (or --tdd-*, --phase,
// --workflow-*) through `run_command` — inherits none of that. Those calls used
// to fall back to `${ZENSU_PROJECT_DIR:-.}`, i.e. the terminal's cwd, so from a
// subdirectory or a git worktree they anchored the chain state to the WRONG
// directory: the writer wrote `<subdir>/.zensu/state/...` while the Stop-hook
// enforcer kept reading `<workspace>/.zensu/state/...`, and the review chain
// deadlocked because the flag it waited for was written somewhere else.
//
// The recovery reuses this plugin's OWN pointer mechanism rather than any
// transcript: the lazy-init hook (the SessionStart replacement) writes the
// project-scoped session pointer `.zensu/state/session-id-current.txt` into the
// real project dir on the first pre-* hook of a turn. That pointer file IS the
// marker of "this is the directory the hooks anchor their state to", so the
// nearest ancestor of the caller that carries one is the project dir the
// enforcer will read back.
//
// Resolution order:
//   1. ZENSU_PROJECT_DIR when already set  → echoed verbatim, zero behavior
//      change for every hook-side caller.
//   2. Nearest ancestor of the start dir carrying `.zensu/state/session-id-current.txt`
//      → the session pointer written by lazy-init. Nearest wins, so a nested
//      worktree that genuinely has its own armed session keeps its own state.
//   3. Nearest ancestor carrying a plain `.zensu/state` directory → a project
//      whose pointer has not been written yet this session (state dir already
//      seeded by an earlier run).
//   4. The start dir itself → identical to the historical `.` fallback, just
//      spelled absolutely.
//
// Deliberately git-free: the walk needs no VCS, so it behaves the same in a
// worktree, a submodule, an export, or a plain directory.
//
// Usage: node resolve-project-dir.js [start-dir]

const fs = require('fs');
const path = require('path');

const POINTER_REL = path.join('.zensu', 'state', 'session-id-current.txt');
const STATE_REL = path.join('.zensu', 'state');
const MAX_DEPTH = 64;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

function startDir() {
  const raw = process.argv[2] || '';
  let base;
  try {
    base = raw ? path.resolve(raw) : process.cwd();
  } catch (_) {
    base = path.resolve('.');
  }
  return base;
}

// Walk the start dir and its ancestors, nearest first, and return the first one
// for which `probe` holds. Bounded so a pathological path can never spin.
function walkUp(from, probe) {
  let dir = from;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (probe(dir)) return dir;
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

function main() {
  const declared = process.env.ZENSU_PROJECT_DIR || '';
  if (declared) {
    process.stdout.write(declared);
    return 0;
  }

  const from = startDir();

  const byPointer = walkUp(from, (d) => isFile(path.join(d, POINTER_REL)));
  if (byPointer) {
    process.stdout.write(byPointer);
    return 0;
  }

  const byStateDir = walkUp(from, (d) => isDir(path.join(d, STATE_REL)));
  if (byStateDir) {
    process.stdout.write(byStateDir);
    return 0;
  }

  process.stdout.write(from);
  return 0;
}

process.exit(main());
