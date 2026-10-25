'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { run, handlers, classify } = require('../../hooks/antigravity/invocation-chain.js');

function fixture(t, startup = ['session-start-pulse.sh', 'session-start-primer.sh'], normal = ['prompt-a.sh', 'prompt-b.sh']) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zensu-invocation-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'private'), project = path.join(root, 'project');
  fs.mkdirSync(data, { mode: 0o700 }); fs.mkdirSync(project); fs.mkdirSync(path.join(root, 'hooks'));
  const group = names => [{ hooks: names.map(name => ({ command: `bash "\${ZENSU_PLUGIN_ROOT}/hooks/${name}"` })) }];
  const inventory = { hooks: { SessionStart: group(startup), UserPromptSubmit: group(normal) } };
  fs.writeFileSync(path.join(root, 'hooks/hooks.json'), JSON.stringify(inventory));
  for (const name of [...startup, ...normal]) fs.writeFileSync(path.join(root, 'hooks', name), '# fixture');
  const payload = { session_id: 'invocation-fixture', host_session_id: 'invocation-fixture',
    hook_event_name: 'UserPromptSubmit', prompt: 'first prompt', tool_name: '', tool_input: {} };
  const environment = { ZENSU_PLUGIN_DATA: data, ZENSU_PROJECT_DIR: project,
    ZENSU_SHIM_TRACE: path.join(root, 'trace'), ZENSU_SHIM_DECISIONS: path.join(root, 'decisions') };
  const calls = [], replies = new Map(), errors = [];
  const context = text => JSON.stringify({ hookSpecificOutput: { additionalContext: text } });
  const options = { root, environment, created: true, bootContext: 'bound native helper',
    stderr: { write: text => errors.push(text) },
    execute: (command, args, options) => {
      const name = path.basename(args[0]); calls.push({ command, name, ...options, input: JSON.parse(options.input) });
      return replies.get(name) || { status: 0, stdout: context(name + ' context'), stderr: '' };
    } };
  return { root, data, project, inventory, payload, environment, calls, replies, errors, options, context };
}

test('startup and prompt engines retain inventory order, lifecycle, cwd, pulse and native helper rendering', t => {
  const f = fixture(t);
  f.replies.set('session-start-pulse.sh', { status: 0, stdout: 'pulse ready\n', stderr: '' });
  f.replies.set('session-start-primer.sh', { status: 0,
    stdout: f.context('Run bash /example/hooks/lib/zensu-log.sh --chain-status'), stderr: '' });
  const result = run(f.payload, f.options), text = result.injectSteps[0].ephemeralMessage;
  assert.deepEqual(f.calls.map(c => c.name), ['session-start-pulse.sh', 'session-start-primer.sh', 'prompt-a.sh', 'prompt-b.sh']);
  assert.ok(f.calls.every(c => c.command === 'bash' && c.env === f.environment));
  assert.ok(f.calls.slice(0, 2).every(c => c.cwd === f.project && c.input.source === 'startup' && c.input.hook_event_name === 'SessionStart'));
  assert.ok(f.calls.slice(2).every(c => c.cwd === undefined && c.input.hook_event_name === 'UserPromptSubmit'));
  assert.match(text, /^bound native helper\n\npulse ready/);
  assert.match(text, /session-helper\.sh' --session 'invocation-fixture' --helper log -- --chain-status/);
  assert.ok(text.indexOf('prompt-a.sh context') < text.indexOf('prompt-b.sh context'));
  assert.equal(fs.readFileSync(f.environment.ZENSU_SHIM_TRACE, 'utf8').trim().split('\n').length, 4);
  const decisions = fs.readFileSync(f.environment.ZENSU_SHIM_DECISIONS, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(decisions.every(d => d.event === 'PreInvocation' && d.sessionId === f.payload.session_id && d.decision === 'context'));
  assert.doesNotMatch(JSON.stringify(decisions), /pulse ready|bound native helper|chain-status/);
});

test('same-turn de-bounce preserves startup-once and emits again on a new prompt', t => {
  const f = fixture(t);
  run(f.payload, f.options); f.calls.length = 0;
  assert.deepEqual(run(f.payload, { ...f.options, created: false }), {});
  assert.deepEqual(f.calls.map(c => c.name), ['prompt-a.sh', 'prompt-b.sh']);
  const result = run({ ...f.payload, prompt: 'next prompt' }, { ...f.options, created: false });
  assert.match(result.injectSteps[0].ephemeralMessage, /bound native helper/);
  assert.match(result.injectSteps[0].ephemeralMessage, /prompt-a.sh context/);
  assert.doesNotMatch(result.injectSteps[0].ephemeralMessage, /session-start-primer.sh context/);
});

test('private pending startup context is consumed once and a foreign record cannot inject context', t => {
  const f = fixture(t), crypto = require('node:crypto');
  const dir = path.join(f.data, 'startup-pending'); fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, crypto.createHash('sha256').update(f.payload.session_id).digest('hex') + '.json');
  fs.writeFileSync(file, JSON.stringify({ sessionId: f.payload.session_id, text: 'deferred startup' }), { mode: 0o600 });
  assert.match(run(f.payload, f.options).injectSteps[0].ephemeralMessage, /^deferred startup/);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, JSON.stringify({ sessionId: 'foreign', text: 'foreign directive' }), { mode: 0o600 });
  assert.deepEqual(run(f.payload, { ...f.options, created: false }), {});
  assert.equal(fs.existsSync(file), true);
});

