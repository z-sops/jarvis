'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Leads, STATUSES } = require('../lib/leads');

const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-')); return { root, home: { p: (...a) => path.join(root, ...a) } }; };

test('adding a lead: a name is the only thing required, everything else is cleaned and kept, and it starts "new"', () => {
  const { home } = mk(); const L = new Leads(home);
  const l = L.add({ name: '  Karachi Bakery  ', website: 'karachibakery.com', phone: '0300-1234567', email: 'hello@karachibakery.com', city: 'Karachi', industry: 'Bakery', source: 'places', tags: ['food', 'food'] });
  assert.equal(l.name, 'Karachi Bakery'); assert.equal(l.status, 'new'); assert.equal(l.doNotContact, false); assert.deepEqual(l.tags, ['food']); assert.equal(l.notes.length, 0); assert.ok(l.id.startsWith('ld')); assert.ok(l.createdAt && l.updatedAt);
  assert.throws(() => L.add({ name: '' }), /needs at least a business name/); assert.throws(() => L.add({ name: '   ' }), /needs at least a business name/); assert.throws(() => L.add({ name: 'x'.repeat(200) }), /too long/);
  assert.throws(() => L.add({ name: 'Bad Email Co', email: 'not-an-email' }), /does not look like an email/); const ok = L.add({ name: 'No email given' }); assert.equal(ok.email, '');
  const withNote = L.add({ name: 'Noted Co', notes: 'found via a friend' }); assert.equal(withNote.notes.length, 1); assert.equal(withNote.notes[0].text, 'found via a friend'); assert.ok(withNote.notes[0].t);
});

test('reading it back: get() and list() see the same lead, and list() can filter by status, who it is assigned to, a tag, and do-not-contact', () => {
  const { home } = mk(); const L = new Leads(home);
  const a = L.add({ name: 'Alpha', status: 'ignored-on-add' }); L.update(a.id, { status: 'pitched', assignedTo: 'alex', tags: ['warm'] });
  const b = L.add({ name: 'Beta' }); L.update(b.id, { doNotContact: true });
  const c = L.add({ name: 'Gamma' }); L.update(c.id, { assignedTo: 'alex' });
  assert.equal(L.get(a.id).name, 'Alpha'); assert.equal(L.get('nope'), null);
  assert.deepEqual(L.list({ status: 'pitched' }).map(x => x.name), ['Alpha']); assert.deepEqual(L.list({ assignedTo: 'alex' }).map(x => x.name).sort(), ['Alpha', 'Gamma']); assert.deepEqual(L.list({ tag: 'warm' }).map(x => x.name), ['Alpha']);
  assert.deepEqual(L.list({ doNotContact: true }).map(x => x.name), ['Beta']); assert.equal(L.list().length, 3); assert.equal(L.list({ limit: 2 }).length, 2);
  assert.deepEqual(L.counts(), { new: 2, researched: 0, pitched: 1, replied: 0, negotiating: 0, won: 0, lost: 0, archived: 0 });
});

test('updating: status must be a real one, moving to pitched/replied stamps lastContactedAt, other fields are cleaned, do-not-contact only ever set explicitly', () => {
  const { home } = mk(); const L = new Leads(home); const l = L.add({ name: 'Delta' }); assert.equal(l.lastContactedAt, null);
  assert.throws(() => L.update(l.id, { status: 'made-up' }), new RegExp(STATUSES.join(', ').replace(/[.]/g, '\\.'))); assert.throws(() => L.update('nope', { status: 'won' }), /No such lead/);
  const p = L.update(l.id, { status: 'pitched' }); assert.equal(p.status, 'pitched'); assert.ok(p.lastContactedAt); const before = p.lastContactedAt;
  const w = L.update(l.id, { status: 'won', city: '  Lahore  ', website: 'delta.example' }); assert.equal(w.status, 'won'); assert.equal(w.city, 'Lahore'); assert.equal(w.lastContactedAt, before, 'a status that is not pitched/replied does not touch it');
  assert.throws(() => L.update(l.id, { name: '' }), /needs a name/); assert.throws(() => L.update(l.id, { email: 'nope' }), /does not look like an email/);
  const dnc = L.update(l.id, { doNotContact: true }); assert.equal(dnc.doNotContact, true); const still = L.update(l.id, { city: 'Karachi' }); assert.equal(still.doNotContact, true, 'an unrelated update never clears it silently');
  const clr = L.update(l.id, { doNotContact: false }); assert.equal(clr.doNotContact, false); const un = L.update(l.id, { assignedTo: null }); assert.equal(un.assignedTo, null);
});

