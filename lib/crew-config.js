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
    if (c.workerProvider !== null && !['gemini', 'openai', 'anthropic', 'opencode', 'openrouter', 'custom'].includes(c.workerProvider)) throw new Error('Unsupported worker provider.');
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
function reconcile(receipt, doc) {
  const recorded = new Set(receipt.appliedWorkers || []);
  const targets = Array.isArray(receipt.workers) ? receipt.workers : [];
  const workers = targets.map(target => {
    const current = doc.workers.find(w => w.id === target.id);
    const row = { id: target.id, progressRecorded: recorded.has(target.id), status: 'unknown' };
    if (!current) return { ...row, status: 'missing' };
    const actualHash = hash(current);
    if (actualHash === target.beforeHash) row.status = 'unchanged';
    else if (actualHash === target.afterHash) row.status = 'matches_requested';
    else {
      const baseline = structuredClone(current), changes = receipt.changes.filter(c => c.id === target.id);
      let knownValues = true, before = false, after = false;
      for (const c of changes) {
        const value = FIELDS.includes(c.field) ? current.config[c.field] : current[c.field];
        if (JSON.stringify(value) === JSON.stringify(c.before)) before = true;
        else if (JSON.stringify(value) === JSON.stringify(c.after)) after = true;
        else knownValues = false;
        if (FIELDS.includes(c.field)) baseline.config[c.field] = c.before;
        else if (['skills', 'packs'].includes(c.field)) baseline[c.field] = c.before;
        else knownValues = false;
      }
      row.status = knownValues && before && after && hash(baseline) === target.beforeHash ? 'partial' : 'drifted';
    }
    return row;
  });
  return { baseRevision: receipt.baseRevision || null, currentRevision: doc.revision, requestedDocumentHash: receipt.documentHash || null,
    workers, legacyIntentWithoutWorkerHashes: !targets.length,
    inspectionRequired: true,
    rollback: { automatic: false, safety: 'not_established', reason: 'No complete protected-state rollback snapshot or cross-file transaction. Inspect current state; no automatic rollback or replay.' },
    note: 'Statuses compare current persisted public configuration with the recorded intent. Matching state is not proof of which process made the change; progressRecorded is separately journaled evidence.' };
}
function validateJournal(j) {
  if (!plain(j) || j.version !== 1 || !Array.isArray(j.events) || j.events.length > 100 || j.events.some(e => !plain(e) || typeof e.id !== 'string' || !['prepared', 'applied', 'partial', 'acknowledged', 'rolled_back'].includes(e.status))) throw new Error('Configuration history is damaged.');
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
    const unresolved = j.events.filter(e => ['prepared', 'partial'].includes(e.status)).map(e => ({ ...e, reconciliation: reconcile(e, doc) }));
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
  function rollbackDocument(input, snap, j) {
    keys(input, ['revision', 'receiptId']);
    if (input.revision !== snap.doc.revision) throw new Error('Configuration revision changed. Inspect a fresh export.');
    const pending = j.events.filter(e => ['prepared', 'partial'].includes(e.status));
    if (pending.length !== 1 || pending[0].id !== input.receiptId || pending[0].operation === 'rollback') throw new Error('Rollback requires one original incomplete import. Inspect linked or multiple incomplete receipts instead.');
    const source = pending[0];
    if (!Array.isArray(source.workers) || !source.workers.length || source.workers.length > MAX_WORKERS || !Array.isArray(source.changes) || source.changes.length > MAX_WORKERS * 6) throw new Error('Rollback intent is incomplete. Inspect current state instead.');
    const ids = new Set(), fields = new Set(), workers = [];
    for (const target of source.workers) {
      keys(target, ['id', 'beforeHash', 'afterHash']);
      if (ids.has(target.id) || !/^[a-f0-9]{64}$/.test(target.beforeHash) || !/^[a-f0-9]{64}$/.test(target.afterHash)) throw new Error('Rollback intent is damaged.');
      ids.add(target.id);
      const current = snap.doc.workers.find(w => w.id === target.id);
      if (!current) throw new Error('Rollback worker is missing. Inspect current state instead.');
      const before = structuredClone(current), after = structuredClone(current);
      for (const c of source.changes.filter(c => c.id === target.id)) {
        keys(c, ['id', 'field', 'before', 'after']);
        if (![...FIELDS, 'skills', 'packs'].includes(c.field) || fields.has(c.id + ':' + c.field)) throw new Error('Rollback intent is damaged.');
        fields.add(c.id + ':' + c.field);
        const value = FIELDS.includes(c.field) ? current.config[c.field] : current[c.field];
        if (![c.before, c.after].some(v => JSON.stringify(v) === JSON.stringify(value))) throw new Error('Configuration drift blocks rollback. Inspect current state instead.');
        if (FIELDS.includes(c.field)) { before.config[c.field] = c.before; after.config[c.field] = c.after; }
        else { before[c.field] = c.before; after[c.field] = c.after; }
      }
      // Both complete intent hashes must agree. Unknown fields and unrelated edits cannot be restored.
      const beforeDoc = validate({ schemaVersion: 1, revision: snap.doc.revision, workers: [before] });
      validate({ schemaVersion: 1, revision: snap.doc.revision, workers: [after] });
      if (hash(before) !== target.beforeHash || hash(after) !== target.afterHash) throw new Error('Configuration drift or damaged intent blocks rollback.');
      workers.push(beforeDoc.workers[0]);
    }
    if (source.changes.some(c => !plain(c) || !ids.has(c.id))) throw new Error('Rollback intent is damaged.');
    const doc = validate({ schemaVersion: 1, revision: snap.doc.revision, workers });
    diff(doc, snap); // Existing catalog and effective engine/provider restrictions still apply.
    return { doc, source };
  }
  function previewRollback(input) {
    checkIdle(); const snap = snapshot(), j = journal(), { doc, source } = rollbackDocument(input, snap, j);
    for (const [k, v] of previews) if (now() - v.at > 300000) previews.delete(k);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const changes = diff(doc, snap), token = crypto.randomUUID();
    previews.set(token, { doc, changes, at: now(), root: home.root, sourceId: source.id, journalHash: hash(j) });
    return { token, revision: doc.revision, changes, operation: 'rollback', expiresInSeconds: 300 };
  }
  function apply(token) {
    const p = previews.get(token); previews.delete(token);
    if (!p || p.root !== home.root || now() - p.at > 300000) throw new Error('Preview expired or already used. Preview again.');
    checkIdle(); const snap = snapshot(), changes = diff(p.doc, snap);
    const j = journal(); let source;
    if (p.sourceId) {
      if (hash(j) !== p.journalHash) throw new Error('Incomplete-import history changed. Preview rollback again.');
      ({ source } = rollbackDocument({ revision: p.doc.revision, receiptId: p.sourceId }, snap, j));
    } else if (j.events.some(e => ['prepared', 'partial'].includes(e.status))) throw new Error('Inspect the incomplete import first.');
    if (!changes.length && source) throw new Error('No settings need rollback. Record inspection of the current state instead.');
    if (!changes.length) return { changed: 0, revision: snap.doc.revision };
    const receipt = { id: crypto.randomUUID(), at: new Date(now()).toISOString(), origin: 'human_main_window', status: 'prepared', baseRevision: snap.doc.revision, documentHash: hash(p.doc), changes, workers: p.doc.workers.map(w => ({ id: w.id, beforeHash: hash(snap.doc.workers.find(x => x.id === w.id)), afterHash: hash({ id: w.id, config: w.config, skills: w.skills, packs: w.packs }) })), appliedWorkers: [] };
    if (source) { receipt.operation = 'rollback'; receipt.sourceReceiptId = source.id; }
    j.events.push(receipt);
    while (j.events.length > 100) { const i = j.events.findIndex(e => !['prepared', 'partial'].includes(e.status)); if (i < 0) throw new Error('Configuration history is full.'); j.events.splice(i, 1); }
    save(j); // Must persist intent BEFORE any configuration write.
    try {
      for (const w of p.doc.workers.filter(w => changes.some(c => c.id === w.id))) {
        home.updateAgent(w.id, w.config); library.setAssignment(w.id, w);
        receipt.appliedWorkers.push(w.id); save(j);
      }
      const after = snapshot();
      for (const w of p.doc.workers) if (hash(after.doc.workers.find(x => x.id === w.id)) !== hash({ id: w.id, config: w.config, skills: w.skills, packs: w.packs })) throw new Error('Stored configuration verification failed.');
      receipt.status = 'applied'; receipt.resultRevision = after.doc.revision;
      const sourceStatus = source?.status;
      if (source) { source.previousStatus = source.status; source.status = 'rolled_back'; source.rollbackReceiptId = receipt.id; }
      try { save(j); } catch (e) {
        // A failed terminal flush must leave both intents unresolved, even in the catch receipt.
        if (source) { source.status = sourceStatus; delete source.rollbackReceiptId; delete source.previousStatus; }
        throw e;
      }
      try { bus?.emit('crew-config:applied', { changed: changes.length, receiptId: receipt.id }); } catch { /* receipt is already durable */ }
      return { changed: changes.length, revision: after.doc.revision, receiptId: receipt.id, operation: source ? 'rollback' : 'import' };
    } catch {
      receipt.status = 'partial'; try { save(j); } catch { /* durable prepared intent still blocks further imports */ }
      throw new Error('Import was not fully verified. Some settings may have changed. Inspect current export and incomplete-import history; nothing will replay automatically.');
    }
  }
  function cancel(token) { previews.delete(token); return { cancelled: true }; }
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
  return { export: exported, preview, previewRollback, apply, cancel, acknowledge };
}
function register({ ipcMain, isTrusted, ...options }) {
  const service = createCrewConfig(options);
  for (const op of ['export', 'preview', 'previewRollback', 'apply', 'cancel', 'acknowledge']) ipcMain.handle('crew-config:' + op, (event, arg) => {
    if (!isTrusted(event)) return { ok: false, error: 'Crew configuration requires the main application window.' };
    try { return { ok: true, ...service[op](arg) }; }
    catch (e) { return { ok: false, error: e.message.startsWith('EPERM') || e.code ? 'Configuration storage is unavailable. Existing files were preserved where possible; inspect before retrying.' : e.message }; }
  });
  return service;
}
module.exports = { createCrewConfig, register, parse, validate, assertReady, reconcile };
