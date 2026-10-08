'use strict';
// Turns a PDF's pages into readable, chunkable text: headings for lines in a clearly bigger font, paragraphs kept
// together, line-wraps re-joined into flowing sentences. No OCR: a scanned page with no text layer yields no text.
const path = require('path');
const { pathToFileURL } = require('url');

// pdfjs-dist is a real npm dependency, not something already on the user's computer, so nothing at the top of this
// file touches it: requiring this module must never fail just because "npm install" has not been run yet. Only
// actually reading a PDF needs it, and only then does a missing install turn into one clear sentence.
const NEEDS_INSTALL = 'PDF support needs one more piece that is not installed yet. In the Orbit folder, run:  npm install pdfjs-dist@6.3.289  then try again.';
let paths = null, pdfjsPromise = null;
function ensurePaths() {
  if (paths) return paths; let root; try { root = path.dirname(require.resolve('pdfjs-dist/package.json')); } catch { throw new Error(NEEDS_INSTALL); }
  // pdfjs-dist treats these two as URLs, not OS paths: it insists on a trailing forward slash even on Windows,
  // where path.sep is a backslash and gets refused ("must include trailing slash"). A real folder path ending
  // in '/' still opens fine through Node's fs on Windows.
  return (paths = { root, cmaps: path.join(root, 'cmaps') + '/', fonts: path.join(root, 'standard_fonts') + '/' });
}
function pdfjs() { const { root } = ensurePaths(); return pdfjsPromise || (pdfjsPromise = import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href).catch(e => { pdfjsPromise = null; throw new Error(NEEDS_INSTALL + (e && e.message ? ` (${e.message})` : '')); })); }
/** True once pdfjs-dist can actually be used (npm install has run); safe to call at any time, never throws. */
function available() { try { ensurePaths(); return true; } catch { return false; } }

const CODE_MAP = { 1: 'This PDF is password protected. Remove the password and try again.', 2: 'This PDF is invalid or damaged and could not be read.', 3: 'This PDF could not be read.' };

// One line per array entry, in reading order per page, with its vertical position and font size.
async function pageLines(doc, n) {
  const page = await doc.getPage(n), content = await page.getTextContent(); const lines = [];
  let cur = '', y = null, size = 0;
  for (const it of content.items) {
    if (!it.str) { if (it.hasEOL && cur) { lines.push({ text: cur, y, size }); cur = ''; } continue; }
    if (cur === '') { y = it.transform[5]; size = it.height || size; }
    cur += it.str;
    if (it.hasEOL) { lines.push({ text: cur, y, size }); cur = ''; }
  }
  if (cur) lines.push({ text: cur, y, size });
  return lines.filter(l => l.text.trim());
}

// Joins a page's lines into text: a run of similar-size lines close together is one paragraph (line-wraps joined
// with a space); a line clearly bigger than the body text becomes a Markdown heading; a big vertical gap, or a
// bullet/number starting a line, starts a new paragraph.
function pageText(lines, bodySize) {
  if (!lines.length) return '';
  const out = []; let para = '';
  const flush = () => { if (para.trim()) out.push(para.trim()); para = ''; };
  let prevY = null, prevSize = null;
  for (const l of lines) {
    const t = l.text.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const big = bodySize > 0 && l.size >= bodySize * 1.25;
    if (big) { flush(); const level = l.size >= bodySize * 1.8 ? 1 : l.size >= bodySize * 1.5 ? 2 : 3; out.push('#'.repeat(level) + ' ' + t); prevY = null; prevSize = null; continue; }
    const gap = prevY == null ? 0 : Math.abs(prevY - l.y), pitch = prevSize || l.size || 12, isBullet = /^([-*\u2022\u25CF\u25AA]|\d+[.)])\s/.test(t);
    if (prevY != null && (gap > pitch * 1.7 || isBullet)) flush();
    para += (para ? (isBullet ? '\n' : ' ') : '') + t; prevY = l.y; prevSize = l.size;
  }
  flush(); return out.join('\n\n');
}

/**
 * Reads a PDF buffer and returns { title, text, pages }. Throws a plain Error with a message meant for the person,
 * not the console, for a locked, damaged, empty or image-only file.
 */
async function extractPdfText(buffer, { maxPages = 2000, maxChars = 6000000 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('That file is empty.');
  const { cmaps, fonts } = ensurePaths(), lib = await pdfjs(); let task, doc;
  try { task = lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useWorkerFetch: false, disableWorker: true, cMapUrl: cmaps, cMapPacked: true, standardFontDataUrl: fonts }); doc = await task.promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('This PDF is password protected. Remove the password and try again.');
    const raw = e && (e.message || e.name); throw new Error((CODE_MAP[e && e.code] || 'This PDF is invalid or damaged and could not be read.') + (raw ? ` (${(e && e.name) || 'Error'}: ${raw})` : ''));   // the detail in parentheses is for diagnosing an unusual file, not meant to read as friendly on its own
  }
  try {
    if (doc.numPages > maxPages) throw new Error(`This PDF has ${doc.numPages} pages, more than the ${maxPages} this can read in one go. Split it and add the parts separately.`);
    let title = ''; try { const meta = await doc.getMetadata(); title = String((meta && meta.info && meta.info.Title) || '').trim(); } catch { /* no metadata: use the file name instead */ }
    const parts = []; let chars = 0, sizes = [];
    for (let n = 1; n <= doc.numPages; n++) { const lines = await pageLines(doc, n); for (const l of lines) if (l.size) sizes.push(l.size); }
    sizes.sort((a, b) => a - b); const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
    for (let n = 1; n <= doc.numPages; n++) {
      const t = pageText(await pageLines(doc, n), bodySize); if (!t) continue; parts.push(t); chars += t.length;
      if (chars > maxChars) throw new Error(`This PDF has more text than can be added at once (over ${Math.round(maxChars / 1000000)} MB). Split it and add the parts separately.`);
    }
    if (!parts.length) throw new Error('No text could be found in this PDF. It may be a scan or a set of images, which is not supported (no text recognition).');
    return { title, text: parts.join('\n\n'), pages: doc.numPages };
  } finally { try { await task.destroy(); } catch { /* best-effort cleanup */ } }
}

module.exports = { extractPdfText, available };
