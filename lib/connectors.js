'use strict';
// Connectors: outside services (GitHub, Linear, Stripe, Supabase, or any MCP server with an https address) that the crew can use.
// Orbit owns the list. Hermes gets it through each crew member's profile: the address and the tools they may use go in config.yaml,
// the secret goes in the profile's .env and is only referred to as ${NAME} in config.yaml. The page never sees a saved secret.
const fs = require('fs');
const path = require('path');
const Policy = require('./browser-policy');
const { normalizeIdentities } = require('./neuralops-identity');

const RESERVED = new Set(['orbit', 'bridge', 'bridge-check', 'hermes', 'mcp', 'default']);

const CATALOG = [
  { id: 'github', name: 'GitHub', blurb: 'Repositories, issues, pull requests and code search.', url: () => 'https://api.githubcopilot.com/mcp/',
    tokenLabel: 'GitHub personal access token', tokenHelp: 'GitHub > Settings > Developer settings > Personal access tokens. A fine-grained token limited to the repositories the crew should see is best.', tokenLooksLike: /^(ghp_|github_pat_|gho_|ghu_|ghs_)/, options: [] },
  { id: 'linear', name: 'Linear', blurb: 'Issues, projects, cycles and comments.', url: o => (o.mode === 'read-write' ? 'https://mcp.linear.app/mcp' : 'https://mcp.linear.app/mcp/readonly'),
    tokenLabel: 'Linear API key', tokenHelp: 'Linear > Settings > Security and access > Personal API keys. A key with only the Read permission cannot change anything.', tokenLooksLike: /^lin_api_/, options: [] },
  { id: 'stripe', name: 'Stripe', blurb: 'Customers, payments, subscriptions and documentation.', url: () => 'https://mcp.stripe.com',
    tokenLabel: 'Stripe restricted API key (rk_...)', tokenHelp: 'Stripe Dashboard > Developers > API keys > Create restricted key. Start in test mode. A full secret key (sk_...) is refused.', tokenLooksLike: /^rk_(test|live)_/, refuse: [[/^sk_/, 'That is a full secret key. Create a restricted key (rk_...) with only the permissions the crew needs.']], options: [], warn: 'Live mode moves real money. Try test mode first.' },
  { id: 'files', name: 'Files', native: 'files', blurb: 'Read, and with your OK change, files in folders you choose. Orbit\'s own tools: nothing leaves your computer.', url: () => 'orbit://files', tokenLabel: '', tokenHelp: '', options: [],
    warn: 'Secret files (.env, keys, tokens) are never read. Every change keeps a backup of the old version. Moving never overwrites.' },
  { id: 'library', name: 'Library', native: 'library', auto: true, blurb: 'The skills and knowledge packs you give to crew members.', url: () => 'orbit://library', tokenLabel: '', tokenHelp: '', options: [] },
  { id: 'leads', name: 'Leads', native: 'leads', auto: true, blurb: 'The lead pipeline: businesses you are researching, pitching or working with, shared by the whole crew.', url: () => 'orbit://leads', tokenLabel: '', tokenHelp: '', options: [] },
  { id: 'neuralops', name: 'NeuralOps', blurb: 'The shared rulebook and record for the crew: tasks, handoffs, evidence and who may approve what. Runs on this computer.', url: () => 'http://127.0.0.1:3031/mcp',
    tokenLabel: 'NeuralOps broker token (nops_...)', tokenHelp: 'Register an Orbit broker in NeuralOps, then register a separate AI identity for each worker with that broker as its delegate. Paste the broker token here and set worker identities under Who can use it.', tokenLooksLike: /^nops_/, options: [],
    warn: 'Talks to NeuralOps on this computer only. The tools that grant or deny approvals always ask you first: only you decide those.',
    levelFor: n => (/^(neuralops_)?(authorize|grant_approval|deny|escalate)$/.test(n) ? 'ask' : 'free') },
  { id: 'supabase', name: 'Supabase', blurb: 'Databases, tables, logs and documentation of one project.', url: o => `https://mcp.supabase.com/mcp?project_ref=${encodeURIComponent(o.projectRef)}${o.mode === 'read-write' ? '' : '&read_only=true'}`,
    tokenLabel: 'Supabase personal access token (sbp_...)', tokenHelp: 'Supabase > Account > Access tokens > Generate new token.', tokenLooksLike: /^sbp_/, warn: 'Supabase says this connection is for development and testing, not for production data.',
    options: [{ key: 'projectRef', label: 'Project ID', help: 'Supabase > Project settings > General > Project ID. Limits the crew to this one project.', pattern: /^[a-z0-9]{8,40}$/, required: true }] }
];
const byId = Object.fromEntries(CATALOG.map(c => [c.id, c]));
const publicCatalog = () => CATALOG.filter(c => !c.auto).map(c => ({ id: c.id, name: c.name, native: !!c.native, blurb: c.blurb, tokenLabel: c.tokenLabel, tokenHelp: c.tokenHelp, warn: c.warn || '', options: (c.options || []).map(o => ({ key: o.key, label: o.label, help: o.help, required: !!o.required })) }));

