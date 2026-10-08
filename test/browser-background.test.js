'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BT = require('../lib/browser-tools');

test('browser_open can be told to stay in the background (research the user did not ask to watch), and only then', async () => {
  const seen = []; const m = { open: async (actor, url, o) => { seen.push({ actor, url, ...o }); return { title: 'T', url, text: 'x' }; } };
  const def = BT.TOOLS.find(t => t.name === 'browser_open'); assert.ok(def.props.background, 'the option exists'); assert.match(def.props.background.description, /Browser screen/); assert.match(def.props.background.description, /did not ask to watch/); assert.deepEqual(def.required, ['url'], 'still only the address is required');
  await BT.execute(m, 'commander', 'browser_open', { url: 'https://example.com/a', background: true }); await BT.execute(m, 'commander', 'browser_open', { url: 'https://example.com/b' }); await BT.execute(m, 'alex', 'browser_open', { url: 'https://example.com/c', new_tab: true, background: 'yes' });
  assert.deepEqual(seen.map(s => [s.url.slice(-1), s.newTab, s.background]), [['a', false, true], ['b', false, false], ['c', true, true]], 'off unless asked for');
  const g = BT.geminiDecls(); const decl = (g.browser_open || Object.values(g).find(x => x && x.parameters && x.parameters.properties && x.parameters.properties.url)); assert.ok(JSON.stringify(g).includes('background'), 'Laila sees the option too');
  assert.ok(JSON.stringify(BT.mcpTools()).includes('background'), 'and the crew');
});
