'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { convert, MAX_FILES, MAX_BODY, MAX_DESC } = require('../lib/book2skill');

const okRel = rel => /^(references|templates)\/[A-Za-z0-9._-]+\.(md|txt)$/.test(rel);   // the Library's own rule for extra files
const book = (n, words) => '# My Book\n\nIntro text.\n\n' + Array.from({ length: n }, (_, i) => `## Chapter ${i + 1}\n\n` + ('word '.repeat(words) + '\n\n')).join('');

test('a small book becomes a short SKILL.md and parts the Library accepts', () => {
  const r = convert(book(4, 300));
  assert.equal(r.name, 'My Book'); assert.ok(r.parts >= 1 && r.parts <= MAX_FILES);
  assert.ok(r.description.length <= MAX_DESC && /Chapter 1/.test(r.description));
  assert.ok(r.body.length < MAX_BODY && /references\/part-01\.md/.test(r.body) && /Chapter 2/.test(r.body));
  for (const rel of Object.keys(r.files)) assert.ok(okRel(rel), rel);
  assert.ok(Object.values(r.files).join('\n').includes('Chapter 4'), 'all of the text is kept');
});

test('a book with many chapters is grouped into at most 19 files, each under 200000 characters', () => {
  const r = convert(book(120, 2000));   // 120 chapters of about 10 KB
  assert.ok(r.parts <= MAX_FILES, 'parts: ' + r.parts);
  for (const [rel, txt] of Object.entries(r.files)) { assert.ok(okRel(rel)); assert.ok(txt.length < 200000, rel + ' ' + txt.length); }
  const all = Object.values(r.files).join('\n'); for (const k of [1, 60, 120]) assert.ok(all.includes('## Chapter ' + k + '\n'), 'chapter ' + k);
});

test('one very long chapter is cut at paragraphs, and a # inside a code block is not a heading', () => {
  const long = '# Big\n\n## Only chapter\n\n' + Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ` + 'x'.repeat(900)).join('\n\n');
  const r = convert(long); for (const txt of Object.values(r.files)) assert.ok(txt.length < 200000);
  assert.ok(Object.values(r.files).join('\n').includes('Paragraph 399'));
  const code = convert('# B\n\n## One\n\n```sh\n# not a heading\necho hi\n```\n\ntext\n'); assert.equal(code.parts, 1); assert.ok(!/not a heading \|/.test(code.body));
});

test('a book too big for one skill is refused with a clear message; an empty one too; Urdu headings are fine', () => {
  assert.throws(() => convert(book(40, 25000)), /too big/);
  assert.throws(() => convert('   \n'), /empty/);
  const u = convert('# کتاب\n\n## پہلا باب\n\nمتن\n'); assert.ok(/part-01\.md/.test(Object.keys(u.files)[0]));
});

test('the command line makes a skill folder in a Library, skips one that exists, and --dry writes nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2s-')), lib = path.join(tmp, 'lib'); fs.mkdirSync(path.join(lib, 'packs'), { recursive: true }); fs.mkdirSync(path.join(lib, 'skills'), { recursive: true });
  const f = path.join(tmp, 'seo.md'); fs.writeFileSync(f, book(5, 400));
  const cli = path.join(__dirname, '..', 'book2skill.js'), run = (...a) => cp.spawnSync(process.execPath, [cli, f, ...a], { encoding: 'utf8' });
  assert.match(run('--library', lib, '--dry').stdout, /DRY/); assert.deepEqual(fs.readdirSync(path.join(lib, 'skills')), []);
  const r1 = run('--library', lib, '--name', 'SEO Basics'); assert.equal(r1.status, 0, r1.stdout); assert.match(r1.stdout, /OK/);
  const dir = path.join(lib, 'skills', 'seo-basics'); assert.ok(fs.existsSync(path.join(dir, 'SKILL.md'))); assert.ok(fs.existsSync(path.join(dir, 'references', 'part-01.md')));
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /^---\nname: seo-basics\ndescription: /);
  assert.match(run('--library', lib, '--name', 'SEO Basics').stdout, /SKIP/);
  assert.match(run('--library', lib, '--name', 'SEO Basics', '--replace').stdout, /OK/);
});