/* ---------- which tools only read ---------- */
const READ = new Set(['get', 'list', 'search', 'read', 'find', 'fetch', 'describe', 'query', 'show', 'view', 'lookup', 'count', 'retrieve', 'browse', 'explain', 'inspect', 'check', 'docs']);
const WRITE = new Set(['create', 'update', 'delete', 'remove', 'write', 'send', 'post', 'merge', 'push', 'apply', 'deploy', 'execute', 'run', 'set', 'add', 'edit', 'close', 'reopen', 'assign', 'comment', 'fork', 'dispatch', 'approve', 'cancel', 'refund', 'pay', 'transfer', 'reset', 'pause', 'restore', 'rebase', 'revoke', 'upload', 'publish', 'trigger', 'invite', 'archive', 'unarchive', 'move', 'rename', 'save', 'submit', 'sync', 'enable', 'disable', 'rotate', 'grant', 'charge', 'capture', 'void', 'finalize', 'confirm', 'schedule', 'import', 'copy', 'clone', 'commit', 'reply', 'react', 'lock', 'unlock', 'mark', 'request', 'subscribe', 'unsubscribe']);
// A tool is treated as read-only only if its name has a reading word and no writing word. Anything unknown counts as writing.
function isReadTool(name, annotations) {
  const t = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), a = annotations || {};
  if (t.some(x => WRITE.has(x)) || a.destructiveHint === true) return false;                 // a writing word, or the server says it destroys: never read-only
  return t.some(x => READ.has(x)) || a.readOnlyHint === true;                                 // a reading word, or the server says it only reads
}

/* ---------- checking what the user typed ---------- */
function envName(id) { return 'ORBIT_CONN_' + String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_TOKEN'; }
function checkSpec(input, { allowInsecureLocal = false, fsOpts = null } = {}) {
  const o = input || {}, cat = byId[o.catalogId];
  if (o.catalogId && !cat) return { ok: false, error: 'That connector is not in the list.' };
  const id = cat ? cat.id : String(o.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(id) || id.includes('__')) return { ok: false, error: 'Give it a short name with letters and numbers (2 to 24 characters).' };
  if (RESERVED.has(id)) return { ok: false, error: `"${id}" is a reserved name.` };
  const mode = o.mode === 'read-write' ? 'read-write' : 'read-only', options = {};
  let url;
  if (cat && (cat.native === 'library' || cat.native === 'leads')) return { ok: true, id, name: cat.name, catalogId: cat.id, native: cat.native, roots: [], url: 'orbit://' + cat.native, mode: 'read-only', options: {}, token: '', auth: 'none', warn: '' };   // built in: nothing to choose
  if (cat && cat.native) {                                                                     // Orbit's own tools: folders, no address, no token
    const { checkRoots } = require('./fsmcp'), fo = fsOpts || {}, want = (Array.isArray(o.folders) ? o.folders : String(o.folders || '').split(/\r?\n/)).filter(x => String(x).trim());
    const r = checkRoots(want.length ? want : (fo.defaultRoots || []), fo); if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, id, name: cat.name, catalogId: cat.id, native: cat.native, roots: r.roots, url: 'orbit://' + cat.native, mode, options: {}, token: '', auth: 'none', warn: cat.warn || '' };
  }
  if (cat) {
    for (const opt of cat.options || []) { const v = String((o.options || {})[opt.key] || '').trim(); if (!v && opt.required) return { ok: false, error: `${opt.label} is needed.` }; if (v && opt.pattern && !opt.pattern.test(v)) return { ok: false, error: `${opt.label} does not look right.` }; options[opt.key] = v; }
    url = cat.url({ mode, ...options });
  } else {
    const u = Policy.checkUrl(String(o.url || '').trim(), { allowLocal: allowInsecureLocal });
    if (!u.ok) return { ok: false, error: u.error || 'That address is not allowed.' };
    if (!/^https:$/.test(new URL(u.url).protocol) && !allowInsecureLocal) return { ok: false, error: 'The address must start with https://.' };
    if (u.search) return { ok: false, error: 'Type the full address of the MCP server (https://...).' };
    url = u.url;
  }
  const token = String(o.token == null ? '' : o.token).trim().replace(/^Bearer\s+/i, '');
  if (token) {
    if (!/^[A-Za-z0-9._~+/=-]{8,500}$/.test(token)) return { ok: false, error: 'That token has characters or a length a token never has. Paste only the token.' };
    for (const [re, msg] of (cat && cat.refuse) || []) if (re.test(token)) return { ok: false, error: msg };
  } else if (cat) return { ok: false, error: `${cat.tokenLabel} is needed.` };
  return { ok: true, id, name: cat ? cat.name : String(o.name || id).trim().slice(0, 40), catalogId: cat ? cat.id : null, url, mode, options, token, auth: token ? 'bearer' : 'none', warn: cat && cat.warn || '' };
}