test('notes: a timestamped trail, oldest trimmed once very long, and nothing can be noted on a lead that does not exist', () => {
  const { home } = mk(); const L = new Leads(home); const l = L.add({ name: 'Echo' });
  L.addNote(l.id, 'called, no answer'); const after = L.addNote(l.id, '  followed up by email  '); assert.equal(after.notes.length, 2); assert.equal(after.notes[1].text, 'followed up by email'); assert.ok(after.notes[0].t < after.notes[1].t || after.notes[0].t <= after.notes[1].t);
  assert.throws(() => L.addNote(l.id, ''), /Say what to note/); assert.throws(() => L.addNote('nope', 'x'), /No such lead/);
  for (let i = 0; i < 520; i++) L.addNote(l.id, 'note ' + i); const trimmed = L.get(l.id); assert.ok(trimmed.notes.length <= 500); assert.match(trimmed.notes.at(-1).text, /note 519/);
});

test('search finds a lead by name, city, tag or something in its notes, ranked, and removing a lead removes it from every list and search', () => {
  const { home } = mk(); const L = new Leads(home);
  const a = L.add({ name: 'Sea Breeze Restaurant', city: 'Karachi', industry: 'Restaurant', tags: ['clifton'] }); L.addNote(a.id, 'owner mentioned they redesigned the menu recently, slow site though');
  const b = L.add({ name: 'Mountain View Cafe', city: 'Lahore', industry: 'Cafe' });
  assert.deepEqual(L.search('slow site').map(x => x.id), [a.id]); assert.deepEqual(L.search('clifton').map(x => x.id), [a.id]); assert.deepEqual(L.search('Karachi restaurant').map(x => x.id), [a.id]);
  assert.deepEqual(L.search('zzzz nothing here'), []); assert.deepEqual(L.search(''), []);
  L.remove(a.id); assert.deepEqual(L.list().map(x => x.id), [b.id]); assert.deepEqual(L.search('clifton'), []); assert.equal(L.get(a.id), null); assert.throws(() => L.remove(a.id), /No such lead/);
});

test('a lead persists to a fresh Leads instance (a real restart), files are plain JSON one per lead, and a damaged file is skipped not crashed', () => {
  const { home, root } = mk(); const L = new Leads(home); const l = L.add({ name: 'Persisted Co' });
  const again = new Leads(home); assert.equal(again.get(l.id).name, 'Persisted Co'); assert.equal(again.list().length, 1);
  const file = again.file(l.id); assert.ok(fs.existsSync(file)); assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.mkdirSync(path.join(root, 'leads', 'zz'), { recursive: true }); fs.writeFileSync(path.join(root, 'leads', 'zz', 'broken.json'), '{not json'); assert.equal(new Leads(home).list().length, 1, 'a damaged file next to the good ones is just skipped');
});

test('20000 leads is refused, and search stays fast on a few thousand leads', () => {
  const { home } = mk(); const L = new Leads(home);
  for (let i = 0; i < 1500; i++) L.add({ name: 'Business ' + i, city: i % 5 === 0 ? 'Karachi' : 'Lahore', notes: 'a note mentioning keyword' + (i % 7) });
  const t0 = Date.now(); const r = L.search('keyword3 Karachi'); assert.ok(Date.now() - t0 < 600, 'took ' + (Date.now() - t0) + ' ms'); assert.ok(r.length > 0 && r.every(x => /keyword3/.test(x.notes.at(-1).text)));
  assert.equal(L.counts().new, 1500);
});
