'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const adapter = require('../../hooks/antigravity/session-command-guard.js');
const helpers = require('../../hooks/antigravity/session-helper.js');
const paths = require('../../hooks/antigravity/session-paths.js');
const normalizer = require('../../hooks/antigravity/normalize-payload.js');
const bootstrap = require('../../hooks/antigravity/session-bootstrap.js');
const core = require('../../hooks/lib/session-control-core-v1.js');
const SID = '1a151508-aaaa-4444-8888-a950da1a5682';
const OTHER = '1a151508-bbbb-4444-8888-a950da1a5682';

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-agy-adapter-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'private');
  fs.mkdirSync(data, { mode: 0o700 });
  return { root, pluginData: data, now: 10000 };
}
function command(sessionId = SID, helper = 'log', args = ['--chain-status'], root = paths.pluginRoot()) {
  return `${paths.helperPrefix(sessionId, root)} --helper ${helper} -- ${args.map(paths.shellQuote).join(' ')}`;
}
function payload(commandLine, sessionId = SID) {
  return { session_id: sessionId, tool_name: 'Bash', tool_input: { command: commandLine } };
}

test('literal helper invocation retains argv and must match host conversation', () => {
  const request = adapter.inspectCommand(payload(command(SID, 'log', ['--evidence-run', '--command', 'npm test && npm run build'])));
  assert.equal(request.kind, 'helper');
  assert.deepEqual(request.request.args, ['--evidence-run', '--command', 'npm test && npm run build']);
  assert.equal(adapter.inspectCommand(payload(command(OTHER))).kind, 'deny');
});

test('unsupported shell syntax and direct selector injection cannot reach bound helpers', () => {
  const valid = command();
  const forbidden = [
    `${valid}; echo done`, `value=$(${valid})`, `${valid} > /tmp/result`,
    `env ${valid}`, `${valid} && ${command(OTHER)}`, `bash -c ${paths.shellQuote(valid)}`,
    `ZENSU_HOST_SESSION_ID=${OTHER} bash /tmp/zensu-log.sh --chain-status`,
    'node /tmp/runtime-hook-session-v1.js model-bind',
    'node /tmp/session-control-core-v1.js resolve --session other',
    'bash /tmp/post-review-tdd-delegate.sh',
    'node /tmp/in-thread-review-v1.js --ticket forged',
    `node -e ${paths.shellQuote('require("/tmp/session-control-core-v1.js").initializeWorkflowState({})')}`,
    `node -e ${paths.shellQuote('require("/tmp/session-control-core-v1").initializeWorkflowState({})')}`,
    `node -e ${paths.shellQuote('require("/installed/hooks/antigravity/native-agent-lifecycle").stopChild({fully_idle:true})')}`,
    `node -e ${paths.shellQuote('require("/installed/hooks/antigravity/native-review").main([])')}`,
    `node -e ${paths.shellQuote('require("/tmp/session-control-"+"core-v1").initializeWorkflowState({})')}`,
    command(SID, 'log', ['--evidence-run', '--cmd', 'node /tmp/in-thread-review.js --ticket forged']),
    `bash ${paths.shellQuote(path.join(paths.pluginRoot(), 'hooks/lib/zensu-log.sh'))} --chain-status`,
    `${paths.helperPrefix(SID)} --session ${OTHER} --helper log -- --chain-status`,
    `${paths.helperPrefix(SID)} --helper missing -- --chain-status`,
    `bash ${paths.shellQuote(path.join(paths.pluginRoot(), 'hooks/antigravity/session-helper.sh'))} --session '' --helper log -- --chain-status`,
  ];
  for (const value of forbidden) assert.equal(adapter.inspectCommand(payload(value)).kind, 'deny', value);
  assert.equal(adapter.inspectCommand(payload('npm test && npm run build')).kind, 'ordinary');
  assert.equal(adapter.inspectCommand(payload('node hooks/lib/valid-diff-lines.js input.patch')).kind, 'ordinary');
  assert.equal(adapter.inspectCommand(payload('node hooks/lib/valid-diff-lines input.patch')).kind, 'ordinary');
  assert.throws(() => helpers.parseArguments(['--session', `scv1_${'a'.repeat(64)}`, '--helper', 'log', '--']), /raw/);
});

