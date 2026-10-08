'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Topics } = require('../lib/topics');
const mk = (legacy) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-')); let lf = null; if (legacy) { lf = path.join(d, 'conversation.json'); fs.writeFileSync(lf, JSON.stringify(legacy)); } return { d, t: new Topics(path.join(d, 'topics'), { legacyFile: lf }) }; };

test('first run: an empty topic "General"; an old conversation moves into it', () => {
  const a = mk(); const id = a.t.current(); assert.equal(a.t.get(id).title, 'General'); assert.deepEqual(a.t.get(id).messages, []); assert.equal(a.t.list().length, 1);
  const b = mk([{ role: 'user', parts: [{ text: 'hello' }] }, { role: 'model', parts: [{ text: 'hi zee' }] }, { role: 'user', parts: [{ text: '' }] }, { role: 'model', parts: [{ functionCall: {} }] }]); const t = b.t.get(b.t.current()); assert.deepEqual(t.messages.map(m => [m.role, m.text]), [['user', 'hello'], ['ai', 'hi zee']], 'empty and tool-only turns are left out'); assert.equal(b.t.current(), b.t.current(), 'and it is only done once');
  assert.equal(new Topics(path.join(b.d, 'topics')).list().length, 1);
});

test('messages go to the current topic; the first thing you say names a new topic; only user and ai messages are kept', () => {
  const { t } = mk(); const gen = t.current(); t.append('user', 'one'); t.append('ai', 'two'); assert.equal(t.append('sys', 'x'), null); assert.equal(t.append('user', '   '), null); assert.equal(t.append('robot', 'x'), null); assert.equal(t.get(gen).messages.length, 2);
  const n = t.create('New topic'); assert.equal(t.current(), n.id); t.append('user', '@Bob please check the login page on Tin Tin, it is broken and I need it today'); assert.equal(t.get(n.id).title, 'please check the login page on Tin Tin,', 'auto title: the first words, without the @mention, cut at 40'); t.append('user', 'second'); assert.equal(t.get(n.id).title.startsWith('please'), true, 'only the first message names it');
  assert.equal(t.get(gen).messages.length, 2, 'the old topic did not get the new messages'); const g = t.create('Kept'); t.append('user', 'hi'); assert.equal(t.get(g.id).title, 'Kept', 'a name you chose stays');
  for (let i = 0; i < 520; i++) t.append('ai', 'm' + i); assert.equal(t.get(g.id).messages.length, 500, 'at most 500 messages'); assert.equal(t.get(g.id).messages.at(-1).text, 'm519');
});

test('switch, rename, delete; the list is newest first; deleting the current one moves to another; deleting the last makes a new General', () => {
  const { t } = mk(); const a = t.current(); t.append('user', 'a'); const b = t.create('Bravo').id; t.append('user', 'b'); assert.deepEqual(t.list().map(x => x.title), ['Bravo', 'General']); t.switchTo(a); assert.equal(t.current(), a); t.append('user', 'a2'); assert.equal(t.list()[0].id, a, 'the one you used last is first');
  t.rename(b, '  Bravo   two  '); assert.equal(t.get(b).title, 'Bravo two'); assert.throws(() => t.rename(b, '  '), /needs a name/); assert.throws(() => t.get('nope'), /No such topic/); assert.throws(() => t.switchTo('..'), /No such topic/); assert.throws(() => t.get('../etc'), /No such topic/);
  assert.equal(t.remove(a), b, 'the current one is deleted: the newest other one is now current'); assert.equal(t.list().length, 1); const last = t.remove(b); assert.equal(t.get(last).title, 'General'); assert.equal(t.list().length, 1, 'never no topic at all');
  const c = t.create('C'); const d = t.create('D'); t.switchTo(c.id); t.remove(d.id); assert.equal(t.current(), c.id, 'deleting another one does not move you');
});

test('what the brains get: text history as Gemini turns starting with the user; a short recap for voice; clear', () => {
  const { t } = mk(); t.append('ai', 'orphan answer'); t.append('user', 'q1'); t.append('ai', 'a1'); t.append('user', 'q2');
  const h = t.history(); assert.deepEqual(h.map(x => x.role), ['user', 'model', 'user'], 'it starts with the user'); assert.deepEqual(h[0], { role: 'user', parts: [{ text: 'q1' }] }); assert.equal(t.history(2).length, 1, 'the last two are model+user: the leading model turn is dropped');
  const r = t.recap(); assert.equal(r.title, 'General'); assert.equal(r.text, 'You: orphan answer\nUser: q1\nYou: a1\nUser: q2'); assert.equal(r.count, 4); for (let i = 0; i < 40; i++) t.append('user', 'long '.repeat(80)); assert.ok(t.recap().text.length <= 1800, 'the recap stays short');
  t.clearCurrent(); assert.equal(t.history().length, 0); assert.equal(t.recap().text, ''); assert.equal(t.list().length, 1, 'clearing keeps the topic');
});

test('a topic file that is damaged does not break the others', () => {
  const { d, t } = mk(); const a = t.current(); const b = t.create('B').id; fs.writeFileSync(path.join(d, 'topics', a + '.json'), '{broken'); assert.deepEqual(t.list().map(x => x.id), [b]); assert.equal(t.current(), b, 'the pointer is set to b, which is fine'); fs.writeFileSync(path.join(d, 'topics', 'current.txt'), a); assert.equal(t.current(), b, 'a pointer to a broken topic is repaired');
});

test('the time an answer took is kept with the message (and nonsense is not)', () => {
  const { t } = mk(); t.append('user', 'q'); t.append('ai', 'a', { ms: 3249.7, first: false }); t.append('ai', 'b', { ms: 1800, first: true }); t.append('ai', 'c', { ms: -5 }); t.append('ai', 'd', { ms: 'fast' }); t.append('ai', 'e', { ms: 1e9 }); t.append('ai', 'f', { ms: NaN }); t.append('ai', 'g'); t.append('ai', 'h', null);
  const m = t.get(t.current()).messages; assert.equal(m[0].ms, undefined, 'no time given: none stored'); assert.equal(m[1].ms, 3250); assert.equal(m[1].first, undefined); assert.equal(m[2].ms, 1800); assert.equal(m[2].first, true, 'a voice answer says it is the first word'); for (const i of [3, 4, 5, 6, 7, 8]) assert.equal(m[i].ms, undefined, 'message ' + i + ' has no bad time'); assert.ok(m[1].t, 'every message has its clock time');
});
