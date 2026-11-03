#!/usr/bin/env node
'use strict';

// A native grant is deliberately separate from neutral gate verdicts. It is
// considered only after the whole batch passed and its launch was recorded.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const principal = require('../lib/runtime-principal-v1.js');
const provenance = require('./native-agent-provenance.js');
const paths = require('./session-paths.js');
const READ_TOOLS = ['find_by_name', 'grep_search', 'view_file'];

function agentDeclaration(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw Error('Agent frontmatter is missing');
  const field = name => {
    const rows = match[1].split(/\r?\n/).filter(row => row.startsWith(`${name}:`));
    if (rows.length !== 1) throw Error('Agent frontmatter is ambiguous');
    return rows[0].slice(name.length + 1).trim();
  };
  const name = field('name'), model = field('model');
  const tools = JSON.parse(field('tools'));
  if (!Array.isArray(tools)) throw Error('Native tools must be an array');
  return { name, model, tools };
}

function ownProfiles(root) {
  const manifest = JSON.parse(provenance.readHostFile(path.join(root, 'plugin.json'), 256 * 1024));
  if (manifest.name !== 'zensu') throw Error('Plugin identity is unavailable');
  // Native agy discovers profiles from agents/, not an ignored manifest array.
  const entries = fs.readdirSync(path.join(root, 'agents')).filter(name => name.endsWith('.md')).sort();
  if (!entries.length) throw Error('Agent inventory is unavailable');
  const profiles = new Map();
  for (const name of entries) {
    const relative = `./agents/${name}`;
    if (typeof relative !== 'string' || !/^\.\/agents\/[A-Za-z0-9_-]+\.md$/.test(relative)) throw Error('Agent path is unsafe');
    const declaration = agentDeclaration(provenance.readHostFile(path.join(root, relative), 256 * 1024));
    if (relative !== `./agents/${declaration.name}.md` || profiles.has(declaration.name)) throw Error('Agent identity is ambiguous');
    profiles.set(declaration.name, declaration);
  }
  return profiles;
}

function strictEnabled(root, project, environment) {
  const result = cp.spawnSync('bash', ['-c', 'source "$1/hooks/lib/zensu-config.sh" && zensu_hook_enabled_strict reviewerSpawnAutoAllow', 'native-grant', root], {
    env: { ...environment, ZENSU_PROJECT_DIR: project }, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  return result.status === 0;
}

function inspectReadOnlyDispatch(options = {}) {
  const evidencePaths = [];
  try {
    const root = fs.realpathSync.native(options.pluginRoot || paths.pluginRoot());
    evidencePaths.push(path.join(root, 'plugin.json'));
    const profiles = ownProfiles(root);
    const expected = [...new Set([...principal.REVIEWER_TYPES, ...principal.EVIDENCE_WORKER_TYPES])]
      .filter(name => name.startsWith('zensu-') && !principal.PLM_TYPES.has(name));
    for (const name of expected) {
      evidencePaths.push(path.join(root, 'agents', `${name}.md`));
      const profile = profiles.get(name);
      if (!profile || profile.model !== 'inherit' || profile.tools.length !== READ_TOOLS.length
          || JSON.stringify([...profile.tools].sort()) !== JSON.stringify(READ_TOOLS)) throw Error(`The registered ${name} profile does not have exactly the native read tools`);
    }
    const environment = options.environment || process.env;
    if (!options.workspaceRoot) throw Error('The bound workspace is unavailable');
    evidencePaths.push(...(environment.ZENSU_CONFIG ? [environment.ZENSU_CONFIG] : [
      ...(environment.HOME ? [path.join(environment.HOME, '.zensu/config.json')] : []),
      path.join(options.workspaceRoot, '.zensu/config.json'),
    ]));
    return strictEnabled(root, options.workspaceRoot, environment)
      ? { status: 'ok', findings: ['Native reviewer auto-allow is enabled for audited reviewer and evidence-worker batches after all gates accept.'], evidencePaths }
      : { status: 'blocked', findings: ['Native reviewer auto-allow is withdrawn by a false or unusable configuration; normal host permission handling remains active.'], evidencePaths };
  } catch (error) { return { status: 'unknown', findings: [error.message], evidencePaths }; }
}

function mayAllow(payload, authorization, options = {}) {
  try {
    const root = fs.realpathSync.native(options.pluginRoot || paths.pluginRoot());
    const inspected = provenance.inspectLaunch(payload);
    if (!inspected.length || authorization?.authorized !== true) return false;
    const receipt = authorization.receipt;
    const entries = inspected.map(({ canonicalPayload, ...entry }) => entry);
    if (!receipt || receipt.schema !== provenance.SCHEMA || receipt.parentSessionId !== payload.session_id
        || receipt.spawnStepIndex !== payload.step_idx || receipt.workspaceRoot !== payload.workspace_root
        || receipt.pluginRoot !== root || typeof receipt.runtimeDigest !== 'string' || !receipt.runtimeDigest
        || JSON.stringify(receipt.entries) !== JSON.stringify(entries)) return false;
    const profiles = ownProfiles(root);
    for (const entry of entries) {
      if (!entry.typeName.startsWith('zensu-') || principal.PLM_TYPES.has(entry.typeName)
          || !(principal.REVIEWER_TYPES.has(entry.typeName) || principal.EVIDENCE_WORKER_TYPES.has(entry.typeName))) return false;
      const profile = profiles.get(entry.typeName);
      if (!profile || profile.model !== 'inherit' || profile.tools.length !== READ_TOOLS.length
          || JSON.stringify([...profile.tools].sort()) !== JSON.stringify(READ_TOOLS)) return false;
    }
    return strictEnabled(root, receipt.workspaceRoot, options.environment || process.env);
  } catch { return false; }
}

if (require.main === module) {
  let allowed = false;
  try {
    const raw = fs.readFileSync(0);
    if (raw.length <= 2 * 1024 * 1024) {
      const input = JSON.parse(raw.toString('utf8'));
      allowed = mayAllow(input.payload, input.authorization);
    }
  } catch { /* A grant failure preserves the normal native permission path. */ }
  process.stdout.write(JSON.stringify({ allow: allowed }));
}
module.exports = { agentDeclaration, ownProfiles, strictEnabled, inspectReadOnlyDispatch, mayAllow };