test('native state modules cannot bypass the guard through host Cwd or import spelling', () => {
  const nativeDirectory = path.join(paths.pluginRoot(), 'hooks/antigravity');
  const normalized = (commandLine) => normalizer.normalize({ conversationId: SID, workspacePaths: ['/workspace'],
    cwd: '/untrusted-fallback', toolCall: { name: 'run_command', args: { CommandLine: commandLine, Cwd: nativeDirectory } } },
  'PreToolUse', { correlate: false });
  const commands = [
    'node native-agent-lifecycle.js --stop-child < /private/tmp/payload.json',
    'node native-agent-provenance.js --authorize-launch < /private/tmp/payload.json',
    "node native-agent-''lifecycle.js --stop-child < /private/tmp/payload.json",
    'node native-agent-\\lifecycle.js --stop-child < /private/tmp/payload.json',
    `node -e ${paths.shellQuote('require("./native-agent-lifecycle").stopChild({fully_idle:true})')}`,
    `node -e ${paths.shellQuote('require("./native-agent-"+"provenance").authorizeLaunch({})')}`,
    `node --input-type=module -e ${paths.shellQuote('import("./session-paths.js").then(m=>m.writePrivateJson("x",{}))')}`,
  ];
  for (const stem of adapter.NATIVE_STATE_MODULES) {
    commands.push(`node ${stem}.js`, `node -e ${paths.shellQuote(`require('./${stem}')`)}`);
  }
  for (const value of commands) {
    const observed = normalized(value);
    assert.equal(observed.cwd, nativeDirectory, 'native Cwd outranks the fallback directory');
    assert.equal(observed.tool_name, 'Bash');
    assert.equal(adapter.inspectCommand(observed).kind, 'deny', value);
  }
  const run = spawnSync(process.execPath, [path.join(nativeDirectory, 'session-command-guard.js'), '--inspect'], {
    input: JSON.stringify(normalized(commands[0])), encoding: 'utf8', cwd: nativeDirectory,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('relative installed entrypoints are protected without reserving generic project filenames', (t) => {
  const options = fixture(t), root = paths.pluginRoot();
  const from = (commandLine, cwd) => ({ ...payload(commandLine), cwd });
  for (const value of [
    from('node doctor.js', path.join(root, 'hooks/antigravity')),
    from('node ../../harness/launcher.js --prepare --project /tmp/project', path.join(root, 'hooks/antigravity')),
    from(`node -e ${paths.shellQuote('require("../../harness/launcher")')}`, path.join(root, 'hooks/antigravity')),
    from("node launch''er.js --prepare --project /tmp/project", path.join(root, 'harness')),
    from(command(SID, 'log', ['--evidence-run', '--cmd', 'node ../../harness/launcher.js --prepare']), path.join(root, 'hooks/antigravity')),
  ]) assert.equal(adapter.inspectCommand(value).kind, 'deny', value.tool_input.command);
  const alias = path.join(options.root, 'innocent.js');
  fs.symlinkSync(path.join(root, 'hooks/antigravity/native-agent-lifecycle.js'), alias);
  assert.equal(adapter.inspectCommand(from('node innocent.js --stop-child', options.root)).kind, 'deny');
  assert.equal(adapter.inspectCommand(from('node innocent --stop-child', options.root)).kind, 'deny');
  for (const commandLine of ['node doctor.js --check', 'node launcher.js --check',
    `node -e ${paths.shellQuote('require("./doctor").check()')}`, 'node hooks/lib/valid-diff-lines.js input.patch',
    'node --test tests/host/test-native-agent-lifecycle.js', 'node --test test-session-helper.js',
    'node --test test-session-control-core-v1.js']) {
    assert.equal(adapter.inspectCommand(from(commandLine, options.root)).kind, 'ordinary', commandLine);
  }
  assert.equal(adapter.inspectCommand(from(command(SID, 'doctor', []), options.root)).kind, 'helper');
});

test('review artifact helpers share the exact session-bound authorization route', () => {
  const value = command(SID, 'review-artifacts', ['check', '--snapshot', '/tmp/review-snapshot.json']);
  const inspected = adapter.inspectCommand(payload(value));
  assert.equal(inspected.kind, 'helper');
  assert.deepEqual(helpers.HELPERS[inspected.request.helper], ['node', 'hooks/antigravity/review-artifacts.js']);
  assert.equal(adapter.inspectCommand(payload(value, OTHER)).kind, 'deny');
  assert.equal(adapter.inspectCommand(payload(`node ${paths.shellQuote(path.join(paths.pluginRoot(), 'hooks/antigravity/review-artifacts.js'))} check --snapshot /tmp/review-snapshot.json`)).kind, 'deny');
});

test('audit aliases pin session, project and receipt while preserving literal argument bytes', (t) => {
  const options = fixture(t), project = path.join(options.root, 'project'), foreign = path.join(options.root, 'foreign');
  fs.mkdirSync(project); fs.mkdirSync(foreign);
  const args = ['--log', path.join(project, 'run log.log'), '--project', project, '--session', SID,
    '--baseline', 'abcdef123456', '--session-epoch', '123', '--dirty-before', path.join(project, "before's.txt")];
  const inspected = adapter.inspectCommand(payload(command(SID, 'edit-landing', args)));
  assert.equal(inspected.kind, 'helper');
  const settings = { resolver: () => ({ projectRoot: project }) };
  const prepared = helpers.prepareHelperArguments(inspected.request, {}, settings);
  assert.deepEqual(prepared.slice(0, args.length), args);
  assert.deepEqual(prepared.slice(-2), ['--receipt', path.join(project, '.zensu/state', `edit-landing-${core.sessionKey(SID)}.json`)]);
  for (const [flag, value] of [['--session', OTHER], ['--receipt', '-']]) {
    assert.equal(adapter.inspectCommand(payload(command(SID, 'edit-landing', ['--log', '/tmp/run.log', flag, value]))).kind, 'deny');
  }
  for (const extra of [['--project', foreign], ['--receipt', path.join(foreign, 'receipt.json')]]) {
    const request = helpers.parseArguments(['--session', SID, '--helper', 'edit-landing', '--', '--log', '/tmp/run.log', ...extra]);
    assert.throws(() => helpers.prepareHelperArguments(request, {}, settings), /immutable|current session/);
  }
  const inventory = helpers.parseArguments(['--session', SID, '--helper', 'edit-landing', '--', '--inventory', '--log', '/tmp/run.log']);
  assert.deepEqual(helpers.prepareHelperArguments(inventory, {}, settings), ['--inventory', '--log', '/tmp/run.log', '--project', project]);
  const ledger = helpers.parseArguments(['--session', SID, '--helper', 'review-ledger', '--', '--report', '--log', '/tmp/run.log']);
  assert.deepEqual(helpers.prepareHelperArguments(ledger, {}, settings), ['--report', '--log', '/tmp/run.log', '--root', project]);
});

test('rendered review directives use authorized node/bash aliases and file-bound stdin', () => {
  const renderer = require('../../hooks/antigravity/render-context.js');
  const input = 'node "/plugin/hooks/lib/review-ledger-v1.js" --report --log /tmp/run.log --root /project; '
    + 'bash "/plugin/hooks/lib/zensu-edit-landing.sh" --log /tmp/run.log; '
    + 'bash "/plugin/hooks/lib/zensu-log.sh" append --log {log_file} --message-stdin fed by a heredoc whose delimiter is quoted, so no finding text is ever shell-expanded, and never through --message';
  const rendered = renderer.render(input, 'post-review-tdd-delegate.sh', { session_id: SID });
  assert.match(rendered, /--helper review-ledger -- --report/);
  assert.match(rendered, /--helper edit-landing -- --log/);
  assert.match(rendered, /--helper log --stdin-file '<absolute-input-file>' -- append/);
  assert.doesNotMatch(rendered, /fed by a heredoc|node "\/plugin|bash "\/plugin/);
  const bannerSource = fs.readFileSync(path.join(paths.pluginRoot(), 'hooks/session-start-banner.sh'), 'utf8');
  const bannerLine = bannerSource.split('\n').find(line => line.includes('echo "zensu- Reviewer spawns —'));
  assert.ok(bannerLine, 'the canonical banner disclosure remains covered');
  const banner = renderer.render(bannerLine.trim().slice(6, -1), 'session-start-banner.sh', { session_id: SID });
  assert.match(banner, /distinct child conversations/);
  assert.match(banner, /verified parent\/child provenance/);
  assert.doesNotMatch(banner, /configured to admit|host permission layer is not asked/);
  const stop = renderer.render('A main-thread TDD session finished implementation', 'stop-chain-enforcer.sh', { session_id: SID });
  assert.match(stop, /Any source edit, including a reproduction test, requires a fresh ticket and required-role re-review of the final tree/);
  assert.match(stop, /never from unclassified raw child findings/);
  assert.match(stop, /Never fabricate child metadata or close an unreviewed chain/);
});

test('bootstrap publishes exact verified placeholder values', () => {
  const text = bootstrap.advisory({ session_id: SID }, { created: true, context: { project_root: '/verified/project' } }, '/verified/plugin');
  assert.ok(text.includes('{plugin_root} = "/verified/plugin"'));
  assert.ok(text.includes('{project_root} = "/verified/project"'));
  assert.ok(text.includes(`{conversation_id} = "${SID}"`));
  assert.ok(text.includes('edit-landing, review-ledger, autopilot-review'));
});

test('autopilot adapter dispatches only owned run operations under one project lock', (t) => {
  const options = fixture(t), plugin = path.join(options.root, 'plugin'), project = path.join(options.root, 'project');
  fs.mkdirSync(path.join(plugin, 'hooks/antigravity'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'hooks/lib')); fs.mkdirSync(project);
  const target = path.join(plugin, 'hooks/antigravity/autopilot-review.sh');
  fs.copyFileSync(path.join(paths.pluginRoot(), 'hooks/antigravity/autopilot-review.sh'), target);
  fs.writeFileSync(path.join(plugin, 'hooks/lib/zensu-session.sh'), `
zensu_bind_model_session() { export ZENSU_SESSION_KEY="$FIXTURE_KEY"; }
zensu_resolve_project_dir() { printf '%s\\n' "$FIXTURE_PROJECT"; }
`);
  fs.writeFileSync(path.join(plugin, 'hooks/lib/zensu-autopilot-state.sh'), `
_autopilot_identifier_ok() { [ "$1" = run-one ]; }
_autopilot_read_storage_ready() { [ "$1" = "$FIXTURE_PROJECT" ]; }
_autopilot_locked_run() { shift 2; IN_FIXTURE_LOCK=1 "$@"; }
_autopilot_read_active_critical() { [ "\${IN_FIXTURE_LOCK:-}" = 1 ] || return 88; printf '%s' "$FIXTURE_RUN"; }
autopilot_team_review_operation_key() { printf 'key:%s:%s' "$1" "$2"; }
_autopilot_read_team_review_payload_critical() { [ "\${IN_FIXTURE_LOCK:-}" = 1 ] || return 88; printf 'read:%s:%s:%s:%s:%s' "$1" "$2" "$3" "$4" "$5"; }
_autopilot_store_team_review_payload_critical() { [ "\${IN_FIXTURE_LOCK:-}" = 1 ] || return 88; printf 'store:%s:%s:%s:%s:%s:%s' "$1" "$2" "$3" "$4" "$5" "$6"; }
`);
  const key = core.sessionKey(SID);
  const run = (args, owner = key) => spawnSync('bash', [target, ...args], { encoding: 'utf8',
    env: { PATH: process.env.PATH, FIXTURE_KEY: key, FIXTURE_PROJECT: project,
      FIXTURE_RUN: JSON.stringify({ runId: 'run-one', ownerSessionId: owner, stage: 'TEAM_REVIEW' }) } });
  const operation = run(['operation-key', 'run-one', 'abcdef123']);
  assert.equal(operation.status, 0, operation.stderr); assert.equal(operation.stdout, 'key:run-one:abcdef123');
  const read = run(['read-payload', 'run-one', 'operation-key', 'abcdef123', 'github']);
  assert.equal(read.status, 0, read.stderr); assert.equal(read.stdout, `read:${project}:run-one:operation-key:abcdef123:github`);
  const source = path.join(project, 'synthesis with spaces.json');
  const write = run(['store-payload', 'run-one', 'operation-key', 'abcdef123', source, 'github']);
  assert.equal(write.status, 0, write.stderr); assert.equal(write.stdout, `store:${project}:run-one:operation-key:abcdef123:${source}:github`);
  assert.equal(run(['read-payload', 'run-one', 'operation-key', 'abcdef123', 'github'], core.sessionKey(OTHER)).status, 4);
  assert.equal(run(['eval', 'touch /tmp/forged']).status, 3);
  assert.equal(run(['read-payload', 'run-one', 'key', 'abcdef123', 'github', '/foreign-root']).status, 3);
});

test('quoted plugin paths and arguments survive literal parsing', () => {
  const root = "/tmp/plugin's directory";
  const request = adapter.inspectCommand(payload(command(SID, 'log', ['--phase', 'a "quoted" value'], root)), { pluginRoot: root });
  assert.equal(request.kind, 'helper');
  assert.deepEqual(request.request.args, ['--phase', 'a "quoted" value']);
});

test('authorization is exact, expires, and is consumed once', (t) => {
  const options = fixture(t);
  const inspected = adapter.guard(payload(command()), options);
  assert.equal(inspected.kind, 'helper');
  assert.throws(() => helpers.consumeAuthorization({ ...inspected.request, sessionId: OTHER }, options), /No current/);
  assert.throws(() => helpers.consumeAuthorization({ ...inspected.request, args: ['--tdd-begin'] }, options), /No current/);
  helpers.consumeAuthorization(inspected.request, options);
  assert.throws(() => helpers.consumeAuthorization(inspected.request, options), /No current/);
  helpers.authorize(inspected.request, options);
  assert.throws(() => helpers.consumeAuthorization(inspected.request, { ...options, now: options.now + helpers.AUTHORIZATION_TTL_MS + 1 }), /No current/);
});

test('private authorization rejects symlinks and public records', (t) => {
  const options = fixture(t), request = adapter.inspectCommand(payload(command())).request;
  const file = helpers.authorize(request, options);
  fs.chmodSync(file, 0o644);
  assert.throws(() => helpers.consumeAuthorization(request, options), /unsafe/);
  fs.unlinkSync(file);
  const other = path.join(options.root, 'forged.json');
  fs.writeFileSync(other, '{}', { mode: 0o600 });
  fs.symlinkSync(other, file);
  assert.throws(() => helpers.consumeAuthorization(request, options), /unsafe/);
});

test('stdin-file transport binds the exact file content and refuses aliases', (t) => {
  const options = fixture(t);
  const file = path.join(options.root, 'input.json');
  fs.writeFileSync(file, '{"fixture":true}');
  const argv = ['--session', SID, '--helper', 'log', '--stdin-file', file, '--', '--acceptance-record'];
  const request = helpers.parseArguments(argv);
  assert.equal(request.stdin.toString(), '{"fixture":true}');
  helpers.authorize(request, options);
  fs.writeFileSync(file, '{"fixture":false}');
  assert.throws(() => helpers.consumeAuthorization(helpers.parseArguments(argv), options), /No current/);
  helpers.consumeAuthorization(request, options);
  const alias = path.join(options.root, 'alias.json');
  fs.symlinkSync(file, alias);
  assert.throws(() => helpers.parseArguments(['--session', SID, '--helper', 'log', '--stdin-file', alias, '--']), /regular/);
  fs.writeFileSync(file, Buffer.alloc(helpers.MAX_STDIN_BYTES + 1));
  assert.throws(() => helpers.parseArguments(argv), /bounded/);
});

test('wrapper reconstructs authority and preserves only actual inherited work token', () => {
  const request = adapter.inspectCommand(payload(command())).request;
  const environment = helpers.helperEnvironment(request, { pluginRoot: '/executed', pluginData: '/private',
    environment: { ZENSU_HOST_SESSION_ID: OTHER, ZENSU_SESSION_KEY: 'forged', ZENSU_PROJECT_ROOT: '/foreign',
      ZENSU_PLUGIN_ROOT: '/foreign', ZENSU_PLUGIN_DATA: '/foreign', BASH_ENV: '/evil', NODE_OPTIONS: '--require=/evil',
      ZENSU_SESSION_TOKEN: 'inherited-fixture-token', PATH: '/bin' } });
  assert.equal(environment.ZENSU_HOST_SESSION_ID, SID);
  assert.equal(environment.ZENSU_PLUGIN_ROOT, '/executed');
  assert.equal(environment.ZENSU_PLUGIN_DATA, '/private');
  assert.equal(environment.ZENSU_REVIEW_EXECUTION, 'delegated');
  assert.throws(() => helpers.parseArguments(['--session', SID, '--helper', 'review-in-thread', '--']), /Unknown session helper/);
  assert.equal(environment.ZENSU_CLIENT_NAME, 'zensu-antigravity');
  assert.equal(environment.ZENSU_SESSION_TOKEN, 'inherited-fixture-token');
  for (const key of ['ZENSU_SESSION_KEY', 'ZENSU_PROJECT_ROOT', 'BASH_ENV', 'NODE_OPTIONS']) assert.equal(environment[key], undefined);
});

test('gate payload normalizes only the policy view of an exact wrapper', () => {
  const original = payload(command(SID, 'doctor', []));
  const translated = adapter.gatePayload(original);
  assert.match(translated.tool_input.command, /ZENSU_PLUGIN_DATA=.*bash .*zensu-doctor\.sh/);
  assert.match(original.tool_input.command, /session-helper\.sh/);
  assert.equal(require('../../hooks/lib/zensu-doctor-invocation.js').isRecognizedInvocation(translated), true);
  assert.equal(bootstrap.recoveryInvocation(original), true);
  assert.equal(bootstrap.recoveryInvocation(payload(command(SID, 'doctor', ['--unexpected']))), false);
});

test('normalizer uses native authority and canonical edit fields', () => {
  const output = normalizer.normalize({ conversationId: SID, session_id: OTHER,
    workspacePaths: ['/workspace'], toolCall: { name: 'multi_replace_file_content', args: {
      TargetFile: '/workspace/file.js', ReplacementChunks: [{ TargetContent: 'old', ReplacementContent: 'new' }] } } },
  'PreToolUse', { correlate: false });
  assert.equal(output.session_id, SID);
  assert.equal(output.workspace_root, '/workspace');
  assert.equal(output.tool_name, 'MultiEdit');
  assert.deepEqual(output.tool_input.edits, [{ old_string: 'old', new_string: 'new' }]);
  assert.equal(output.agent_id, undefined);
});

test('CLI 1.4.7 file tools preserve canonical authorization targets and edit content', () => {
  for (const [name, args, expected, input] of [
    ['write_file', { Path: '/workspace/new.txt', Content: 'sensitive content', Overwrite: true,
      TargetFile: '/decoy', CodeContent: 'decoy' }, 'Write',
      { file_path: '/workspace/new.txt', content: 'sensitive content' }],
    ['read_file', { Path: '/workspace/private.txt', TargetFile: '/decoy', CodeContent: 'decoy' }, 'Read', { file_path: '/workspace/private.txt' }],
    ['edit_file', { Path: '/workspace/source.js', Target: 'before', Replacement: 'after',
      TargetFile: '/decoy', TargetContent: 'decoy', ReplacementContent: 'decoy', ReplacementChunks: [{ ReplacementContent: 'decoy' }] }, 'Edit',
      { file_path: '/workspace/source.js', old_string: 'before', new_string: 'after', content: 'after' }],
    ['edit_file', { Path: '/workspace/source.js', Target: 'remove this', Replacement: '' }, 'Edit',
      { file_path: '/workspace/source.js', old_string: 'remove this', new_string: '' }],
  ]) {
    const actual = normalizer.normalize({ conversationId: SID, workspacePaths: ['/workspace'],
      tool_input: { file_path: '/decoy', content: 'decoy' },
      toolCall: { name, args } }, 'PreToolUse', { correlate: false });
    assert.equal(actual.tool_name, expected);
    assert.deepEqual(actual.tool_input, input);
    assert.equal(actual.native_tool_name, name);
    assert.deepEqual(actual.native_tool_input, args);
    assert.equal(actual.session_id, SID);
  }
});

test('PreInvocation maps to the neutral UserPromptSubmit principal contract', () => {
  const output = normalizer.normalize({ conversationId: SID, workspacePaths: ['/workspace'], prompt: 'Implement the feature' }, 'PreInvocation');
  assert.equal(output.hook_event_name, 'UserPromptSubmit');
  const principal = spawnSync('bash', ['-c',
    'source "$1/hooks/lib/zensu-agent-context.sh"; zensu_hook_principal "$(cat)" UserPromptSubmit',
    'principal-check', paths.pluginRoot()], { input: JSON.stringify(output), encoding: 'utf8' });
  assert.equal(principal.status, 0, principal.stderr);
  assert.equal(principal.stdout, 'main-v1');
});

test('PreInvocation reads only the current conversation human transcript input', (t) => {
  const options = fixture(t), directory = path.join(options.root, SID);
  fs.mkdirSync(directory);
  const file = path.join(directory, 'transcript.jsonl');
  const row = (index, source, content) => JSON.stringify({ step_index: index, type: 'USER_INPUT', source, status: 'DONE', content });
  fs.writeFileSync(file, [row(0, 'USER_EXPLICIT', 'first request'), row(1, 'SYSTEM', 'not a human request'),
    row(3, 'USER_EXPLICIT', 'later request')].join('\n'));
  const first = normalizer.normalize({ conversationId: SID, transcriptPath: file, initialNumSteps: 2 }, 'PreInvocation');
  assert.equal(first.prompt, 'first request');
  const latest = normalizer.normalize({ conversationId: SID, transcriptPath: file, initialNumSteps: 4 }, 'PreInvocation');
  assert.equal(latest.prompt, 'later request');
  assert.equal(normalizer.normalize({ conversationId: OTHER, transcriptPath: file }, 'PreInvocation').prompt, undefined);
});

test('a native PreInvocation drives the actual canonical user-prompt reminder', (t) => {
  const options = fixture(t);
  const plugin = path.join(options.root, 'plugin'), project = path.join(options.root, 'project');
  fs.mkdirSync(plugin); fs.mkdirSync(project);
  fs.mkdirSync(path.join(plugin, 'hooks'));
  fs.cpSync(path.join(paths.pluginRoot(), 'hooks/lib'), path.join(plugin, 'hooks/lib'), { recursive: true });
  fs.copyFileSync(path.join(paths.pluginRoot(), 'hooks/user-prompt-tdd-reminder.sh'), path.join(plugin, 'hooks/user-prompt-tdd-reminder.sh'));
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ name: 'zensu', version: '0.1.0' }));
  const config = path.join(options.root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ hooks: { tddReminder: true, defaultDeliveryRoute: 'ask' } }));
  const payload = normalizer.normalize({ conversationId: SID, workspacePaths: [project], prompt: 'Implement a small feature.' }, 'PreInvocation');
  bootstrap.bootstrap(payload, { ...options, pluginRoot: plugin });
  const reminder = spawnSync('bash', [path.join(plugin, 'hooks/user-prompt-tdd-reminder.sh')], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, ZENSU_PLUGIN_ROOT: plugin, ZENSU_PLUGIN_DATA: options.pluginData,
      ZENSU_PROJECT_DIR: project, ZENSU_CONFIG: config },
  });
  assert.equal(reminder.status, 0, reminder.stderr);
  const output = JSON.parse(reminder.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /Zensu workflow reminder/);
});

