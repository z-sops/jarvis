#!/usr/bin/env node
'use strict';
// Turns markdown books into Orbit Library skills.
//   node book2skill.js <book.md | folder of .md files> --home <your BridgeHome folder> [--name "Skill name"] [--desc "When to use it"] [--dry] [--replace]
// It never overwrites a skill that exists unless you add --replace. --dry shows what would be made and writes nothing.
const fs = require('fs');
const path = require('path');
const { convert } = require('./lib/book2skill');

const args = process.argv.slice(2), opt = {}, rest = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--dry' || a === '--replace') opt[a.slice(2)] = true; else if (/^--(home|name|desc|library)$/.test(a)) opt[a.slice(2)] = args[++i]; else rest.push(a); }
const die = m => { console.log('\n' + m + '\n'); process.exit(1); };
if (!rest.length) die('Usage: node book2skill.js <book.md | folder> --home <BridgeHome folder> [--name "..."] [--desc "..."] [--dry] [--replace]');

let lib = null; try { lib = require('./lib/library'); } catch { /* the Library module is only used for the exact file format */ }
const slug = lib && lib.slug ? lib.slug : s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const skillText = lib && lib.skillText ? lib.skillText : s => `---\nname: ${s.name}\ndescription: ${String(s.description || '').replace(/\s+/g, ' ').trim().slice(0, 300)}\n---\n\n${String(s.body || '').trim()}\n`;

// Where is the Library? The folder that holds assignments.json, or "skills" and "packs" together.
function findLibrary() {
  if (opt.library) return path.resolve(opt.library);
  const home = opt.home || process.env.ORBIT_HOME; if (!home) die('Tell me where your BridgeHome folder is: --home <folder>');
  const root = path.resolve(home); if (!fs.existsSync(root)) die(`The folder ${root} does not exist.`);
  const hits = [];
  (function walk(d, depth) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const names = new Set(ents.map(e => e.name));
    if (names.has('assignments.json') || (names.has('skills') && names.has('packs'))) hits.push(d);
    if (depth < 3) for (const e of ents) if (e.isDirectory() && !/^(node_modules|\.git)$/.test(e.name)) walk(path.join(d, e.name), depth + 1);
  })(root, 0);
  if (!hits.length) die(`I could not find the Library inside ${root}. Open the Library screen in Orbit once, or give the folder with --library <folder>.`);
  if (hits.length > 1) die('More than one possible Library folder:\n  ' + hits.join('\n  ') + '\nGive the right one with --library <folder>.');
  return hits[0];
}

const input = path.resolve(rest[0]);
if (!fs.existsSync(input)) die(`Not found: ${input}`);
const books = fs.statSync(input).isDirectory() ? fs.readdirSync(input).filter(f => /\.(md|markdown|txt)$/i.test(f)).sort().map(f => path.join(input, f)) : [input];
if (!books.length) die('No .md files in that folder.');
if (books.length > 1 && (opt.name || opt.desc)) die('--name and --desc only make sense for one book.');
const libRoot = opt.dry ? null : findLibrary();
let made = 0, failed = 0;
for (const f of books) {
  const label = path.basename(f);
  try {
    const r = convert(fs.readFileSync(f, 'utf8'), { title: opt.name || undefined, name: opt.name, description: opt.desc });
    const sl = slug(r.name || path.basename(f, path.extname(f))) || slug(path.basename(f, path.extname(f))) || 'book';
    if (opt.dry) { console.log(`DRY   ${label} -> skill "${sl}": ${r.parts} part(s), ${Math.round(r.chars / 1000)} KB. Description: ${r.description}`); continue; }
    const dir = path.join(libRoot, 'skills', sl);
    if (fs.existsSync(dir) && !opt.replace) { console.log(`SKIP  ${label}: a skill called "${sl}" already exists (add --replace to replace it).`); continue; }
    if (fs.existsSync(dir)) fs.rmSync(path.join(dir, 'references'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    for (const [rel, txt] of Object.entries(r.files)) fs.writeFileSync(path.join(dir, ...rel.split('/')), txt);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText({ name: sl, description: r.description, body: r.body }));
    console.log(`OK    ${label} -> skill "${sl}" (${r.parts} part${r.parts > 1 ? 's' : ''}, ${Math.round(r.chars / 1000)} KB) in ${dir}`); made++;
  } catch (e) { console.log(`FAIL  ${label}: ${e.message}`); failed++; }
}
if (!opt.dry) console.log(`\n${made} skill(s) made${failed ? `, ${failed} failed` : ''}. Open the Library screen in Orbit and give the skill to a crew member.`);
process.exit(failed ? 1 : 0);
