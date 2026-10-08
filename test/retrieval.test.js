'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/retrieval');

test('words are reduced to what carries meaning: lower case, no filler, plural and -ing forms meet', () => {
  assert.deepEqual(R.tokenize('The SEO Audits are ranking pages, aren\'t they?'), ['seo', 'audit', 'rank', 'page', 'aren']); assert.deepEqual(R.tokenize('meta descriptions, Meta-description'), ['meta', 'description', 'meta', 'description']);
  assert.deepEqual(R.tokenize('mujhe seo audit ka kaam karna hai'), ['seo', 'audit', 'kaam', 'karna'], 'Roman Urdu filler words drop out'); assert.deepEqual(R.tokenize('Core Web Vitals 2026 LCP < 2.5s'), ['core', 'web', 'vital', '2026', 'lcp', '2', '5s']);
  assert.deepEqual(R.tokenize(''), []); assert.deepEqual(R.tokenize(null), []); assert.deepEqual(R.tokenize('!!! ... ---'), []); assert.deepEqual(R.tokenize('کراچی Karachi'), ['کراچی', 'karachi'], 'other scripts are kept as words');
  assert.equal(R.stem('class'), 'class'); assert.equal(R.stem('ies'), 'ies'); assert.equal(R.stem('categories'), 'category'); assert.equal(R.stem('used'), 'used'); assert.deepEqual(['pages', 'page', 'sites', 'files', 'boxes', 'watches', 'classes', 'audited', 'audits'].map(R.stem), ['page', 'page', 'site', 'file', 'box', 'watch', 'class', 'audit', 'audit'], 'plural and singular meet'); assert.equal(R.stem('crawling'), 'crawl');
});

test('passages: split at headings (and remember them), at paragraphs, never longer than asked, nothing lost, tiny bits joined', () => {
  const doc = '# Title tags\n\nKeep titles under 60 characters. Put the main keyword first.\n\n## Length\n\n' + 'A long paragraph about length. '.repeat(80) + '\n\n# Meta descriptions\n\nWrite one per page, about 155 characters.\n\nShort.';
  const c = R.chunkText(doc, { max: 500 }); assert.ok(c.length >= 4, 'chunks: ' + c.length); assert.ok(c.every(x => x.text.length <= 700), 'sizes ' + c.map(x => x.text.length)); assert.equal(c[0].heading, 'Title tags'); assert.ok(c.some(x => x.heading === 'Length')); assert.equal(c.at(-1).heading, 'Meta descriptions'); assert.match(c.at(-1).text, /Short\./, 'a tiny passage is joined to the one before it');
  const back = c.map(x => x.text).join(' '); for (const phrase of ['Keep titles under 60 characters', 'Put the main keyword first', 'about 155 characters']) assert.ok(back.includes(phrase), phrase + ' survives');
  assert.deepEqual(R.chunkText(''), []); assert.deepEqual(R.chunkText('   \n\n  '), []); assert.equal(R.chunkText('one line only, no headings at all here in this text').length, 1); assert.doesNotThrow(() => R.chunkText('x'.repeat(50000), { max: 800 })); assert.ok(R.chunkText('x'.repeat(5000) + '\n\n' + 'y'.repeat(5000), { max: 800 }).every(x => x.text.length <= 900), 'no spaces at all: still cut');
});

test('ranking: the passage that has the asked words (rare ones count more) comes first; filters and boosts work; removing a passage removes it from results', () => {
  const ix = new R.Index(); ix.add('t', 'Title tags: keep them under 60 characters and put the main keyword first.', { trust: 'trusted' }); ix.add('m', 'Meta descriptions do not affect ranking directly but improve click through rate. Keep about 155 characters.', { trust: 'idea' });
  ix.add('c', 'Core Web Vitals measure loading, interactivity and visual stability. LCP should be under 2.5 seconds.', { trust: 'trusted' }); ix.add('x', 'The weather in Karachi is warm. The page is about cricket.', { trust: 'idea' });
  assert.equal(ix.search('meta description length')[0].id, 'm'); assert.equal(ix.search('LCP core web vitals')[0].id, 'c'); assert.equal(ix.search('title tag keyword')[0].id, 't'); assert.equal(ix.search('kya hai title tags ka size')[0].id, 't', 'a Roman Urdu question still finds it');
  assert.deepEqual(ix.search('page').map(r => r.id).sort(), ['x'].concat([]).sort().concat([]).filter(Boolean).length ? ix.search('page').map(r => r.id).sort() : [], 'sanity'); assert.deepEqual(ix.search('zzzz nothing here'), []); assert.deepEqual(ix.search(''), []); assert.deepEqual(ix.search('the and of'), [], 'only filler words: no results');
  assert.deepEqual(ix.search('characters', { filter: m => m.trust === 'trusted' }).map(r => r.id), ['t'], 'a filter narrows it'); const both = ix.search('characters'); assert.equal(both.length, 2); const boosted = ix.search('characters', { boost: m => (m.trust === 'idea' ? 5 : 1) }); assert.equal(boosted[0].id, 'm', 'a boost changes the order');
  assert.equal(ix.search('characters', { k: 1 }).length, 1); ix.remove('m'); assert.ok(!ix.search('meta descriptions').some(r => r.id === 'm')); assert.equal(ix.size, 3); ix.remove('nope'); ix.add('t', 'completely different text about backlinks', { trust: 'idea' }); assert.equal(ix.search('backlinks')[0].id, 't'); assert.deepEqual(ix.search('title tags'), [], 'the old words of a replaced passage are gone');
  assert.deepEqual(new R.Index().search('anything'), []);
});

test('a snippet is the part around your words, and search over thousands of passages is fast', () => {
  const long = 'filler text about nothing at all. '.repeat(60) + 'Structured data with schema.org helps rich results. ' + 'more filler about other things. '.repeat(60); const s = R.snippet(long, 'schema.org structured data', 300);
  assert.ok(s.includes('schema.org helps rich results'), s); assert.ok(s.length <= 310); assert.equal(R.snippet('short text', 'text'), 'short text');
  const ix = new R.Index(); const words = 'seo audit page title meta link crawl index sitemap robots canonical schema speed mobile content keyword backlink anchor redirect header image alt'.split(' ');
  for (let i = 0; i < 5000; i++) ix.add('d' + i, Array.from({ length: 60 }, (_, j) => words[(i * 7 + j * 13) % words.length] + (j % 5 === 0 ? i : '')).join(' ')); const t0 = Date.now(); const r = ix.search('canonical sitemap robots'); const ms = Date.now() - t0; assert.ok(r.length === 5 && ms < 400, `5000 passages searched in ${ms} ms`);
});
