'use strict';

// Validate a rendered skill command without authorizing or executing it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [root, helper, relative, ...args] = process.argv.slice(2);
const paths = require(path.join(root, 'hooks/antigravity/session-paths.js'));
const bridge = require(path.join(root, 'hooks/antigravity/session-helper.js'));
const { inspectCommand } = require(path.join(root, 'hooks/antigravity/session-command-guard.js'));
const sessionId = '11111111-2222-4333-8444-555555555555';
const template = fs.readFileSync(0, 'utf8').trim();
assert.ok(template.startsWith('{session-helper} --helper '));
const command = template.replace('{session-helper}', paths.helperPrefix(sessionId, root));
const result = inspectCommand({ tool_name: 'Bash', session_id: sessionId,
  tool_input: { command } }, { pluginRoot: root });
assert.equal(result.kind, 'helper', result.reason);
assert.equal(result.request.helper, helper);
assert.deepEqual(result.request.args, args);
assert.equal(bridge.HELPERS[helper][1], relative);
assert.ok(fs.statSync(path.join(root, relative)).isFile());
const pluginData = '/tmp/native-helper-command-fixture';
const environment = bridge.helperEnvironment(result.request, { pluginRoot: root, pluginData,
  environment: { ZENSU_PLUGIN_ROOT: '/wrong-root', ZENSU_PLUGIN_DATA: '/wrong-data',
    ZENSU_HOST_SESSION_ID: 'another-session' } });
assert.equal(environment.ZENSU_PLUGIN_ROOT, root);
assert.equal(environment.ZENSU_PLUGIN_DATA, pluginData);
assert.equal(environment.ZENSU_HOST_SESSION_ID, sessionId);
assert.equal(inspectCommand({ tool_name: 'Bash', session_id: 'another-session',
  tool_input: { command } }, { pluginRoot: root }).kind, 'deny');
