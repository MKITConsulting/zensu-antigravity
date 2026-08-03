#!/usr/bin/env node
// zensu-doctor-report.js — read-only diagnostics renderer for /zensu-doctor.
// Reads the plugin's own manifest/hooks, the effective config files, and the
// session state dir, then prints a four-block status table using the ✅/⚠️/❌
// glyphs. NEVER writes, NEVER throws out (every failure degrades to a ⚠️ row),
// ALWAYS exits 0 — the skill decides what to do about warnings.
//
// Tool facts (zensu CLI, node, the agy host binary, the code-forge CLI) and the
// pending-review TTL are resolved by the bash wrapper (`command -v` plus the
// VCS-driver forge detection are shell concerns; the TTL comes from the
// canonical zensu_pending_review_ttl_hours getter so doctor and the real Stop
// enforcer agree) and handed in via ZDOC_* env, so this file stays a pure
// file/JSON reader that a structure test can drive with fixtures.
//
// Inputs (all overridable so the structure test can point at a sandbox):
//   ZENSU_DOCTOR_PLUGIN_DIR  plugin root holding plugin.json + hooks/
//   ZENSU_CONFIG             full-override config file (else HOME + project)
//   HOME, ZENSU_PROJECT_DIR  standard config-resolution roots; session state
//                            is always ZENSU_PROJECT_DIR/.zensu/state
//   ZDOC_NODE/ZENSU/AGY                   tool probe results from the wrapper
//   ZDOC_FORGE_PROVIDER/CLI/STATE/EDITION forge detection from the VCS driver
//   ZDOC_TTL_HOURS           pending-review TTL from the canonical getter
//   ZDOC_NOW_MS              clock override for deterministic tests

'use strict';
var fs = require('fs');
var path = require('path');

var OK = '✅';
var WARN = '⚠️';
var BAD = '❌';

// Mirror of hooks/lib/zensu-config.sh zensu_pending_review_ttl_hours: the
// wrapper passes the canonical value via ZDOC_TTL_HOURS; these apply only to a
// direct (test / no-wrapper) invocation and must stay in lockstep with it.
var TTL_HOURS_FALLBACK = 6;
var TTL_HOURS_MAX = 8760;
// A session-id pointer older than this is a leftover from a finished session.
var STALE_POINTER_DAYS = 7;

var env = process.env;
var out = [];
var warnCount = 0;
var badCount = 0;

function line(glyph, text) {
  if (glyph === WARN) warnCount++;
  else if (glyph === BAD) badCount++;
  out.push('  ' + glyph + '  ' + text);
}
function block(title) {
  out.push('');
  out.push(title);
}
function readJson(p) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, missing: false, err: String((e && e.message) || e) };
  }
}
function pluginDir() {
  if (env.ZENSU_DOCTOR_PLUGIN_DIR) return env.ZENSU_DOCTOR_PLUGIN_DIR;
  return path.resolve(__dirname, '..', '..');
}
function configFiles() {
  if (env.ZENSU_CONFIG) return [env.ZENSU_CONFIG];
  var files = [];
  if (env.HOME) files.push(path.join(env.HOME, '.zensu', 'config.json'));
  if (env.ZENSU_PROJECT_DIR) files.push(path.join(env.ZENSU_PROJECT_DIR, '.zensu', 'config.json'));
  return files;
}

