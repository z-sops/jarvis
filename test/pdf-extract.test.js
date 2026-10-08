'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/pdf-extract');

const skip = P.available() ? false : 'pdfjs-dist is not installed (npm install pdfjs-dist@6.3.289)';
const fx = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf', name));

test('requiring the module never fails, even before "npm install" has run', () => { assert.equal(typeof P.extractPdfText, 'function'); assert.equal(typeof P.available, 'function'); assert.equal(typeof P.available(), 'boolean'); });

test('a real PDF: chapter headings (bigger type) become Markdown headings, wrapped lines join into flowing paragraphs, and the PDF\'s own title is picked up', { skip }, async () => {
  const r = await P.extractPdfText(fx('plain.pdf')); assert.equal(r.pages, 2); assert.equal(r.title, 'The Little SEO Book');
  assert.match(r.text, /^#+ Chapter 1: Title Tags$/m); assert.match(r.text, /^#+ Chapter 2: Meta Descriptions$/m);
  assert.match(r.text, /Keep titles under 60 characters\. Put the main keyword near the start of the title\. Every page on the site needs its own unique title, never copied from another page\./, 'a wrapped paragraph reads as one flowing sentence, not broken mid-word'); assert.ok(!/\n[a-z]/.test(r.text.replace(/^#.*\n/gm, '')), 'no line starts with a lower-case letter straight after a break (a sign a sentence was cut)');
});

test('a scanned or image-only PDF (no text layer) is refused in plain words, not left empty and not crashed', { skip }, async () => { await assert.rejects(P.extractPdfText(fx('empty.pdf')), /No text could be found.*scan or a set of images/); });
test('a password-protected PDF is refused in plain words', { skip }, async () => { await assert.rejects(P.extractPdfText(fx('password.pdf')), /password protected/); });
test('not a PDF at all, or nothing, or the wrong type: refused in plain words, never a raw crash', { skip }, async () => {
  await assert.rejects(P.extractPdfText(Buffer.from('this is not a pdf, just some bytes')), /invalid or damaged/); await assert.rejects(P.extractPdfText(Buffer.alloc(0)), /empty/); await assert.rejects(P.extractPdfText(null), /empty/); await assert.rejects(P.extractPdfText('a string, not a buffer'), /empty/); await assert.rejects(P.extractPdfText(undefined), /empty/);
});

test('a PDF with more pages than the limit is refused before it is fully read, so a huge book cannot hang the app; a raised limit lets it through', { skip }, async () => {
  await assert.rejects(P.extractPdfText(fx('manypages.pdf'), { maxPages: 10 }), /more than the 10 this can read in one go\. Split it/); const r = await P.extractPdfText(fx('manypages.pdf'), { maxPages: 20 }); assert.equal(r.pages, 12);
});

test('a very long book is refused once it passes the character limit, rather than silently truncated', { skip }, async () => {
  await assert.rejects(P.extractPdfText(fx('longtext.pdf'), { maxChars: 500 }), /more text than can be added at once/); const r = await P.extractPdfText(fx('longtext.pdf'), { maxChars: 500000 }); assert.ok(r.text.length > 10000);
});

test('the cmaps and fonts paths end with a real forward slash, never the OS separator (a real Windows failure: pdfjs-dist refused a backslash-terminated path)', () => {
  const src = fs.readFileSync(require.resolve('../lib/pdf-extract.js'), 'utf8');
  assert.doesNotMatch(src, /\+ path\.sep/, 'path.sep must not be used for cMapUrl/standardFontDataUrl: it is a backslash on Windows, which pdfjs-dist refuses with "must include trailing slash"');
  assert.match(src, /'cmaps'\) \+ '\/'/, 'cmaps ends with a literal forward slash'); assert.match(src, /'standard_fonts'\) \+ '\/'/, 'standard_fonts ends with a literal forward slash');
});

test('a Windows-style path still works: a backslash anywhere earlier in the path is fine, only the trailing character matters', { skip }, async () => {
  // pdfjs-dist demanded the STRING end with '/'; it does not care whether backslashes appear earlier in the path
  // (an ordinary Windows folder like "G:\jarvis-claude\bridge-os\node_modules\pdfjs-dist\cmaps\" is what actually failed).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const winLikeCmaps = root.split(path.sep).join('\\') + '\\cmaps/', winLikeFonts = root.split(path.sep).join('\\') + '\\standard_fonts/';
  const task = pdfjs.getDocument({ data: new Uint8Array(fx('plain.pdf')), isEvalSupported: false, disableFontFace: true, useWorkerFetch: false, disableWorker: true, cMapUrl: winLikeCmaps, cMapPacked: true, standardFontDataUrl: winLikeFonts });
  const doc = await task.promise; assert.equal(doc.numPages, 2); await task.destroy();
});
