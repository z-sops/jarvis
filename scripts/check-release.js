#!/usr/bin/env node
'use strict';
// Release check. Run it before building the installer (npm run dist does it for you), and with --dist after the build.
//   node scripts/check-release.js          checks the source files that go into the installer
//   node scripts/check-release.js --dist   also looks inside the built app (dist\win-unpacked\resources\app.asar)
// FAIL = the installer must not be built or shared. WARN = look at it, then decide. Nothing is changed or deleted.
// Secret values are never printed, only the file, the line and the kind.
// Optional: a file named .release-denylist (git-ignored) with one forbidden word per line, for example your own email address.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const distMode = process.argv.includes('--dist');
const fails = [], warns = [], oks = [];
const fail = m => fails.push(m), warn = m => warns.push(m), ok = m => oks.push(m);
const rel = f => path.relative(root, f).split(path.sep).join('/');
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return null; } };

let pkg; try { pkg = JSON.parse(read(path.join(root, 'package.json'))); } catch (e) { console.log('FAIL  package.json cannot be read: ' + e.message); process.exit(1); }
const build = pkg.build || {};

// 1. which files go into the installer
const patterns = Array.isArray(build.files) ? build.files : [];
if (!patterns.length) fail('package.json build.files is empty: the installer would take everything in the folder');
const files = new Set();
function walk(dir) { let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const d of list) { const p = path.join(dir, d.name); if (d.isDirectory()) walk(p); else files.add(p); } }
for (const pat of patterns) {
  if (pat.startsWith('!')) continue;
  const base = pat.replace(/\/\*\*(\/\*)?$/, '').replace(/\*\*?$/, '');
  const abs = path.join(root, base);
  if (/^node_modules\//.test(pat)) { if (!fs.existsSync(abs.replace(/\/?\*.*$/, '')) ) fail(`build.files lists ${pat} but it does not exist (run npm install)`); continue; }
  if (!fs.existsSync(abs)) { fail(`build.files lists ${pat} but it does not exist`); continue; }
  if (fs.statSync(abs).isDirectory()) walk(abs); else files.add(abs);
}
ok(`${files.size} files go into the installer (besides node_modules)`);

// 2. forbidden files
const BAD_NAME = /(^|\/)(\.env(\..*)?|settings\.json|[^/]*\.pem|[^/]*\.key|[^/]*\.bak|[^/]*\.log|BridgeHome|\.bridge-backup|\.update-backup|\.rename-backup)(\/|$)/i;
const badNames = [...files].map(rel).filter(f => BAD_NAME.test(f));
badNames.forEach(f => fail(`file that must not ship: ${f}`)); if (!badNames.length) ok('no .env, settings, keys, logs, backups or BridgeHome in the package');

// 3. secrets, personal paths, denylist (text files only)
const TEXT = /\.(js|mjs|cjs|json|html|css|md|txt|yml|yaml|svg|xml)$/i;
const SECRETS = [['Google API key', /AIza[0-9A-Za-z_\-]{35}/], ['OpenAI/Anthropic-style key', /sk-[A-Za-z0-9_\-]{20,}/], ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/], ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/], ['AWS key id', /AKIA[0-9A-Z]{16}/], ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]];
const PERSONAL = [['a Windows user folder', /[A-Za-z]:[\\/]{1,4}Users[\\/]{1,4}(?!Public\b|Default\b|you\b|user\b|name\b|<|%|\$|\{)[^\\/'"`\s]+/], ['a hard-coded drive path of this machine', /[A-Za-z]:[\\/]{1,4}(jarvis-claude|bridge-os)\b/i]];
const deny = (read(path.join(root, '.release-denylist')) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
let secretHits = 0, personalHits = 0, denyHits = 0;
for (const f of files) {
  if (!TEXT.test(f)) continue; const txt = read(f); if (txt == null) continue;
  txt.split(/\r?\n/).forEach((line, i) => {
    for (const [kind, re] of SECRETS) if (re.test(line)) { fail(`${kind} in ${rel(f)}:${i + 1}`); secretHits++; }
    for (const [kind, re] of PERSONAL) if (re.test(line)) { warn(`${kind} in ${rel(f)}:${i + 1}`); personalHits++; }
    for (const w of deny) if (line.toLowerCase().includes(w.toLowerCase())) { fail(`forbidden word from .release-denylist in ${rel(f)}:${i + 1}`); denyHits++; }
  });
}
if (!secretHits) ok('no API keys or tokens found in the package files');
if (!personalHits) ok('no personal folder paths found in the package files');
if (deny.length && !denyHits) ok(`none of the ${deny.length} words in .release-denylist found`);
if (!deny.length) warn('no .release-denylist file: add one with your own email address or name, one per line, to be sure none of it ships');

// 4. icon
{
  const icon = path.join(root, (build.win && build.win.icon) || 'assets/icon.png'); let b = null; try { b = fs.readFileSync(icon); } catch {}
  if (!b) fail(`icon missing: ${rel(icon)}`);
  else if (/\.png$/i.test(icon)) {
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) fail(`${rel(icon)} is not a PNG file`);
    else { const w = b.readUInt32BE(16), h = b.readUInt32BE(20); if (w < 256 || h < 256) fail(`${rel(icon)} is ${w}x${h}; Windows needs at least 256x256`); else if (w !== h) warn(`${rel(icon)} is ${w}x${h}, not square`); else ok(`icon ${w}x${h}`); }
  } else ok('icon found');
}

// 5. files the pages load must exist inside the package (nothing from node_modules, which is not shipped as such)
let refBad = 0;
for (const f of files) {
  const isCss = /\.css$/i.test(f), isHtml = /\.html?$/i.test(f); if (!isCss && !isHtml) continue; const txt = read(f) || '';
  const refs = []; let m;
  if (isCss) { const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g; while ((m = re.exec(txt))) refs.push(m[2]); }
  if (isHtml) { const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/g; while ((m = re.exec(txt))) refs.push(m[1]); }
  for (const r of refs) {
    if (/^(data:|https?:|#|mailto:|\/\/)/i.test(r)) continue;
    const target = path.resolve(path.dirname(f), r.split(/[?#]/)[0]);
    if (/node_modules/.test(rel(target))) { fail(`${rel(f)} loads ${r} from node_modules, which is not in the installer`); refBad++; }
    else if (!fs.existsSync(target)) { fail(`${rel(f)} loads ${r} but that file does not exist`); refBad++; }
    else if (!files.has(target)) { fail(`${rel(f)} loads ${r} but that file is not in build.files`); refBad++; }
  }
}
if (!refBad) ok('every stylesheet, script, font and image the pages load is in the package');

// 6. modules the app requires must be real dependencies
{
  const builtin = new Set(require('module').builtinModules); const deps = pkg.dependencies || {}, dev = pkg.devDependencies || {}; let bad = 0;
  for (const f of files) {
    if (!/\.(c?js|mjs)$/i.test(f) || /^renderer\//.test(rel(f))) continue; const txt = read(f) || ''; const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g; let m;
    while ((m = re.exec(txt))) {
      const name = m[2]; if (name.startsWith('.') || name.startsWith('node:') || builtin.has(name) || builtin.has(name.split('/')[0])) continue;
      const pn = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]; if (pn === 'electron' || deps[pn]) continue;
      if (dev[pn]) { fail(`${rel(f)} requires "${pn}", which is only a devDependency: it would be missing in the installer`); bad++; }
      else { warn(`${rel(f)} requires "${pn}", which is not in package.json dependencies (fine only if it is optional)`); bad++; }
    }
  }
  if (!bad) ok('every module the app requires is a dependency');
}

// 7. after the build: look inside the app
if (distMode) {
  const asarFile = path.join(root, (build.directories && build.directories.output) || 'dist', 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarFile)) fail(`no built app at ${rel(asarFile)}: run npm run dist:dir (or npm run dist) first`);
  else {
    let asar = null; for (const n of ['@electron/asar', 'asar']) { try { asar = require(require.resolve(n, { paths: [root] })); break; } catch {} }
    if (!asar) warn('the asar tool is not installed, so the inside of the built app was not listed');
    else {
      const list = asar.listPackage(asarFile).map(s => s.replace(/\\/g, '/').replace(/^\//, ''));
      const bad = list.filter(f => BAD_NAME.test(f) || /^(test|profile|docs|scripts)\//.test(f));
      bad.slice(0, 20).forEach(f => fail(`inside the built app: ${f}`)); if (!bad.length) ok(`built app holds ${list.length} entries and none of the forbidden ones`);
    }
  }
}

for (const m of oks) console.log('OK    ' + m);
for (const m of warns) console.log('WARN  ' + m);
for (const m of fails) console.log('FAIL  ' + m);
console.log(fails.length ? `\n${fails.length} problem(s): do not build or share the installer until these are fixed.` : `\nRelease check passed${warns.length ? ` (${warns.length} warning(s) to look at)` : ''}.`);
process.exit(fails.length ? 1 : 0);