function toolBlock() {
  block('CLI & tooling');
  // Every Zensu operation in this plugin is a typed `zensu` CLI call, so a
  // missing binary is a hard blocker here, not a nice-to-have.
  var z = env.ZDOC_ZENSU || 'absent';
  if (z === 'authed') line(OK, 'zensu CLI: installed and authenticated');
  else if (z === 'present') line(WARN, 'zensu CLI: installed but not authenticated — run `zensu auth login`');
  else line(BAD, 'zensu CLI: not found on PATH — every Zensu command in this plugin goes through it');

  var n = env.ZDOC_NODE || '';
  if (n) line(OK, 'node: ' + n);
  else line(BAD, 'node: not found on PATH — the plugin hooks require node');

  // agy: the Antigravity host binary. Its absence is only a warning — the IDE
  // can drive the plugin without the CLI ever being on PATH.
  var a = env.ZDOC_AGY || '';
  if (a) line(OK, 'agy host: found at ' + a);
  else line(WARN, 'agy host: `agy` not found on PATH — fine for IDE-only use; the CLI plugin dir needs it');

  // Forge CLI (code host): the wrapper detects the repo's provider through the
  // VCS driver and hands us ZDOC_FORGE_* — so we name the RIGHT CLI (gh for
  // GitHub, glab for GitLab) and its auth state, instead of hard-probing gh and
  // falsely telling a GitLab checkout that "gh is missing".
  var fp = env.ZDOC_FORGE_PROVIDER || 'unknown';
  var fc = env.ZDOC_FORGE_CLI || '';
  var fst = env.ZDOC_FORGE_STATE || 'missing';
  var fed = env.ZDOC_FORGE_EDITION || '';
  var pname = fp === 'github' ? 'GitHub' : (fp === 'gitlab' ? 'GitLab' : '');
  var plabel = pname + (fed && fed !== 'cloud' ? ' (' + fed + ')' : '');
  if (fp === 'unknown' || !fc || !pname) {
    line(WARN, 'forge CLI: no GitHub/GitLab remote detected — needs a repo with a GitHub (gh) or GitLab (glab) remote (or ZENSU_VCS_PROVIDER set for a self-hosted host)');
  } else if (fst === 'ready') {
    line(OK, plabel + ' CLI (' + fc + '): installed and authenticated');
  } else if (fst === 'unauthed') {
    line(WARN, plabel + ' CLI (' + fc + '): installed but not authenticated — run `' + fc + ' auth login` (needed to open/review PRs)');
  } else {
    line(WARN, plabel + ' CLI (' + fc + '): not found on PATH — PR create/review for ' + pname + ' will be unavailable');
  }
}

// Collect the hook scripts a hooks.json wires up. Antigravity commands are
// shim-wrapped — `bash <root>/hooks/antigravity/antigravity-shim.sh <bare>.sh`
// — so the wired script is the shim's ARGUMENT, not a path component. A plain
// `<root>/hooks/<name>.sh` command form is accepted too.
function collectWired(data) {
  var wired = {};
  var shimSeen = false;
  function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.command === 'string') {
      var cmd = o.command;
      var m = cmd.match(/antigravity-shim\.sh\s+(\S+)/);
      if (m) {
        shimSeen = true;
        wired[path.basename(m[1])] = true;
      } else {
        var d = cmd.match(/\/hooks\/([A-Za-z0-9._-]+\.sh)/);
        if (d) wired[d[1]] = true;
      }
    }
    Object.keys(o).forEach(function (k) { walk(o[k]); });
  }
  walk(data);
  return { wired: wired, shimSeen: shimSeen };
}