test('PostToolUse correlation is conversation-scoped and never invents a passing exit code', (t) => {
  const options = fixture(t);
  const input = (id, cmd) => ({ conversationId: id, stepIdx: 3, workspacePaths: ['/workspace'],
    toolCall: { name: 'run_command', args: { CommandLine: cmd } } });
  normalizer.normalize(input(SID, 'first-command'), 'PreToolUse', options);
  normalizer.normalize(input(OTHER, 'other-command'), 'PreToolUse', options);
  const result = normalizer.normalize({ conversationId: SID, stepIdx: 3, workspacePaths: ['/workspace'] }, 'PostToolUse', options);
  assert.equal(result.tool_name, 'Bash');
  assert.equal(result.tool_input.command, 'first-command');
  assert.equal(result.tool_response, undefined);
  const missing = normalizer.normalize({ conversationId: SID, stepIdx: 4, workspacePaths: ['/workspace'] }, 'PostToolUse', options);
  assert.equal(missing.tool_name, '');
});

test('bootstrap creates once and does not heal a missing armed baseline', (t) => {
  const options = fixture(t);
  const plugin = path.join(options.root, 'plugin'), project = path.join(options.root, 'project');
  fs.mkdirSync(plugin); fs.mkdirSync(project);
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ name: 'zensu', version: '0.1.0' }));
  const recordsDir = path.join(options.pluginData, 'session-control/v1/records');
  const settings = { ...options, pluginRoot: plugin, binder: { resolveHookSession(value) {
    const context = core.readContext({ recordsDir, sessionId: value.session_id, expectedHost: 'native' });
    return { projectRoot: context.project_root, context };
  } } };
  const input = { session_id: SID, workspace_root: project };
  assert.equal(bootstrap.bootstrap(input, settings).created, true);
  assert.equal(bootstrap.bootstrap(input, settings).created, false);
  const stateFile = core.adoptionWorkflowStatePath(project, SID);
  fs.unlinkSync(stateFile);
  assert.throws(() => bootstrap.bootstrap(input, settings));
  assert.equal(fs.existsSync(stateFile), false);
});

