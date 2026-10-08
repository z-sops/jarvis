'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, Connectors, checkSpec } = require('../lib/connectors');
const nops = CATALOG.find(c => c.id === 'neuralops');

test('NeuralOps from the list is accepted with its token, and needs the token', () => {
  const r = checkSpec({ catalogId: 'neuralops', token: 'nops_abcdef123456' });
  assert.equal(r.ok, true); assert.equal(r.url, 'http://127.0.0.1:3031/mcp'); assert.equal(r.auth, 'bearer'); assert.equal(r.id, 'neuralops');
  const none = checkSpec({ catalogId: 'neuralops' }); assert.equal(none.ok, false); assert.match(none.error, /needed/);
});

test('an address typed by hand is still refused when it points at this computer or is plain http', () => {
  assert.equal(checkSpec({ name: 'local', url: 'http://127.0.0.1:3031/mcp', token: 'nops_abcdef123456' }).ok, false);
  assert.equal(checkSpec({ name: 'plain', url: 'http://example.com/mcp', token: 'abcdefgh1234' }).ok, false);
});

test('NeuralOps is on this computer, and its approval-granting tools always ask you while the rest run free', () => {
  assert.ok(nops, 'NeuralOps catalog entry');
  assert.equal(nops.url({}), 'http://127.0.0.1:3031/mcp');
  const level = n => Connectors.prototype.defaultLevel.call({}, { catalogId: 'neuralops', mode: 'read-only' }, n);
  for (const n of ['neuralops_authorize', 'neuralops_grant_approval', 'neuralops_deny', 'neuralops_escalate']) assert.equal(level(n), 'ask', n);
  for (const n of ['neuralops_handoff', 'neuralops_claim', 'neuralops_complete', 'neuralops_evidence', 'neuralops_block', 'neuralops_get_task_context', 'neuralops_request_approval']) assert.equal(level(n), 'free', n);
});

test('other connectors keep their old defaults: reading is free, changing is blocked or asks', () => {
  const lv = (mode, n) => Connectors.prototype.defaultLevel.call({}, { catalogId: 'github', mode }, n);
  assert.equal(lv('read-only', 'get_issue'), 'free');
  assert.equal(lv('read-only', 'create_issue'), 'blocked');
  assert.equal(lv('read-write', 'create_issue'), 'ask');
});

test('changing the mode of NeuralOps does not turn its free tools back into ask or blocked', () => {
  const rec = { id: 'neuralops', catalogId: 'neuralops', url: 'x', options: {}, tools: ['neuralops_handoff', 'neuralops_authorize'], levels: { neuralops_handoff: 'free', neuralops_authorize: 'ask' } };
  const fake = { get: () => rec, update: (id, patch) => Object.assign(rec, patch) };
  Connectors.prototype.setMode.call(fake, 'neuralops', 'read-write');
  assert.deepEqual(rec.levels, { neuralops_handoff: 'free', neuralops_authorize: 'ask' });
  Connectors.prototype.setMode.call(fake, 'neuralops', 'read-only');
  assert.deepEqual(rec.levels, { neuralops_handoff: 'free', neuralops_authorize: 'ask' });
});