function pluginBlock() {
  block('Plugin integrity');
  var dir = pluginDir();

  var pj = readJson(path.join(dir, 'plugin.json'));
  if (!pj.ok) {
    line(BAD, 'plugin.json: ' + (pj.missing ? 'missing at ' + dir : 'invalid JSON — ' + pj.err));
  } else {
    var pv = pj.data && pj.data.version;
    var pn = (pj.data && pj.data.name) || 'zensu';
    if (!pv) {
      line(BAD, 'plugin.json: no version field — the release train and upgrade checks need it');
    } else if (!/^\d+\.\d+\.\d+$/.test(String(pv))) {
      line(WARN, 'plugin.json: version "' + pv + '" is not semver (X.Y.Z)');
    } else {
      line(OK, 'plugin.json: ' + pn + ' v' + pv);
    }
  }

  // The runtime-home pointer every hook and skill reads to find the staged
  // plugin. A stale pointer is the single most common "nothing fires" cause.
  var pointer = env.HOME ? path.join(env.HOME, '.zensu', 'plugin-root') : '';
  if (!pointer) {
    line(WARN, 'plugin-root pointer: HOME is unset — cannot resolve ~/.zensu/plugin-root');
  } else {
    var target = '';
    try { target = String(fs.readFileSync(pointer, 'utf8')).trim(); } catch (e) { target = ''; }
    if (!target) {
      line(WARN, 'plugin-root pointer: ' + pointer + ' missing or empty — run install.sh to stage the plugin');
    } else if (!fs.existsSync(path.join(target, 'hooks', 'antigravity', 'antigravity-shim.sh'))) {
      line(BAD, 'plugin-root pointer: ' + pointer + ' -> ' + target + ' has no hooks/antigravity/antigravity-shim.sh — stale pointer, re-run install.sh');
    } else {
      line(OK, 'plugin-root pointer: ' + target);
    }
  }

  // The installed hooks.json (install.sh renders it from hooks.json.template);
  // in a source checkout only the template exists, so fall back to it.
  var hooksPath = path.join(dir, 'hooks.json');
  var hj = readJson(hooksPath);
  if (hj.missing) {
    hooksPath = path.join(dir, 'hooks.json.template');
    hj = readJson(hooksPath);
    if (hj.ok) line(WARN, 'hooks.json: not rendered yet — reading hooks.json.template (run install.sh to stage the real file)');
  }
  if (!hj.ok) {
    line(BAD, 'hooks.json: ' + (hj.missing ? 'missing at ' + dir : 'invalid JSON in ' + hooksPath + ' — ' + hj.err));
    return;
  }

  var collected = collectWired(hj.data);
  var wired = collected.wired;
  if (collected.shimSeen && !fs.existsSync(path.join(dir, 'hooks', 'antigravity', 'antigravity-shim.sh'))) {
    line(BAD, 'hooks wiring: hooks/antigravity/antigravity-shim.sh is missing — every wrapped hook silently never runs');
  }

  var onDisk = {};
  try {
    fs.readdirSync(path.join(dir, 'hooks')).forEach(function (f) {
      if (/\.sh$/.test(f)) onDisk[f] = true;
    });
  } catch (e) { /* no hooks dir */ }

  var missing = Object.keys(wired).filter(function (f) { return !onDisk[f]; }).sort();
  var unwired = Object.keys(onDisk).filter(function (f) { return !wired[f]; }).sort();
  if (missing.length) {
    line(BAD, 'hooks wiring: ' + missing.length + ' referenced but missing on disk — ' + missing.join(', '));
  }
  if (unwired.length) {
    line(WARN, 'hooks wiring: ' + unwired.length + ' script(s) on disk not referenced in ' + path.basename(hooksPath) + ' — ' + unwired.join(', ') + ' (some are intentionally unwired)');
  }
  if (!missing.length && !unwired.length) {
    line(OK, 'hooks wiring: all ' + Object.keys(wired).length + ' hooks referenced in ' + path.basename(hooksPath) + ' exist on disk');
  }
}

function walkQuotedBooleans(obj, prefix, hits) {
  if (obj === null || typeof obj !== 'object') return;
  Object.keys(obj).forEach(function (k) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    var v = obj[k];
    var dotted = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string' && (v === 'true' || v === 'false')) {
      hits.push(dotted + ' = "' + v + '"');
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      walkQuotedBooleans(v, dotted, hits);
    }
  });
}
function configBlock() {
  block('Config');
  var anyPresent = false;
  configFiles().forEach(function (f) {
    var r = readJson(f);
    if (r.missing) return;
    anyPresent = true;
    if (!r.ok) {
      line(BAD, 'config: invalid JSON in ' + f + ' — ' + r.err + ' (the whole file is ignored, defaults apply)');
      return;
    }
    var hits = [];
    walkQuotedBooleans(r.data, '', hits);
    if (hits.length) {
      line(WARN, 'config: quoted boolean(s) in ' + f + ' are ignored by strict `===` checks — ' + hits.join('; ') + ' (drop the quotes)');
    } else {
      line(OK, 'config: valid JSON, no quoted-boolean traps in ' + f);
    }
  });
  if (!anyPresent) {
    line(OK, 'config: no config file present — built-in defaults apply');
  }
}

