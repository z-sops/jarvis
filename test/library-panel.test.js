'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const panel = require('../lib/library-panel');
const P = require('../lib/pdf-extract');

const skip = P.available() ? false : 'pdfjs-dist is not installed (npm install pdfjs-dist@6.3.289)';
const fx = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf', name));

function rig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-')), home = { p: (...a) => path.join(root, ...a) }, handlers = new Map();
  panel.register({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, home, win: () => null, listAgents: () => [{ id: 'alex', name: 'Alex', role: 'Developer' }] });
  const call = (ch, ...a) => handlers.get(ch)({}, ...a);
  call('library:pack:create', { name: 'SEO', description: 'Book notes', reviewDays: 90 });
  return { call, root };
}

test('uploading a whole book: a real PDF becomes one source with its chapters as headings, findable straight away', { skip }, async () => {
  const r = rig(); const base64 = fx('plain.pdf').toString('base64');
  const added = await r.call('library:source:file', { pack: 'seo', name: 'the-little-seo-book.pdf', dataBase64: base64, trust: 'trusted' });
  assert.equal(added.ok, true); assert.equal(added.added.source.title, 'The Little SEO Book', 'the book\'s own title, not the file name'); assert.ok(added.added.chunks >= 2);
  const found = await r.call('library:search', 'seo', 'meta description click rate', false); assert.equal(found.ok, true); assert.match(found.hits[0].text, /raises the click through rate/); assert.equal(found.hits[0].source.trust, 'trusted');
  const srcs = await r.call('library:sources', 'seo'); assert.equal(srcs.sources.length, 1); assert.equal(srcs.sources[0].origin.type, 'file'); assert.equal(srcs.sources[0].origin.ref, 'the-little-seo-book.pdf');
});

test('a password-protected, scanned, or plain broken PDF comes back as a message to show the person, never a crash', { skip }, async () => {
  const r = rig();
  for (const [file, pattern] of [['password.pdf', /password protected/], ['empty.pdf', /No text could be found/]]) { const x = await r.call('library:source:file', { pack: 'seo', name: file, dataBase64: fx(file).toString('base64') }); assert.equal(x.ok, false, file); assert.match(x.error, pattern, file); }
  const junk = await r.call('library:source:file', { pack: 'seo', name: 'nope.pdf', dataBase64: Buffer.from('not a pdf').toString('base64') }); assert.equal(junk.ok, false); assert.match(junk.error, /invalid or damaged/);
  const noData = await r.call('library:source:file', { pack: 'seo', name: 'x.pdf' }); assert.equal(noData.ok, false); assert.match(noData.error, /No file data/);
  const badB64 = await r.call('library:source:file', { pack: 'seo', name: 'x.pdf', dataBase64: 123 }); assert.equal(badB64.ok, false, 'a number is not real PDF bytes, so it is refused the same way a broken PDF is'); assert.match(badB64.error, /invalid or damaged/); assert.equal((await r.call('library:sources', 'seo')).sources.length, 0, 'nothing bad was left behind');
  const empty = await r.call('library:get'); assert.equal(empty.ok, true, 'the screen itself is unaffected by any of these failures');
});

test('other file types are unaffected by the PDF path: still read as text, still refused if not a text type', () => {
  const r = fx; const root = rig();
  return (async () => {
    const md = await root.call('library:source:file', { pack: 'seo', name: 'notes.md', text: '# A note about the audit checklist\n\nSome real body text about the checklist that is long enough to count as an actual source, not just a stray line.' }); assert.equal(md.ok, true, md.error);
    const exe = await root.call('library:source:file', { pack: 'seo', name: 'thing.exe', text: 'MZ' }); assert.equal(exe.ok, false); assert.match(exe.error, /\.md, \.txt, \.html, \.json, \.csv or \.pdf/);
  })();
});