test('parallel conversations in one workspace receive independent immutable bindings', async (t) => {
  const options = fixture(t);
  const plugin = path.join(options.root, 'plugin'), project = path.join(options.root, 'project');
  fs.mkdirSync(plugin); fs.mkdirSync(project);
  fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ name: 'zensu', version: '0.1.0' }));
  const entry = path.join(paths.pluginRoot(), 'hooks/antigravity/session-bootstrap.js');
  const launch = (sessionId) => new Promise((resolve, reject) => {
    const source = 'require(process.argv[1]).bootstrap(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));';
    const child = spawn(process.execPath, ['-e', source, entry,
      JSON.stringify({ session_id: sessionId, workspace_root: project }),
      JSON.stringify({ pluginRoot: plugin, pluginData: options.pluginData })]);
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('exit', (status) => status === 0 ? resolve() : reject(new Error(error)));
  });
  await Promise.all([launch(SID), launch(OTHER)]);
  const recordsDir = path.join(options.pluginData, 'session-control/v1/records');
  const first = core.readContext({ recordsDir, sessionId: SID, expectedHost: 'native' });
  const second = core.readContext({ recordsDir, sessionId: OTHER, expectedHost: 'native' });
  assert.equal(first.project_root, project);
  assert.equal(second.project_root, project);
  assert.notEqual(first.session_id_hash, second.session_id_hash);
  assert.notEqual(core.adoptionWorkflowStatePath(project, SID), core.adoptionWorkflowStatePath(project, OTHER));
  assert.equal(fs.existsSync(path.join(project, '.zensu/state/session-id-current.txt')), false);
});