test('native invocation decisions preserve the dialect and precedence', t => {
  for (const kind of ['deny', 'block', 'force_ask', 'ask']) {
    const f = fixture(t, ['first.sh'], ['second.sh', 'third.sh']);
    const decision = kind === 'block' ? { decision: 'block', reason: 'first reason' }
      : { hookSpecificOutput: { permissionDecision: kind, permissionDecisionReason: 'first reason' } };
    f.replies.set('first.sh', { status: 2, stdout: JSON.stringify(decision), stderr: '' });
    f.replies.set('second.sh', { status: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'later ask' } }), stderr: '' });
    const result = run(f.payload, f.options);
    assert.equal(result.injectSteps[0].ephemeralMessage, kind === 'ask' ? 'later ask' : 'first reason');
    assert.equal(result.decision, undefined);
    assert.equal(f.calls.length, ['deny', 'block'].includes(kind) ? 1 : 3);
  }
});

test('a later hard refusal wins over force_ask; missing scripts are traced without claiming execution', t => {
  const f = fixture(t, ['first.sh'], ['missing.sh', 'deny.sh', 'unreached.sh']);
  fs.unlinkSync(path.join(f.root, 'hooks/missing.sh'));
  f.replies.set('first.sh', { status: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'force_ask' } }) });
  f.replies.set('deny.sh', { status: 2, stdout: JSON.stringify({ decision: 'block', reason: 'later refusal' }) });
  assert.equal(run(f.payload, f.options).injectSteps[0].ephemeralMessage, 'later refusal');
  assert.deepEqual(f.calls.map(c => c.name), ['first.sh', 'deny.sh']);
  assert.match(fs.readFileSync(f.environment.ZENSU_SHIM_TRACE, 'utf8'), /missing.sh bail-missing-script/);
});

test('raw stderr survives, failed pulse is not context, and an unsafe trace target does not affect the verdict', t => {
  const f = fixture(t);
  f.environment.ZENSU_SHIM_TRACE = '/dev/stdout';
  f.environment.ZENSU_SHIM_DECISIONS = f.project;
  f.replies.set('session-start-pulse.sh', { status: 1, stdout: 'not ready', stderr: 'pulse failed\n' });
  const result = run(f.payload, f.options);
  assert.doesNotMatch(result.injectSteps[0].ephemeralMessage, /not ready/);
  assert.deepEqual(f.errors, ['pulse failed\n']);
});

test('malformed inventory and process launch failures fail visibly', t => {
  const f = fixture(t);
  assert.throws(() => handlers({}, 'UserPromptSubmit', ''), /Missing/);
  assert.throws(() => handlers({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'bash /foreign.sh' }] }] } }, 'UserPromptSubmit', ''), /Invalid/);
  assert.deepEqual(handlers({ hooks: { UserPromptSubmit: [{ matcher: 'Read', hooks: [] }, ...f.inventory.hooks.UserPromptSubmit] } }, 'UserPromptSubmit', 'Write'), ['prompt-a.sh', 'prompt-b.sh']);
  assert.deepEqual(classify('partial JSON', 'script.sh', {}), { kind: 'raw', text: '' });
  assert.deepEqual(classify('{"decision":"block","reason":{"detail":"invalid"}}', 'script.sh', {}), { kind: 'block', text: '[object Object]' });
  f.options.execute = () => ({ error: new Error('spawn failed'), stdout: '', stderr: '' });
  assert.throws(() => run(f.payload, f.options), /spawn failed/);
});
