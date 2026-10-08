'use strict';
// Per-worker engine/model routing, Hermes side. providerSetup is pure, so the actual merge Hermes
// does (crew cfg + that agent's own override) can be proven without a real Hermes install.
const test = require('node:test');
const assert = require('node:assert');
const { providerSetup } = require('../lib/hermes');

test('a per-agent cfgOverride merged onto the crew cfg changes which model/key Hermes is told to use', () => {
  const crew = { workerProvider: 'custom', workerModel: 'crew-model', workerApiKey: 'crew-key', workerBaseUrl: 'http://crew/v1', workerContext: 32000 };
  const noOverride = providerSetup({ ...crew });
  assert.match(noOverride.modelYaml, /crew-model/);

  const override = { workerModel: 'agent-model', workerApiKey: 'agent-key' }; // workers.js only sets the fields the agent itself set
  const merged = providerSetup({ ...crew, ...override });
  assert.match(merged.modelYaml, /agent-model/);
  assert.match(merged.modelYaml, /agent-key/);
  assert.match(merged.modelYaml, /http:\/\/crew\/v1/, 'a field the agent did not override still comes from the crew default');
});

test('HermesEngine wires cfgOverride through ensureServer/_start/writeProfile/runTask', () => {
  const { HermesEngine } = require('../lib/hermes');
  const engine = new HermesEngine({ home: { root: '/tmp/does-not-matter', p: () => '/tmp/does-not-matter' }, getCfg: () => ({ workerProvider: 'gemini', apiKey: 'K', textModel: 'm' }) });
  // Calling these for real needs a Hermes install (covered, skipped where absent, by test/hermes.test.js).
  // Here we just lock in that the wiring exists, by source inspection, so a future refactor that
  // silently drops cfgOverride fails loudly instead of quietly ignoring a worker's own model choice.
  for (const fn of ['ensureServer', 'writeProfile', 'runTask']) {
    assert.match(engine[fn].toString(), /cfgOverride/, `${fn} must accept/forward cfgOverride`);
  }
  assert.match(engine._start.toString(), /cfgOverride/, '_start must accept/forward cfgOverride');
});
