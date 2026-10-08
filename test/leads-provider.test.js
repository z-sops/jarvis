'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { LeadsProvider } = require('../lib/leads-provider');

const rig = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-')), home = { p: (...a) => path.join(root, ...a) }; return new LeadsProvider({ home }); };
const text = r => r.content[0].text;

test('every crew member and Laila see the same leads (not scoped like the library), and the tools work through the gateway shape', async () => {
  const p = rig(); const a = await p.callTool('lead_add', { name: 'Sea Breeze Restaurant', city: 'Karachi', website: 'seabreeze.example', tags: ['warm', 'restaurant'] }, { actor: 'alex' });
  assert.equal(a.isError, false); assert.match(text(a), /Added\.\nld\w+  Sea Breeze Restaurant \(Karachi\) \u00B7 new/);
  const listedByAlex = await p.callTool('lead_list', {}, { actor: 'alex' }); const listedByCommander = await p.callTool('lead_list', {}, { actor: 'commander' }); assert.equal(text(listedByAlex), text(listedByCommander), 'the same data, whoever asks');
  const names = (await p.listTools()).map(t => t.name); assert.deepEqual(names, ['lead_add', 'lead_list', 'lead_get', 'lead_search', 'lead_update', 'lead_note']);
});

test('the pipeline in practice: add, search, update the status, note a call, mark do-not-contact -- and it never disappears', async () => {
  const p = rig(); const a = await p.callTool('lead_add', { name: 'Mountain View Cafe', city: 'Lahore' }, {}); const id = text(a).match(/^Added\.\n(ld\w+)/)[1];
  const s = await p.callTool('lead_search', { query: 'Lahore cafe' }, {}); assert.match(text(s), /Mountain View Cafe/);
  const u = await p.callTool('lead_update', { id, status: 'pitched' }, {}); assert.match(text(u), /\u00B7 pitched/);
  const n = await p.callTool('lead_note', { id, text: 'called, owner asked for a follow-up next week' }, {}); assert.match(text(n), /called, owner asked for a follow-up/);
  const dnc = await p.callTool('lead_update', { id, do_not_contact: true }, {}); assert.match(text(dnc), /DO NOT CONTACT/);
  const g = await p.callTool('lead_get', { id }, {}); assert.match(text(g), /DO NOT CONTACT/); assert.match(text(g), /called, owner asked for a follow-up/);
  const l = await p.callTool('lead_list', { status: 'pitched' }, {}); assert.match(text(l), /DO NOT CONTACT/, 'do-not-contact is never hidden from a normal list either');
});

test('mistakes are plain-words errors, never a crash: a bad status, a missing lead, empty search, an unknown tool', async () => {
  const p = rig(); const bad1 = await p.callTool('lead_update', { id: 'nope', status: 'won' }, {}); assert.equal(bad1.isError, true); assert.match(text(bad1), /No such lead/);
  const a = await p.callTool('lead_add', { name: 'X' }, {}); const id = text(a).match(/^Added\.\n(ld\w+)/)[1];
  const bad2 = await p.callTool('lead_update', { id, status: 'super-interested' }, {}); assert.equal(bad2.isError, true); assert.match(text(bad2), /Status must be one of/);
  const bad3 = await p.callTool('lead_add', {}, {}); assert.equal(bad3.isError, true); assert.match(text(bad3), /needs at least a business name/);
  const bad4 = await p.callTool('lead_search', { query: '' }, {}); assert.equal(bad4.isError, true); const bad5 = await p.callTool('nope', {}, {}); assert.equal(bad5.isError, true); assert.equal((await p.listTools()).length, 6);
  const empty = await p.callTool('lead_list', { status: 'won' }, {}); assert.equal(empty.isError, false); assert.match(text(empty), /No leads match that/);
});
