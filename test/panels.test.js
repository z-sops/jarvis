'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const panels = require('../lib/panels');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function rig() {
  const home = new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-p-')), 'BridgeHome')).ensure(); home.createAgent({ name: 'Bob', role: 'Tester' });
  const handlers = new Map(), sent = [], bus = new EventEmitter(), shellCalls = [];
  const states = new Map(), cancelled = [], workers = { states, cancelAll: () => 2, cancel: id => { cancelled.push(id); return id === 'bob' ? 1 : 0; } }, chat = panels.chatGuard(bus);
  const usage = panels.makeUsage({ home }), audit = panels.makeAudit({ home, bus });
  const api = panels.register({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, shell: { showItemInFolder: p => shellCalls.push(['show', p]), openPath: p => shellCalls.push(['open', p]) }, home, bus, send: (t, p) => sent.push([t, p]), workers, usage, audit, chat });
  const call = (ch, ...a) => handlers.get(ch)({}, ...a);
  return { home, bus, sent, shellCalls, states, cancelled, workers, chat, usage, audit, call, api };
}

test('workspace IPC: list, read, edit, reveal, and refusal outside the folder', () => {
  const r = rig(); fs.writeFileSync(path.join(r.home.p('workspace', 'bob'), 'report.md'), '# Report');
  const t = r.call('ws:tree'); assert.equal(t.ok, true); assert.ok(t.entries.some(e => e.name === 'bob' && e.agent && e.agent.name === 'Bob'));
  assert.equal(r.call('ws:read', 'bob/report.md').file.text, '# Report'); assert.equal(r.call('ws:write', 'bob/report.md', '# New').ok, true); assert.equal(r.call('ws:read', 'bob/report.md').file.text, '# New');
  assert.equal(r.call('ws:read', '../x').ok, false); assert.match(r.call('ws:read', '../x').error, /outside the workspace/); assert.match(r.call('ws:read', 'bob/none.md').error, /gone/);
  assert.equal(r.call('ws:reveal', 'bob/report.md').ok, true); assert.deepEqual(r.shellCalls[0], ['show', path.join(r.home.p('workspace', 'bob'), 'report.md')]);
  assert.equal(r.call('ws:reveal', '../../etc').ok, false, 'reveal is confined too'); assert.equal(r.call('ws:openRoot').ok, true); assert.deepEqual(r.shellCalls[1], ['open', r.home.p('workspace')]);
});

test('workspace IPC: the screen is told when a file appears, and stops being told after unwatch', async () => {
  const r = rig(); r.call('ws:watch', true); await sleep(100); fs.writeFileSync(path.join(r.home.p('workspace', 'bob'), 'new.md'), 'x'); await sleep(800);
  assert.ok(r.sent.some(([t]) => t === 'ws:changed'), 'ws:changed was sent'); r.call('ws:watch', false); r.sent.length = 0; fs.writeFileSync(path.join(r.home.p('workspace', 'bob'), 'later.md'), 'x'); await sleep(600);
  assert.equal(r.sent.filter(([t]) => t === 'ws:changed').length, 0);
});

test('usage IPC: numbers are served, and pushed to the screen (not more than about once a second)', async () => {
  const r = rig(); r.usage.add({ model: 'gemini-3.5-flash-lite', inTok: 1000, outTok: 10 }); r.usage.add({ model: 'gemini-3.5-flash-lite', inTok: 2000 }); r.usage.add({ model: 'gemini-3.5-flash-lite', inTok: 3000 });
  assert.equal(r.call('usage:get').total.inTok, 6000); await sleep(1300);
  const pushes = r.sent.filter(([t]) => t === 'usage'); assert.ok(pushes.length >= 1 && pushes.length <= 2, 'pushes: ' + pushes.length); assert.equal(pushes[pushes.length - 1][1].total.inTok, 6000);
});

test('logs: tool calls and jobs are recorded, "start" events are not, and the screen hears about new lines', () => {
  const r = rig();
  r.bus.emit('tool', { actorName: 'Laila', actor: 'commander', name: 'run_shell', status: 'start', args: { command: 'dir' } });
  r.bus.emit('tool', { actorName: 'Laila', actor: 'commander', name: 'run_shell', status: 'done', ms: 41, args: { command: 'dir' } });
  r.bus.emit('tool', { actorName: 'Bob', actor: 'bob', name: 'write_file', status: 'denied', reason: 'Blocked: outside the workspace' });
  r.bus.emit('job:created', { agent: { name: 'Bob' }, job: { task: 'Test the site' } }); r.bus.emit('job:done', { agent: { name: 'Bob' }, job: { task: 'Test the site', status: 'failed', error: 'Gemini HTTP 429' } });
  const t = r.call('logs:tail', 50); assert.equal(t.length, 4); assert.deepEqual(t.map(e => e.kind + ':' + (e.status || e.event)), ['tool:done', 'tool:denied', 'job:assigned', 'job:failed']);
  assert.equal(t[0].actor, 'Laila'); assert.equal(t[3].error, 'Gemini HTTP 429'); assert.equal(r.sent.filter(([x]) => x === 'audit').length, 4);
});

test('Stop: cancels the crew, stops a typed chat, is logged, and busy is reported', async () => {
  const r = rig(); assert.deepEqual(r.call('busy:get'), { crew: 0, chat: false });
  r.states.set('bob', { state: 'working' }); r.chat.begin(); assert.deepEqual(r.call('busy:get'), { crew: 1, chat: true }); await sleep(150); assert.ok(r.sent.some(([t, p]) => t === 'busy' && p.crew === 1 && p.chat === true), 'busy was pushed');
  assert.equal(r.chat.stopped(), false); const s = r.call('stop:all'); assert.deepEqual(s, { crew: 2, chat: true }); assert.equal(r.chat.stopped(), true);
  assert.match(r.call('logs:tail', 5).pop().detail, /Stop pressed: 2 crew job\(s\) stopped, typed chat stopped/);
  r.chat.end(); assert.equal(r.chat.stopped(), false, 'the flag resets when the turn ends'); assert.deepEqual(r.call('stop:all').chat, false, 'nothing to stop in chat');
});

test('Stop one agent: only that agent is cancelled, and it is logged', () => {
  const r = rig(); assert.deepEqual(r.call('stop:agent', 'bob'), { cancelled: 1 }); assert.deepEqual(r.call('stop:agent', 'nobody'), { cancelled: 0 }); assert.deepEqual(r.cancelled, ['bob', 'nobody']);
  assert.match(r.call('logs:tail', 5)[0].detail, /Stop pressed for one crew member \(bob\): 1 job\(s\) stopped/);
});

test('the usage card can never print the word "null" (an empty piece used to be appended as text)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'usage-ui.js'), 'utf8');
  assert.match(src, /card\.line1\.append\(\.\.\.\[.*\]\.filter\(Boolean\)\)/s, 'the pieces are filtered before they are appended'); assert.doesNotMatch(src, /: null\);\s*\n\s*const crew/);
});