function ttlHours() {
  var n = Number(env.ZDOC_TTL_HOURS);
  if (Number.isInteger(n) && n >= 0 && n <= TTL_HOURS_MAX) return n;
  return TTL_HOURS_FALLBACK;
}
function stateBlock(nowMs) {
  block('Session state');
  var projectRoot = path.resolve(env.ZENSU_PROJECT_DIR || '.');
  var dir = path.join(projectRoot, '.zensu', 'state');
  var entries;
  try {
    entries = fs.readdirSync(dir).sort();
  } catch (e) {
    line(OK, 'state: ' + dir + ' does not exist yet — nothing to clean');
    return;
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    line(OK, 'state: ' + dir + ' is writable');
  } catch (e) {
    line(BAD, 'state: ' + dir + ' is not writable — chain markers cannot be recorded');
  }

  // Per-session TDD/review documents. There is no CAS core in this port, so
  // "valid" means the JSON parses — an unparseable document makes the hooks
  // fail closed.
  var phaseDocs = entries.filter(function (f) { return /^tdd-phase-.+\.json$/.test(f); });
  var invalid = [];
  phaseDocs.forEach(function (f) {
    var r = readJson(path.join(dir, f));
    if (!r.ok) invalid.push(f);
  });
  if (!phaseDocs.length) {
    line(OK, 'state: no TDD phase documents yet');
  } else {
    var valid = phaseDocs.length - invalid.length;
    if (valid) line(OK, 'state: ' + valid + ' valid TDD phase document(s)');
    if (invalid.length) {
      line(BAD, 'state: ' + invalid.length + ' unparseable TDD phase document(s) — hooks fail closed; inspect ' + invalid.join(', '));
    }
  }

  var rounds = entries.filter(function (f) { return /^rounds-.+\.json$/.test(f); });
  if (rounds.length) {
    line(OK, 'state: ' + rounds.length + ' auto-fix round counter(s) — cleared per task by `--tdd-begin`');
  }
  var stopBlocks = entries.filter(function (f) { return /\.stopblocks$/.test(f); });
  if (stopBlocks.length) {
    line(OK, 'state: ' + stopBlocks.length + ' Stop-block budget file(s)');
  }

  // Leftover session-id pointers from finished sessions.
  var stale = [];
  entries.filter(function (f) { return /^session-id-.+\.txt$/.test(f); }).forEach(function (f) {
    try {
      var st = fs.statSync(path.join(dir, f));
      if ((nowMs - st.mtimeMs) / 86400000 > STALE_POINTER_DAYS) stale.push(f);
    } catch (e) { /* raced away */ }
  });
  if (stale.length) {
    line(WARN, 'state: ' + stale.length + ' session-id pointer(s) older than ' + STALE_POINTER_DAYS + ' days — leftovers from finished sessions, safe to clear');
  }

  var pr = path.join(dir, 'pending-review.json');
  try {
    var prSt = fs.statSync(pr);
    var ageH = (nowMs - prSt.mtimeMs) / 3600000;
    var ttl = ttlHours();
    if (ageH > ttl) {
      line(WARN, 'state: pending-review.json is ' + Math.floor(ageH) + 'h old (TTL ' + ttl + 'h) — expired, safe to clear');
    } else {
      line(OK, 'state: pending-review.json present and within its ' + ttl + 'h TTL');
    }
  } catch (e) { /* no pending-review marker */ }
}

function main() {
  var nowMs = Number(env.ZDOC_NOW_MS);
  if (!isFinite(nowMs) || nowMs <= 0) nowMs = Date.now();
  out.push('Zensu doctor — read-only setup diagnostics');
  toolBlock();
  pluginBlock();
  configBlock();
  stateBlock(nowMs);
  out.push('');
  if (badCount) out.push('Summary: ' + badCount + ' ' + BAD + '  ' + warnCount + ' ' + WARN + '  — resolve the ❌ items first.');
  else if (warnCount) out.push('Summary: ' + warnCount + ' ' + WARN + '  — no blockers; warnings are optional to address.');
  else out.push('Summary: all checks green ' + OK);
  process.stdout.write(out.join('\n') + '\n');
}

try { main(); } catch (e) {
  process.stdout.write('  ' + WARN + '  zensu-doctor: diagnostics renderer failed — ' + String((e && e.message) || e) + '\n');
}
process.exit(0);
