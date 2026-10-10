'use strict';
// YAML is a configuration document, never a scheduler, permission grant or runtime state store.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const yaml = require('js-yaml');
const { validId } = require('./home');
const { atomicWrite, readJob } = require('./job-storage');
const { Library } = require('./library');
const MAX_BYTES = 65536, MAX_WORKERS = 50;
const FIELDS = ['engine', 'workerProvider', 'workerModel', 'workerContext'];
const hash = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const plain = x => !!x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
function keys(obj, allowed) {
  if (!plain(obj) || Object.keys(obj).some(k => !allowed.includes(k))) throw new Error('Unknown or unsupported configuration field.');
}
function validate(doc) {
  keys(doc, ['schemaVersion', 'revision', 'workers']);
  if (doc.schemaVersion !== 1 || typeof doc.revision !== 'string' || !/^[a-f0-9]{64}$/.test(doc.revision)) throw new Error('Use schemaVersion 1 and the revision from a fresh export.');
  if (!Array.isArray(doc.workers) || doc.workers.length > MAX_WORKERS) throw new Error('Provide at most 50 existing workers.');
  const seen = new Set();
  for (const w of doc.workers) {
    keys(w, ['id', 'config', 'skills', 'packs']);
    if (typeof w.id !== 'string' || !validId(w.id) || w.id === 'jarvis' || seen.has(w.id)) throw new Error('Worker IDs must be unique existing crew IDs.');
    seen.add(w.id); keys(w.config, FIELDS);
    if (FIELDS.some(k => !Object.hasOwn(w.config, k))) throw new Error('Each worker requires all four configuration fields; null inherits the default.');
    const c = w.config; w.config = Object.fromEntries(FIELDS.map(k => [k, c[k]]));
    if (c.engine !== null && !['builtin', 'hermes', 'opencode'].includes(c.engine)) throw new Error('Unsupported worker engine.');
    if (c.workerProvider !== null && !['gemini', 'openai', 'anthropic', 'openrouter', 'custom'].includes(c.workerProvider)) throw new Error('Unsupported worker provider.');
    if (c.workerModel !== null && (typeof c.workerModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(c.workerModel))) throw new Error('Use a model ID of at most 200 characters, or null.');
    if (c.workerContext !== null && (!Number.isSafeInteger(c.workerContext) || c.workerContext < 1024 || c.workerContext > 2000000)) throw new Error('Context must be an integer from 1024 to 2000000, or null.');
    for (const kind of ['skills', 'packs']) {
      if (!Array.isArray(w[kind]) || w[kind].length > 200 || new Set(w[kind]).size !== w[kind].length || w[kind].some(s => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(s))) throw new Error('Skills and packs must contain unique existing Library IDs.');
      w[kind].sort();
    }
  }
  doc.workers.sort((a, b) => a.id.localeCompare(b.id));
  return doc;
}
function parse(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Configuration must be YAML text of at most 64 KiB.');
  let doc, depth = 0;
  try {
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA, listener: (event, state) => {
      if (event === 'open' && ++depth > 12) throw new Error('depth');
      if (event === 'close') {
        depth--;
        // Reject anchors before aliases can expand or introduce shared/cyclic objects.
        if (state.anchor !== null) throw new Error('anchor');
      }
    } });
  } catch { throw new Error('Invalid YAML. Use one plain document without duplicate keys, anchors, aliases or custom tags.'); }
  return validate(doc);
}
function validateJournal(j) {
  if (!plain(j) || j.version !== 1 || !Array.isArray(j.events) || j.events.length > 100 || j.events.some(e => !plain(e) || typeof e.id !== 'string' || !['prepared', 'applied', 'partial', 'acknowledged'].includes(e.status))) throw new Error('Configuration history is damaged.');
  return j;
}
function assertReady(home) {
  const file = home.p('logs', 'crew-config.json');
  let stat; try { stat = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576 || [home.root, home.p('logs')].some(p => fs.lstatSync(p).isSymbolicLink())) throw new Error('Configuration history is unavailable. Inspect it before starting jobs.');
  let j; try { j = validateJournal(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { throw new Error('Configuration history is damaged. Inspect it before starting jobs.'); }
  if (j.events.some(e => ['prepared', 'partial'].includes(e.status))) throw new Error('An incomplete crew import blocks new jobs. Inspect and acknowledge it in Settings > Crew configuration.');
}
function createCrewConfig({ home, library = new Library(home), getCfg = () => ({}), isBusy = () => false, bus, now = Date.now, write = atomicWrite }) {
  const previews = new Map();
  // This is an apply receipt/history only. Accepted configuration remains in agent.json and Library.
  const journalFile = () => home.p('logs', 'crew-config.json');
  function safe(file, optional = false) {
    const rel = path.relative(home.root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Configuration path is outside Orbit home.');
    let cur = home.root;
    for (const part of ['', ...rel.split(path.sep)]) {
      if (part) cur = path.join(cur, part);
      try { if (fs.lstatSync(cur).isSymbolicLink()) throw new Error('Configuration cannot use symbolic links.'); }
      catch (e) { if (optional && e.code === 'ENOENT') return false; throw e; }
    }
    return true;
  }
  function read(file, fallback) {
    if (!safe(file, fallback !== undefined)) return fallback;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('Configuration record is not a bounded regular file.');
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('Configuration record is damaged; repair it before importing.'); }
  }
  function journal() {
    const j = read(journalFile(), { version: 1, events: [] });
    return validateJournal(j);
  }
  function save(j) {
    while (Buffer.byteLength(JSON.stringify(j)) > 524288 && j.events.length > 1 && !['prepared', 'partial'].includes(j.events[0].status)) j.events.shift();
    if (Buffer.byteLength(JSON.stringify(j)) > 524288) throw new Error('Configuration history is full.');
    safe(journalFile(), true); write(journalFile(), j);
  }
  function snapshot() {
    safe(home.p('agents'));
    const raw = [], workers = [];
    const dirs = fs.readdirSync(home.p('agents'), { withFileTypes: true });
    if (dirs.some(d => d.isSymbolicLink())) throw new Error('Worker folders cannot be symbolic links.');
    const assignments = read(library.p('assignments.json'), {});
    if (!plain(assignments)) throw new Error('Library assignments are damaged.');
    for (const d of dirs.filter(d => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!validId(d.name)) throw new Error('Invalid worker folder.');
      const saved = read(home.p('agents', d.name, 'agent.json'));
      if (!plain(saved) || saved.id !== d.name) throw new Error('Worker record identity does not match its folder.');
      const a = Object.hasOwn(assignments, d.name) ? assignments[d.name] : { skills: [], packs: [] };
      if (!plain(a)) throw new Error('Library assignment is damaged.');
      raw.push(saved);
      workers.push({ id: saved.id, config: Object.fromEntries(FIELDS.map(k => [k, saved[k] === undefined || saved[k] === '' ? null : saved[k]])), skills: [...(a.skills || [])], packs: [...(a.packs || [])] });
    }
    // Catalog readers normally hide malformed entries. Import revisions must not hide them.
    for (const [kind, record] of [['skills', 'SKILL.md'], ['packs', 'pack.json']]) {
      const dir = library.p(kind); if (!safe(dir, true)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Library folders cannot be symbolic links.');
        if (!entry.isDirectory()) continue;
        if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(entry.name)) throw new Error('Invalid Library folder.');
        const file = library.p(kind, entry.name, record); safe(file);
        if (kind === 'packs' && !plain(read(file))) throw new Error('Library pack metadata is damaged.');
      }
    }
    const skills = library.skills(), packs = library.packs();
    const revision = hash({ raw, assignments, skills, packs, defaults: getCfg() });
    const doc = validate({ schemaVersion: 1, revision, workers });
    if (Buffer.byteLength(JSON.stringify(doc)) > MAX_BYTES - 4096) throw new Error('Crew configuration exceeds the export limit.');
    return { doc, skills: new Set(skills.map(s => s.slug)), packs: new Set(packs.map(p => p.slug)) };
  }
  function exported() {
    const { doc } = snapshot(), j = journal();
    const unresolved = j.events.filter(e => ['prepared', 'partial'].includes(e.status));
    const text = '# Orbit crew configuration v1. No credentials, permissions or runtime state.\n# Omitted workers stay unchanged. null inherits crew defaults.\n' + yaml.dump(doc, { schema: yaml.JSON_SCHEMA, noRefs: true, lineWidth: 100, sortKeys: false });
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Crew configuration exceeds the export limit.');
    return { text, revision: doc.revision, unresolved };
  }
  function checkIdle() {
    if (isBusy() || home.recoveryFaults?.size) throw new Error('Stop or finish active jobs and resolve recovery faults before changing crew configuration.');
    // Read directly: listJobs intentionally ignores damaged records and is unsuitable for this gate.
    for (const actor of ['jarvis', ...snapshot().doc.workers.map(w => w.id)]) {
      const dir = path.join(home.agentDir(actor), 'jobs'); if (!safe(dir, true)) continue;
      for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
        safe(path.join(dir, file)); const job = readJob(home, actor, file.slice(0, -5));
        if (['queued', 'running', 'retrying'].includes(job.status) || job.qa?.test?.status === 'running') throw new Error('Queued or running jobs must be stopped before importing configuration.');
      }
    }
  }
  function diff(doc, snap) {
    if (doc.revision !== snap.doc.revision) throw new Error('Configuration revision changed. Export again and review a fresh diff.');
    const cfg = getCfg(), changes = [];
    for (const w of doc.workers) {
      const before = snap.doc.workers.find(x => x.id === w.id);
      if (!before) throw new Error('YAML v1 updates existing workers only. Create workers through Add crew first.');
      if ((w.config.engine || cfg.engine || 'builtin') === 'builtin' && (w.config.workerProvider || cfg.workerProvider || 'gemini') !== 'gemini') throw new Error('Built-in workers require Gemini.');
      for (const kind of ['skills', 'packs']) if (w[kind].some(id => !snap[kind].has(id))) throw new Error('A referenced Library skill or pack does not exist.');
      for (const k of FIELDS) if (before.config[k] !== w.config[k]) changes.push({ id: w.id, field: k, before: before.config[k], after: w.config[k] });
      for (const k of ['skills', 'packs']) if (JSON.stringify(before[k]) !== JSON.stringify(w[k])) changes.push({ id: w.id, field: k, before: before[k], after: w[k] });
    }
    return changes;
  }
  function preview(text) {
    const doc = parse(text), snap = snapshot(), changes = diff(doc, snap);
    if (journal().events.some(e => ['prepared', 'partial'].includes(e.status))) throw new Error('An incomplete import needs inspection and acknowledgement first.');
    for (const [k, v] of previews) if (now() - v.at > 300000) previews.delete(k);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const token = crypto.randomUUID(); previews.set(token, { doc, changes, at: now(), root: home.root });
    return { token, revision: doc.revision, changes, expiresInSeconds: 300 };
  }
  function apply(token) {
    const p = previews.get(token); previews.delete(token);
    if (!p || p.root !== home.root || now() - p.at > 300000) throw new Error('Preview expired or already used. Preview again.');
    checkIdle(); const snap = snapshot(), changes = diff(p.doc, snap);
    const j = journal(); if (j.events.some(e => ['prepared', 'partial'].includes(e.status))) throw new Error('Inspect the incomplete import first.');
    if (!changes.length) return { changed: 0, revision: snap.doc.revision };
    const receipt = { id: crypto.randomUUID(), at: new Date(now()).toISOString(), origin: 'human_main_window', status: 'prepared', baseRevision: snap.doc.revision, documentHash: hash(p.doc), changes, appliedWorkers: [] };
    j.events = [...j.events, receipt].slice(-100); save(j); // Must persist intent BEFORE any configuration write.
    try {
      for (const w of p.doc.workers.filter(w => changes.some(c => c.id === w.id))) {
        home.updateAgent(w.id, w.config); library.setAssignment(w.id, w);
        receipt.appliedWorkers.push(w.id); save(j);
      }
      const after = snapshot();
      for (const w of p.doc.workers) if (hash(after.doc.workers.find(x => x.id === w.id)) !== hash({ id: w.id, config: w.config, skills: w.skills, packs: w.packs })) throw new Error('Stored configuration verification failed.');
      receipt.status = 'applied'; receipt.resultRevision = after.doc.revision; save(j);
      try { bus?.emit('crew-config:applied', { changed: changes.length, receiptId: receipt.id }); } catch { /* receipt is already durable */ }
      return { changed: changes.length, revision: after.doc.revision, receiptId: receipt.id };
    } catch {
      receipt.status = 'partial'; try { save(j); } catch { /* durable prepared intent still blocks further imports */ }
      throw new Error('Import was not fully verified. Some settings may have changed. Inspect current export and incomplete-import history; nothing will replay automatically.');
    }
  }
  function acknowledge(input) {
    keys(input, ['revision', 'receiptIds']); const { revision, receiptIds } = input;
    checkIdle(); const s = snapshot(); if (revision !== s.doc.revision) throw new Error('Configuration revision changed. Inspect a fresh export.');
    const j = journal();
    const ids = j.events.filter(e => ['prepared', 'partial'].includes(e.status)).map(e => e.id).sort();
    if (!Array.isArray(receiptIds) || JSON.stringify([...receiptIds].sort()) !== JSON.stringify(ids)) throw new Error('Incomplete-import history changed. Inspect it again.');
    for (const e of j.events) if (['prepared', 'partial'].includes(e.status)) {
      e.previousStatus = e.status; e.status = 'acknowledged'; e.inspectedRevision = revision; e.acknowledgedAt = new Date(now()).toISOString(); e.acknowledgedBy = 'human_main_window';
    }
    save(j); previews.clear(); return { revision };
  }
  return { export: exported, preview, apply, acknowledge };
}
function register({ ipcMain, isTrusted, ...options }) {
  const service = createCrewConfig(options);
  for (const op of ['export', 'preview', 'apply', 'acknowledge']) ipcMain.handle('crew-config:' + op, (event, arg) => {
    if (!isTrusted(event)) return { ok: false, error: 'Crew configuration requires the main application window.' };
    try { return { ok: true, ...service[op](arg) }; }
    catch (e) { return { ok: false, error: e.message.startsWith('EPERM') || e.code ? 'Configuration storage is unavailable. Existing files were preserved where possible; inspect before retrying.' : e.message }; }
  });
  return service;
}
module.exports = { createCrewConfig, register, parse, validate, assertReady };
