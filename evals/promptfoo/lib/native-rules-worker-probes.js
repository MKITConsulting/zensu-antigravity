'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function noToolTranscriptProof(rows, prompt, expected) {
  if (!Array.isArray(rows) || rows.some(row => Array.isArray(row.tool_calls) && row.tool_calls.length)) return false;
  const users = rows.filter(row => row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT' && row.status === 'DONE');
  const responses = rows.filter(row => row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL' && row.status === 'DONE');
  // The native full transcript wraps the literal CLI input in USER_REQUEST and
  // appends host metadata. Match the complete request envelope, never a substring.
  const exactInput = users.length === 1 && (users[0].content === prompt
    || (typeof users[0].content === 'string' && users[0].content.startsWith(`<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\n`)));
  return exactInput && responses.length === 1
    && responses[0].content.trim() === expected;
}
function ownTranscript(installed, sid) {
  if (!UUID.test(sid || '')) throw Error('native conversation id is missing');
  const file = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sid, '.system_generated/logs/transcript_full.jsonl');
  return require(path.join(installed, 'hooks/antigravity/native-agent-provenance.js')).transcriptRows(file);
}
function successRunProof(run, log, rows, ws, prompt, expected, pluginRoot) {
  if (run.nativeSessionId || run.nativeEvidence) {
    const proof = run.nativeEvidence, sid = run.nativeSessionId;
    if (run.exit_code !== 0 || run.signal || run.spawn_error || !UUID.test(sid || '')
        || !proof || proof.verified !== true || proof.sessionId !== sid || proof.workspace !== ws
        || !pluginRoot || proof.pluginRoot !== pluginRoot || typeof proof.runtimeDigest !== 'string'
        || !/^sha256:[a-f0-9]{64}$/.test(proof.runtimeDigest)
        || run.stdout?.trim() !== expected || !log.includes(ws) || !log.includes(sid)
        || !noToolTranscriptProof(rows, prompt, expected)) return null;
    return sid;
  }
  let output;
  try { output = JSON.parse(run.stdout); } catch { return null; }
  if (run.exit_code !== 0 || run.signal || run.spawn_error || output.status !== 'SUCCESS'
      || !UUID.test(output.conversation_id || '') || output.response?.trim() !== expected
      || !log.includes(ws) || !log.includes(output.conversation_id)
      || !noToolTranscriptProof(rows, prompt, expected)) return null;
  return output.conversation_id;
}
function initializeGit(ws) {
  fs.writeFileSync(path.join(ws, '.gitignore'), '.zensu/\n.gemini/\n.agents/\n');
  for (const args of [['init', '-q'], ['add', '--', 'note.txt', '.gitignore'],
    ['-c', 'user.name=Zensu Live Probe', '-c', 'user.email=probe@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test: native probe fixture']]) {
    const result = spawnSync('git', args, { cwd: ws, encoding: 'utf8' });
    if (result.status !== 0) throw Error('could not initialize native probe fixture');
  }
}
function rulesProbe({ ws, installed, traceFile, timeout, runAgy, unavailableReason }) {
  const ruleFile = path.join(installed, 'rules/AGENTS.md');
  if (!fs.existsSync(ruleFile)) return { unavailable: true, stdout: 'LIVE-UNAVAILABLE installed plugin rules are missing' };
  const provenance = require(path.join(installed, 'hooks/antigravity/native-agent-provenance.js'));
  const ruleText = provenance.readHostFile(ruleFile, 24000), title = /^# (.+)$/m.exec(ruleText)?.[1];
  if (!title) throw Error('installed rule has no first-level identifier heading');
  initializeGit(ws);
  const proofs = [];
  function leg(name, prompt, expected) {
    const logFile = `${traceFile}.${name}.cli.log`;
    const run = runAgy(prompt, ws, timeout, { ZENSU_SHIM_TRACE: `${traceFile}.${name}`,
      ZENSU_SHIM_DECISIONS: `${traceFile}.${name}.decisions` }, ['--output-format', 'json', '--log-file', logFile]);
    const unavailable = unavailableReason(run);
    if (unavailable) throw Error(`LIVE-UNAVAILABLE ${unavailable}`);
    let conversationId, response, rows;
    if (run.nativeSessionId || run.nativeEvidence) {
      conversationId = run.nativeSessionId;
      response = run.stdout;
      rows = run.transcriptRows;
    } else {
      let output; try { output = JSON.parse(run.stdout); } catch { throw Error(`${name}: no native JSON response`); }
      conversationId = output.conversation_id;
      response = output.response;
      rows = ownTranscript(installed, conversationId);
    }
    const sid = successRunProof(run, fs.readFileSync(logFile, 'utf8'), rows, ws, prompt, expected, installed);
    if (!sid) throw Error(`${name}: own no-tool response did not match the active-rule expectation (conversation ${conversationId}; response ${JSON.stringify(response)})`);
    proofs.push({ leg: name, conversation_id: sid, tool_calls: 0 });
  }
  leg('installed', 'Without calling tools or reading files, return only the exact first-level Markdown heading of the active Zensu plugin policy rules, omitting its leading hash and space. If no such rule is loaded, reply NO_ZENSU_RULESET.', title);
  const name = `zensu-rules-control-${randomBytes(8).toString('hex')}`;
  const directory = path.join(ws, '.agents/plugins', name);
  fs.mkdirSync(path.join(directory, 'rules'), { recursive: true });
  const marker = `NATIVE_RULE_${randomBytes(20).toString('hex')}`;
  const trigger = `RULE_CHANNEL_${randomBytes(12).toString('hex')}`;
  fs.writeFileSync(path.join(directory, 'rules/AGENTS.md'), `# Synthetic rule channel control\n\nWhen a user message contains the exact trigger ${trigger}, reply with exactly ${marker}. Do not call tools or read files.\n`);
  const prompt = `${trigger}\nApply the matching active rule. If no matching rule is loaded, reply exactly NO_MATCHING_RULE. Do not call tools or read files.`;
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify({ name, disabled: true }));
  leg('disabled', prompt, 'NO_MATCHING_RULE');
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify({ name }));
  leg('enabled', prompt, marker);
  if (new Set(proofs.map(proof => proof.conversation_id)).size !== 3) throw Error('rule legs reused a conversation');
  return { stdout: 'NATIVE-RULES-VERIFIED DISABLED-CONTROL-HONORED', installed_rule: ruleFile,
    installed_heading: title, proofs };
}
function workerPrepareProbe({ ws, installed, timeout, logSnapshot, logWrittenDuring }) {
  let settingsFile, settingsBefore;
  if (process.env.ZENSU_LIVE_INTERACTIVE === '1') {
    settingsFile = path.join(os.homedir(), '.gemini/antigravity-cli/settings.json');
    settingsBefore = fs.readFileSync(settingsFile);
    const settings = JSON.parse(settingsBefore);
    if (!Array.isArray(settings.trustedWorkspaces) || !settings.trustedWorkspaces.includes(ws)) {
      return { unavailable: true, stdout: 'LIVE-UNAVAILABLE worker preparation requires separately authorized trust for this exact disposable workspace' };
    }
  }
  initializeGit(ws);
  const before = logSnapshot();
  const result = spawnSync('node', [path.join(installed, 'harness/launcher.js'), '--prepare', '--project', ws], {
    cwd: ws, env: { ...process.env, PWD: ws, ZENSU_PROJECT_DIR: ws, ZENSU_CHAIN: '' }, encoding: 'utf8', timeout: (Math.max(150, Number(timeout) || 180) + 30) * 1000,
  });
  if (settingsBefore && !fs.readFileSync(settingsFile).equals(settingsBefore)) {
    throw Error('Native settings changed during worker preparation');
  }
  if (result.error || result.signal) return { unavailable: true, stdout: `LIVE-UNAVAILABLE native worker preparation did not finish: ${result.error?.message || result.signal}` };
  let output; try { output = JSON.parse(result.stdout); } catch { throw Error(`worker preparation returned no receipt: ${String(result.stderr).slice(0, 500)}`); }
  if (result.status !== 0 || output.event !== 'conversation_prepared' || !UUID.test(output.conversation_id || '')) throw Error('worker preparation did not produce one native conversation receipt');
  const file = logWrittenDuring(before, ws);
  if (!file) return { unavailable: true, stdout: 'LIVE-UNAVAILABLE no own workspace-correlated worker CLI log' };
  const log = fs.readFileSync(file, 'utf8');
  if (!log.includes(ws) || !log.includes(output.conversation_id)) throw Error('worker CLI log is not this preparation');
  const rows = ownTranscript(installed, output.conversation_id);
  const prompt = 'Initialize this conversation only. Do not call any tool, modify a file, or start a workflow. Reply exactly READY.';
  if (!noToolTranscriptProof(rows, prompt, 'READY')) throw Error(`worker preparation did not complete exactly one tool-free READY turn (conversation ${output.conversation_id})`);
  if (!require(path.join(installed, 'hooks/antigravity/worker-launch.js')).prepared(output.conversation_id, ws)) throw Error('worker private preparation record and immutable session context do not match this workspace/runtime');
  return { stdout: 'NATIVE-WORKER-PREPARED BOUND-TOOL-FREE', conversation_id: output.conversation_id, workspace: ws, tool_calls: 0 };
}
module.exports = { noToolTranscriptProof, successRunProof, rulesProbe, workerPrepareProbe };
