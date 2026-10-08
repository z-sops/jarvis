'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { providerSetup } = require('../lib/opencode');

test('OpenCode Zen is a provider of its own: model and key go to opencode, not to Gemini', () => {
  const r = providerSetup({ workerProvider: 'opencode', workerModel: 'space-bunny-free', workerApiKey: 'k-test' });
  assert.equal(r.model, 'opencode/space-bunny-free');
  assert.deepEqual(r.env, { OPENCODE_API_KEY: 'k-test' });
  assert.deepEqual(Object.keys(r.provider), ['opencode']);
  assert.equal(r.provider.opencode.options.apiKey, '{env:OPENCODE_API_KEY}');
});

test('a model typed as opencode/<name> is not doubled', () => {
  const r = providerSetup({ workerProvider: 'opencode', workerModel: 'opencode/big-pickle', workerApiKey: 'k' });
  assert.equal(r.model, 'opencode/big-pickle');
});

test('the other providers are unchanged (a blank provider is still Gemini)', () => {
  const g = providerSetup({ workerProvider: '', workerModel: 'gemini-2.5-flash', workerApiKey: 'g' });
  assert.equal(g.model, 'google/gemini-2.5-flash'); assert.deepEqual(g.env, { GEMINI_API_KEY: 'g' });
  const o = providerSetup({ workerProvider: 'openrouter', workerModel: 'x/y', workerApiKey: 'o' });
  assert.equal(o.model, 'openrouter/x/y');
});

test('the opencode provider still needs a key and a model', () => {
  assert.throws(() => providerSetup({ workerProvider: 'opencode', workerModel: 'big-pickle' }), /crew API key/);
  assert.throws(() => providerSetup({ workerProvider: 'opencode', workerApiKey: 'k' }), /Choose a model/);
});
