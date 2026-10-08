'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const M = require('../lib/memory');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));

test('notes: the old file format still reads, and a note that sets a rule is pinned', () => {
  const dir = tmp(), n = new M.Notes(path.join(dir, 'brain', 'memory', 'notes.md'));
  fs.mkdirSync(path.join(dir, 'brain', 'memory'), { recursive: true }); fs.writeFileSync(n.file, '- 2026-09-20 18:29  Do not call the user Commander.\n- 2026-09-19 10:00  Zee likes short answers\nCommissioned by Zee\n');
  const l = n.list(); assert.equal(l.length, 3); assert.deepEqual(l[0], { id: 0, pin: false, t: '2026-09-20 18:29', text: 'Do not call the user Commander.' }); assert.equal(l[2].t, '', 'a line in no format is kept as a note');
  const a = n.add('Please call me Zee, not Commander'); assert.equal(a.pin, true, 'call me ... is a rule'); assert.equal(n.add('Project Tin Tin uses Flutter').pin, false); assert.equal(n.add('Always answer in Roman Urdu', {}).pin, true); assert.equal(n.add('Ask before deleting', { pin: false }).pin, false, 'the user can say otherwise');
  assert.equal(n.list().length, 7, '3 old + 4 new'); assert.equal(n.add('  project TIN TIN uses flutter ').id, 4, 'the same note again is not added twice (only refreshed)'); assert.equal(n.list().length, 7);
  assert.throws(() => n.add('   '), /nothing to remember/); assert.equal(n.add('x'.repeat(900)).text.length, 500, 'a note is cut at 500 characters'); assert.match(fs.readFileSync(n.file, 'utf8'), /^- \[pin\] \d{4}-\d\d-\d\d \d\d:\d\d {2}Please call me Zee/m);
});

test('notes: change, pin, delete; the file stays one line per note', () => {
  const n = new M.Notes(path.join(tmp(), 'notes.md')); n.add('one'); n.add('two'); n.add('three'); n.update(1, { text: 'two\nchanged', pin: true }); assert.deepEqual(n.list().map(x => [x.text, x.pin]), [['one', false], ['two changed', true], ['three', false]]);
  assert.equal(fs.readFileSync(n.file, 'utf8').trim().split('\n').length, 3); n.remove(0); assert.deepEqual(n.list().map(x => x.text), ['two changed', 'three']); assert.deepEqual(n.list().map(x => x.id), [0, 1]); assert.throws(() => n.remove(9), /No such note/); assert.throws(() => n.update(0, { text: ' ' }), /cannot be empty/);
});

test('what goes into her prompt: pinned rules always, then the newest notes that fit, and she is told what was left out', () => {
  const list = [{ id: 0, pin: true, t: '2026-01-01 00:00', text: 'Call him Zee' }, ...Array.from({ length: 300 }, (_, i) => ({ id: i + 1, pin: false, t: '2026-02-01 00:00', text: 'note number ' + i + ' ' + 'x'.repeat(40) }))];
  const t = M.promptText(list, { max: 1500 }); assert.match(t, /\(Always true, the user set these rules:\)\n- 2026-01-01 00:00 {2}Call him Zee/); assert.match(t, /note number 299/); assert.ok(!/note number 0 /.test(t), 'the oldest ones are left out'); assert.match(t, /\(\d+ older notes exist: look for them with search_memory\.\)/); assert.ok(t.length < 1800);
  const old = [{ id: 0, pin: true, t: 'x', text: 'RULE' }].concat(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, pin: false, t: '', text: 'filler ' + i + ' ' + 'y'.repeat(50) }))); assert.match(M.promptText(old, { max: 800 }), /RULE/, 'a pinned rule survives however many notes come after it');
  assert.equal(M.promptText([]), '');
});

test('skills: a file each, a one-line description in the prompt, the steps only when she asks; old skill files still work; starters are written once', () => {
  const dir = tmp(), s = new M.Skills(path.join(dir, 'skills')); assert.equal(s.seedStarters(), true); assert.equal(s.seedStarters(), false, 'only once'); assert.equal(s.list().length, M.STARTERS.length);
  const idx = s.index(); assert.match(idx, /^- daily-briefing: A short hello with what is going on/m); assert.ok(!/Greet the user/.test(idx), 'the steps are not in the prompt'); assert.match(s.get('Research a topic').body, /web_search/); assert.equal(s.get('research-a-topic').title, 'Research a topic');
  fs.writeFileSync(path.join(dir, 'skills', 'legacy.md'), '# Legacy thing\n\nDo the old way first.\nThen the rest.\n'); const leg = s.get('legacy'); assert.equal(leg.title, 'Legacy thing'); assert.equal(leg.description, 'Do the old way first.'); assert.equal(s.get('nothing here'), null);
  fs.rmSync(path.join(dir, 'skills', 'research-a-topic.md')); assert.equal(s.seedStarters(), false); assert.equal(s.get('research-a-topic'), null, 'a starter the user deleted does not come back');
  const saved = s.save({ title: 'Weekly review', description: 'Every Friday', body: '- List the week\n- Ask what to carry over' }); assert.equal(saved.slug, 'weekly-review'); assert.match(fs.readFileSync(path.join(dir, 'skills', 'weekly-review.md'), 'utf8'), /^---\ndescription: Every Friday\n---\n# Weekly review/);
  const renamed = s.save({ slug: 'weekly-review', title: 'Friday review', description: 'd', body: 'steps' }); assert.equal(renamed.slug, 'friday-review'); assert.equal(s.get('weekly-review'), null, 'renaming moves the file'); assert.throws(() => s.save({ title: 'x', body: ' ' }), /needs steps/); assert.throws(() => s.save({ title: '!!!', body: 'a' }), /needs a name/); s.remove('friday-review'); assert.throws(() => s.remove('friday-review'), /No such skill/);
  assert.ok(!fs.readdirSync(path.join(dir, 'skills')).includes('README.md'));
});

test('how she addresses you: a title, or just your name; never "Commander" when you have none', () => {
  assert.equal(M.addressLine({ userName: 'Zee', userTitle: 'Commander' }), 'Zee is your Commander. Address them as "Commander" or "Zee".'); const none = M.addressLine({ userName: 'Zee', userTitle: '' }); assert.match(none, /^Call them Zee\./); assert.match(none, /never call them Commander/);
  assert.equal(M.addressName({ userName: 'Zee', userTitle: 'Commander' }), 'Commander Zee'); assert.equal(M.addressName({ userName: 'Zee', userTitle: '' }), 'Zee'); assert.equal(M.addressName({}), 'there'); assert.equal(M.addressName({ userName: 'Zee', userTitle: '  ' }), 'Zee');
});