/* ---------- the list on disk ---------- */
class Connectors {
  constructor({ home, allowInsecureLocal = false, secretStorage = null }) { this.home = home; this.allowInsecureLocal = allowInsecureLocal; this.secretStorage = secretStorage; }
  get dir() { return this.home.p('connectors'); }
  get file() { return path.join(this.dir, 'connectors.json'); }
  get secretFile() { return path.join(this.dir, 'secrets.json'); }
  read(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } }
  write(f, data, mode) { fs.mkdirSync(this.dir, { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: mode || 0o644 }); fs.renameSync(tmp, f); }
  // A connector saved by the first version (a plain list of allowed tools) becomes levels: what was allowed keeps running (reading free, changing asks), the rest is blocked.
  migrate(c) {
    if (c.levels) return c; const allowed = new Set(c.allowed || []), levels = {};
    for (const n of c.tools || []) levels[n] = allowed.has(n) ? (isReadTool(n) ? 'free' : 'ask') : 'blocked';
    const { allowed: _old, ...rest } = c; return { ...rest, levels, desc: c.desc || {} };
  }
  list() { const d = this.read(this.file, { servers: [] }); return Array.isArray(d.servers) ? d.servers.map(c => this.migrate(c)) : []; }
  save(list) { this.write(this.file, { version: 1, servers: list }); }
  get(id) { return this.list().find(c => c.id === id) || null; }
  secrets() {
    let saved; try { saved = JSON.parse(fs.readFileSync(this.secretFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error('Connector credentials could not be read. Existing file preserved.'); }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid connector credential file.');
    if (saved.orbitSecretVersion !== undefined) { if (!this.secretStorage) throw new Error('Connector credential storage is locked.'); return this.secretStorage.open(saved); }
    if (this.secretStorage && Object.keys(saved).length && !this.secretStorage.available()) throw new Error('Connector credential storage is unavailable. Existing file preserved.');
    return saved;
  }
  protectSecrets() { if (!this.secretStorage || !fs.existsSync(this.secretFile)) return false; const s = this.secrets(); require('./job-storage').atomicWrite(this.secretFile, Object.keys(s).length ? this.secretStorage.seal(s) : {}); return true; }
  token(id) { return this.secrets()[id] || ''; }
  setToken(id, token) { const s = this.secrets(); if (token) s[id] = token; else delete s[id]; require('./job-storage').atomicWrite(this.secretFile, this.secretStorage && Object.keys(s).length ? this.secretStorage.seal(s) : s); }
  add(spec) {
    if (this.get(spec.id)) throw new Error(`A connector called "${spec.id}" already exists. Remove it first, or change its token.`);
    const rec = { id: spec.id, name: spec.name, catalogId: spec.catalogId, native: spec.native || null, roots: spec.roots || [], url: spec.url, auth: spec.auth, mode: spec.mode, options: spec.options, enabled: false, agents: 'all', tools: [], levels: {}, desc: {}, lastTest: null, created: new Date().toISOString() };
    this.save([...this.list(), rec]); if (spec.token) this.setToken(spec.id, spec.token); return rec;
  }
  update(id, patch) { const list = this.list(), i = list.findIndex(c => c.id === id); if (i < 0) throw new Error('No such connector.'); list[i] = { ...list[i], ...patch }; this.save(list); return list[i]; }
  remove(id) { this.save(this.list().filter(c => c.id !== id)); this.setToken(id, ''); }

  // The default level of a tool: reading = free; changing = ask (mode "read and ask") or blocked (mode "read only").
  defaultLevel(c, name, annotations) { const cat = byId[c.catalogId]; if (cat && typeof cat.levelFor === 'function') { const l = cat.levelFor(name); if (l) return l; } return isReadTool(name, annotations) ? 'free' : (c.mode === 'read-write' ? 'ask' : 'blocked'); }
  // After a test: remember the tools the service offers (with a short description). A level the user already chose is kept; new tools get the default.
  applyTools(id, tools) {
    const c = this.get(id); if (!c) throw new Error('No such connector.'); const list = tools.map(t => (typeof t === 'string' ? { name: t } : t));
    const levels = {}, desc = {}; for (const t of list) { levels[t.name] = (c.levels || {})[t.name] || this.defaultLevel(c, t.name, t.annotations); desc[t.name] = String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 200); }
    return this.update(id, { tools: list.map(t => t.name), levels, desc, lastTest: { ok: true, at: new Date().toISOString(), tools: list.length } });
  }
  setRoots(id, roots) { const c = this.get(id); if (!c || !c.native) throw new Error('This connector has no folders.'); return this.update(id, { roots }); }
  setNeuralopsIdentities(id, identities) {
    const c = this.get(id); if (!c || c.catalogId !== 'neuralops') throw new Error('This connector does not use NeuralOps identities.');
    return this.update(id, { neuralopsIdentities: normalizeIdentities(identities) });
  }
  levelOf(id, tool) { const c = this.get(id); return (c && c.levels && c.levels[tool]) || 'blocked'; }
  setLevel(id, tool, level) { const c = this.get(id); if (!c || !(c.tools || []).includes(tool)) throw new Error('No such tool.'); if (!['free', 'ask', 'blocked'].includes(level)) throw new Error('A level is free, ask or blocked.'); return this.update(id, { levels: { ...c.levels, [tool]: level } }); }
  // Read only: changing tools are blocked. Read and ask: they ask every time (unless the user set one to free on purpose).
  setMode(id, mode) {
    const c = this.get(id); if (!c) throw new Error('No such connector.'); const cat = byId[c.catalogId], url = cat ? cat.url({ mode, ...(c.options || {}) }) : c.url, levels = { ...(c.levels || {}) };
    for (const n of c.tools || []) if (!isReadTool(n) && !(cat && cat.levelFor)) levels[n] = mode === 'read-write' ? (levels[n] === 'free' ? 'free' : 'ask') : 'blocked';
    return this.update(id, { mode, url, levels });
  }
  visibleTo(c, agentId) { return c.agents === 'all' || (Array.isArray(c.agents) && c.agents.includes(agentId)); }
  // Changes whenever what a crew member may see changes (so a running crew member is restarted and lists its tools again).
  signature(agentId) { return JSON.stringify(this.list().filter(c => c.enabled && this.visibleTo(c, agentId)).map(c => [c.id, c.url, c.levels, c.roots, c.catalogId === 'neuralops' ? c.neuralopsIdentities || {} : null])) + JSON.stringify(this.nativeLevels()); }

  /* Orbit's own tools that the crew may ask for through the gateway. */
  get nativeFile() { return path.join(this.dir, 'native.json'); }
  nativeLevels() { return { ...NATIVE_DEFAULTS, ...(this.read(this.nativeFile, {}).levels || {}) }; }
  setNativeLevel(name, level) { if (!(name in NATIVE_DEFAULTS) || !['free', 'ask', 'blocked'].includes(level)) throw new Error('No such tool or level.'); this.write(this.nativeFile, { levels: { ...this.nativeLevels(), [name]: level } }); }
}
const NATIVE_DEFAULTS = { web_search: 'free', look_at_screen: 'ask', use_skill: 'free' };
const NATIVE_TOOLS = [
  { name: 'use_skill', title: 'Read own local skill', description: 'Read one local skill from the authenticated worker\'s own skill folder. Does not grant permissions or approval.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'A slug from your local skill list' } }, required: ['name'] } },
  { name: 'web_search', title: 'Search the web', description: 'Search the web (through Orbit) and get a short answer with sources.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look up' } }, required: ['query'] } },
  { name: 'look_at_screen', title: 'Look at the user\'s screen', description: 'Look at what is on the user\'s screen right now (one picture, described in words). Only when the job needs it.', inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'What to look for on the screen' } } } }
];

// The words "hermes mcp test" prints: "Tools discovered: 11" and then one tool per line.
function parseTest(out) {
  const text = String(out || ''), n = /Tools discovered:\s*(\d+)/i.exec(text), failed = /Connection failed|Failed to connect|Error/i.test(text) && !n;
  const tools = []; let on = false;
  for (const l of text.split('\n')) { if (/Tools discovered/i.test(l)) { on = true; continue; } if (!on) continue; const m = /^\s{2,}([A-Za-z0-9_.:-]+)(\s{2,}\S.*|\s*)$/.exec(l); if (m) tools.push(m[1]); }
  const err = failed ? (text.split('\n').map(l => l.trim()).filter(l => /fail|error|401|403|refused/i.test(l))[0] || 'The connection failed.').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) : '';
  return { ok: !!n && +n[1] > 0 && !failed, count: n ? +n[1] : 0, tools, error: err };
}

module.exports = { Connectors, CATALOG, NATIVE_TOOLS, NATIVE_DEFAULTS, publicCatalog, checkSpec, isReadTool, envName, parseTest };

