'use strict';
// The Orbit Browser: Orbit's own private browser. It never touches the user's Chrome or Edge.
// Every "context" has its own cookies, storage, cache and downloads (an Electron session); every tab is a hidden page that can be
// read, clicked and typed into, and watched live from the Browser screen. Contexts are keyed by name, so a worker can be given
// its own isolated browser later by changing one function (contextId).
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const Policy = require('./browser-policy');

const VIEW_W = 1280, VIEW_H = 800, MAX_TABS = 8, MAX_CONTEXTS = 6, PRELOAD = path.join(__dirname, 'browser-preload.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safe = s => String(s || 'x').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'x';
const KEYS = { enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', arrowdown: 'Down', down: 'Down', arrowup: 'Up', up: 'Up', arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right', pagedown: 'PageDown', pageup: 'PageUp', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', space: 'Space', ' ': 'Space' };
const friendly = m => {
  const s = String(m || '');
  if (/NAME_NOT_RESOLVED/.test(s)) return 'That website could not be found (check the address, or your internet).';
  if (/CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED/.test(s)) return 'The website refused the connection.';
  if (/TIMED_OUT/.test(s)) return 'The website took too long to answer.';
  if (/CERT|SSL|SECURITY/.test(s)) return 'The website\'s security certificate is not valid, so Orbit did not open it.';
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(s)) return 'There is no internet connection.';
  return s.replace(/^.*?ERR_/, 'ERR_').slice(0, 160);
};

class BrowserManager extends EventEmitter {
  // electron: { BrowserWindow, session, ipcMain }; ask(req) -> 'once' | 'session' | 'deny' (the same permission dialog as everywhere)
  constructor({ electron, home, getCfg, ask, actorName }) {
    super(); this.E = electron; this.home = home; this.getCfg = getCfg; this.ask = ask; this.actorName = actorName || (a => (a === 'commander' ? 'Commander' : a));
    this.contexts = new Map(); this.tabIndex = new Map(); this.pending = new Map(); this.allowedHosts = new Set(); this.viewer = null; this.idleReleaseMs = 45000; this.recent = []; this.seq = { op: 0, tab: 0 };
    this.onResult = (e, id, r) => { const p = this.pending.get(id); if (p && p.wcId === e.sender.id) { this.pending.delete(id); clearTimeout(p.t); p.resolve(r); } };
    electron.ipcMain.on('orbit:result', this.onResult);
  }

  /* ---------- contexts (isolated sessions) ---------- */
  // The only place that decides which browser a worker gets. "shared": everybody uses "orbit". "per-agent": each crew member gets an isolated one.
  contextId(actor) { return this.getCfg().browserIsolation === 'per-agent' && actor && actor !== 'commander' ? 'agent-' + safe(actor) : 'orbit'; }
  context(id) {
    let c = this.contexts.get(id); if (c) return c;
    if (this.contexts.size >= MAX_CONTEXTS) throw new Error('Too many separate browsers are open.');
    const partition = 'persist:orbit-' + safe(id), ses = this.E.session.fromPartition(partition), downloads = this.home.p('workspace', 'browser-downloads', safe(id));
    c = { id, partition, session: ses, tabs: new Map(), actorTab: new Map(), viewTab: null, pinned: false, userControl: false, handoff: null, downloads, hostsOnce: new Set() }; this.contexts.set(id, c); this.configureSession(c); return c;
  }
  ua() { const w = this._ua || (this._ua = new this.E.BrowserWindow({ show: false, width: 100, height: 100 })); const s = w.webContents.getUserAgent(); return s.replace(/\s+[\w-]+\/[\d.]+(?= Chrome\/)/, '').replace(/\s+Electron\/[\d.]+/i, ''); }
  configureSession(c) {
    const ses = c.session, cfg = () => this.getCfg();
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(false)); ses.setPermissionCheckHandler(() => false);
    try { ses.setUserAgent(this.ua(), 'en-US,en'); } catch { /* the default is fine */ }
    const hosts = () => new Set([...this.allowedHosts, ...c.hostsOnce]);
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => { let cancel = false; try { cancel = Policy.requestBlocked(d.url, { allowLocal: !!cfg().browserAllowLocal, allowedHosts: hosts() }) && !/^(chrome-extension|devtools):/i.test(d.url) && d.resourceType !== 'mainFrame'; } catch { /* allow */ } cb({ cancel }); });
    ses.on('will-download', (_e, item) => {
      const name = Policy.safeFileName(item.getFilename());
      if (Policy.dangerousDownload(name)) { item.cancel(); return this.log(c, 'browser', 'download', name, 'denied', { detail: 'Programs and scripts are never saved by the Orbit Browser.' }); }
      fs.mkdirSync(c.downloads, { recursive: true }); let dest = path.join(c.downloads, name), n = 1; while (fs.existsSync(dest)) dest = path.join(c.downloads, name.replace(/(\.[^.]*)?$/, `-${n++}$1`));
      item.setSavePath(dest); item.on('done', (_ev, st) => this.log(c, 'browser', 'download', path.basename(dest), st === 'completed' ? 'ok' : 'error', { detail: st === 'completed' ? `Saved in ${path.relative(this.home.p('workspace'), dest)}` : `Download ${st}` }));
    });
  }

  /* ---------- tabs ---------- */
  async newTab(ctx, actor, { setActive = true } = {}) {
    if (ctx.tabs.size >= MAX_TABS) { const old = [...ctx.tabs.values()].filter(t => t.owner === actor && t.id !== ctx.actorTab.get(actor)).sort((a, b) => a.lastUsed - b.lastUsed)[0]; if (!old) throw new Error(`There are already ${MAX_TABS} tabs open. Close one with browser_tabs first.`); this.closeTab(old.id); }
    const win = new this.E.BrowserWindow({ show: false, width: VIEW_W, height: VIEW_H, useContentSize: true, webPreferences: { session: ctx.session, preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, webSecurity: true, spellcheck: false, devTools: false } });
    const wc = win.webContents, tab = { id: 't' + (++this.seq.tab), ctxId: ctx.id, win, wc, owner: actor, url: 'about:blank', title: '', loading: false, created: Date.now(), lastUsed: Date.now(), crashed: false, onceHosts: new Set() };
    try { wc.setUserAgent(this.ua()); } catch { /* keep the default */ } try { wc.setFrameRate(1); } catch { /* not available */ }
    const changed = () => this.emit('state');
    wc.on('page-title-updated', (_e, t) => { tab.title = t; changed(); }); wc.on('did-start-loading', () => { tab.loading = true; changed(); }); wc.on('did-stop-loading', () => { tab.loading = false; tab.url = wc.getURL() || tab.url; if (this.viewer && this.viewer.tabId === tab.id) { try { wc.invalidate(); } catch { /* gone */ } } changed(); });
    wc.on('did-navigate', (_e, u) => { tab.url = u; changed(); }); wc.on('did-navigate-in-page', (_e, u) => { tab.url = u; changed(); }); wc.on('render-process-gone', (_e, d) => { tab.crashed = true; this.failPending(wc.id, 'The page crashed.'); this.log(ctx, actor, 'page', tab.url, 'error', { detail: 'The page crashed (' + ((d && d.reason) || 'unknown') + ')' }); changed(); });
    wc.on('unresponsive', () => { this.failPending(wc.id, 'The page stopped responding (it may be too heavy for Orbit).'); this.log(ctx, actor, 'page', tab.url, 'error', { detail: 'The page stopped responding' }); });
    const guard = (e, u) => { const url = typeof u === 'string' ? u : e.url; const r = Policy.checkUrl(url, { allowLocal: !!this.getCfg().browserAllowLocal, allowedHosts: new Set([...this.allowedHosts, ...ctx.hostsOnce, ...tab.onceHosts]) }); if (!r.ok && !/^about:blank$/.test(url)) { e.preventDefault(); this.log(ctx, actor, 'navigate', url, 'denied', { detail: r.error }); } };
    wc.on('will-navigate', guard); wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(d => { const r = Policy.checkUrl(d.url, { allowLocal: !!this.getCfg().browserAllowLocal, allowedHosts: this.allowedHosts }); if (r.ok && r.url !== 'about:blank') this.newTab(ctx, actor).then(t => this.goto(t, r.url).catch(() => {})).catch(() => {}); return { action: 'deny' }; });
    win.on('closed', () => { ctx.tabs.delete(tab.id); this.tabIndex.delete(tab.id); if (ctx.viewTab === tab.id) ctx.viewTab = [...ctx.tabs.keys()].pop() || null; for (const [a, t] of ctx.actorTab) if (t === tab.id) ctx.actorTab.delete(a); changed(); });
    ctx.tabs.set(tab.id, tab); this.tabIndex.set(tab.id, tab); if (setActive) { ctx.actorTab.set(actor, tab.id); if (!ctx.pinned) ctx.viewTab = tab.id; } this.rebind(); changed(); return tab;
  }
  closeTab(id) { const t = this.tabIndex.get(id); if (!t) return false; try { t.win.destroy(); } catch { /* already gone */ } return true; }
  async tabFor(actor, { create = true } = {}) {
    const ctx = this.context(this.contextId(actor)), id = ctx.actorTab.get(actor); let tab = id && ctx.tabs.get(id);
    if (tab && tab.crashed) { this.closeTab(tab.id); tab = null; }
    if (!tab) { if (!create) throw new Error('No page is open yet. Use browser_open first.'); tab = await this.newTab(ctx, actor); }
    tab.lastUsed = Date.now(); if (!ctx.pinned) { ctx.viewTab = tab.id; this.rebind(); } return { ctx, tab };
  }

  /* ---------- talking to the page ---------- */
  async op(tab, name, args, timeout = 8000) {
    const t0 = Date.now(); while (tab.wc.isLoading() && Date.now() - t0 < 6000) await sleep(80);
    return new Promise((resolve, reject) => {
      const id = 'o' + (++this.seq.op), t = setTimeout(() => { this.pending.delete(id); reject(new Error('The page did not answer. It may still be loading: try browser_read again.')); }, timeout);
      this.pending.set(id, { resolve, reject, wcId: tab.wc.id, t }); try { tab.wc.send('orbit:op', id, name, args || {}); } catch (e) { clearTimeout(t); this.pending.delete(id); reject(e); }
    });
  }
  failPending(wcId, why) { for (const [id, p] of [...this.pending]) if (p.wcId === wcId) { this.pending.delete(id); clearTimeout(p.t); p.reject(new Error(why)); } }
  async snap(tab, o = {}) { const s = await this.op(tab, 'snapshot', o); if (s && s.error) throw new Error(s.error); tab.url = s.url; tab.title = s.title; return s; }
  sig(s) { let h = 0; const str = `${s.url}|${s.title}|${s.text.slice(0, 600)}|${s.elements.length}|${s.scrollY}`; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h; }
  async settle(tab, max = 6000) { const t0 = Date.now(); await sleep(120); while (tab.wc.isLoading() && Date.now() - t0 < max) await sleep(100); await sleep(250); }
  async goto(tab, url) {
    try { await Promise.race([tab.wc.loadURL(url), sleep(25000).then(() => { throw Object.assign(new Error('timeout'), { timeout: true }); })]); }
    catch (e) { if (e.timeout) { try { tab.wc.stop(); } catch { /* keep what loaded */ } } else if (!/ERR_ABORTED/.test(String(e.message))) throw new Error(`Could not open ${url}. ${friendly(e.message)}`); }
    await this.settle(tab);
  }

  /* ---------- the user and the AI take turns ---------- */
  // While the user has control the AI waits, but never for long and never for nothing: control is released when the user leaves the Browser screen,
  // or stops touching the page for a while (idleReleaseMs). A sign-in hand-off is different: it lasts until the user answers.
  async gate(ctx, actor) { if (!ctx.userControl) return; return this.waitUser(actor, () => this.gate1(ctx, actor)); }
  async gate1(ctx, actor) {
    const t0 = Date.now();
    while (ctx.userControl) {
      if (!ctx.handoff) {
        const watching = !!this.viewer && this.viewer.ctxId === ctx.id;
        if (!watching || Date.now() - (ctx.lastInput || 0) > this.idleReleaseMs) { ctx.userControl = false; this.log(ctx, 'user', 'take over', 'released', 'ok', { detail: watching ? 'No activity for a while' : 'The Browser screen is not open' }); this.emit('state'); break; }
      }
      if (this.stopped && this.stopped.t > t0 && (!this.stopped.actor || this.stopped.actor === actor)) throw new Error('Stopped by the user.');
      if (Date.now() - t0 > 25000) throw new Error('The user has the Orbit Browser in their hands right now (Take over is on). Ask them to press "Give back", then try again.');
      await sleep(300);
    }
  }
  // The Stop button: whoever is waiting for the user (sign-in, take-over) stops waiting.
  cancelWaiting(actor) {
    this.stopped = { t: Date.now(), actor: actor || null };
    for (const c of this.contexts.values()) if (c.handoff && (!actor || c.handoff.actor === actor)) { const h = c.handoff; c.handoff = null; c.userControl = false; clearTimeout(h.timer); h.resolve({ done: false, cancelled: true }); }
    this.emit('state');
  }
  handoff(ctx, tab, actor, reason) {
    if (ctx.handoff) return ctx.handoff.promise;
    const h = { reason, actor, actorName: this.actorName(actor), tabId: tab.id, since: Date.now() };
    h.promise = new Promise(resolve => { h.resolve = resolve; h.timer = setTimeout(() => { if (ctx.handoff === h) { ctx.handoff = null; ctx.userControl = false; this.emit('state'); resolve({ done: false, timedOut: true }); } }, 15 * 60 * 1000); });
    ctx.handoff = h; ctx.userControl = true; if (!ctx.pinned) ctx.viewTab = tab.id; this.rebind(); this.log(ctx, actor, 'needs you', reason, 'human', {}); this.emit('handoff', { ctx: ctx.id, tab: tab.id, actor, actorName: h.actorName, reason }); this.emit('state'); return h.promise;
  }
  resume(ctxId, done) { const c = this.contexts.get(ctxId); if (!c) return false; const h = c.handoff; c.handoff = null; c.userControl = false; if (h) { clearTimeout(h.timer); h.resolve({ done: !!done }); } this.emit('state'); return true; }
  takeover(ctxId, on) { const c = this.contexts.get(ctxId); if (!c) return false; if (!on && c.handoff) return this.resume(ctxId, true); c.userControl = !!on; c.lastInput = Date.now(); this.emit('state'); return true; }

  // Applies the rules to one step. Returns { handedOff: true } when the user did the step themselves; throws when they said no.
  async enforce(ctx, tab, actor, d, what) {
    if (d.level === 'free') return {};
    if (d.level === 'ask') {
      this.log(ctx, actor, what.action, what.label, 'asked', { detail: d.why });
      const a = await this.waitUser(actor, () => this.ask({ actor, actorName: this.actorName(actor), tool: 'browser_' + what.action, title: 'Orbit Browser: ' + d.why, detail: `${what.host || ''}\n${what.label || ''}`.trim(), allowSession: false }));
      if (a === 'deny') { this.log(ctx, actor, what.action, what.label, 'denied', { detail: 'The user said no' }); throw new Error('The user said no to this. Do not try it again unless they ask you to.'); }
      return {};
    }
    const r = await this.waitUser(actor, () => this.handoff(ctx, tab, actor, d.why));
    if (!r.done) throw new Error(r.cancelled ? 'Stopped by the user.' : r.timedOut ? 'The user did not come back in time to do this step.' : 'The user did not do this step. Do not try it again unless they ask you to.');
    return { handedOff: true };
  }
  log(ctx, actor, action, target, status, extra = {}) {
    const e = { t: Date.now(), ctx: ctx ? ctx.id : '', actor, actorName: this.actorName(actor), action, target: String(target || '').slice(0, 140), status, ...extra }; this.recent.push(e); if (this.recent.length > 200) this.recent.shift(); this.emit('activity', e); return e;
  }
  // Runs fn while the AI is waiting for the USER (a question, a sign-in, a take-over): that time is not counted against it.
  async waitUser(actor, fn) { this.uw = this.uw || new Map(); this.uw.set(actor, (this.uw.get(actor) || 0) + 1); try { return await fn(); } finally { this.uw.set(actor, this.uw.get(actor) - 1); } }
  waitingOnUser(actor) { return !!(this.uw && this.uw.get(actor) > 0); }
  // A failure the model was told about is also written to the activity log (so it shows in the Logs tab).
  noteError(actor, tool, msg) { const c = this.contexts.get(this.contextId(actor)); this.log(c || null, actor, String(tool).replace(/^browser_/, ''), '', 'error', { detail: String(msg || '').slice(0, 200) }); }
  mode() { return this.getCfg().browserApproval === 'strict' ? 'strict' : 'sensitive'; }

  /* ---------- what the AI can do ---------- */
  async open(actor, input, { newTab = false, background = false } = {}) {
    const cfg = this.getCfg(), ctx0 = this.context(this.contextId(actor));
    let c = Policy.checkUrl(input, { allowLocal: !!cfg.browserAllowLocal, allowedHosts: new Set([...this.allowedHosts, ...ctx0.hostsOnce]) }), once = null;
    if (!c.ok && c.local) {
      this.log(ctx0, actor, 'open', c.url, 'asked', { detail: 'An address on your own computer or network' });
      const a = await this.waitUser(actor, () => this.ask({ actor, actorName: this.actorName(actor), tool: 'browser_open', title: 'Orbit Browser: open a program or device on your own computer or network', detail: c.url, allowSession: true }));
      if (a === 'deny') { this.log(ctx0, actor, 'open', c.url, 'denied', {}); throw new Error('The user did not allow opening that address.'); }
      if (a === 'session') this.allowedHosts.add(c.host); else ctx0.hostsOnce.add(c.host);
      c = Policy.checkUrl(input, { allowedHosts: new Set([c.host]) });
    }
    if (!c.ok) { this.log(ctx0, actor, 'open', input, 'denied', { detail: c.error }); throw new Error(c.error); }
    if (c.host && !Policy.isPrivateHost(c.host)) { try { const r = await ctx0.session.resolveHost(c.host); if (r && r.endpoints && r.endpoints.some(e => Policy.isPrivateIp(e.address)) && !this.allowedHosts.has(c.host) && !cfg.browserAllowLocal) throw new Error(`${c.host} points to a device on your own network, so Orbit did not open it.`); } catch (e) { if (/points to a device/.test(e.message)) throw e; /* offline: the load will report it */ } }
    await this.gate(ctx0, actor);
    let tab, ctx = ctx0; if (newTab) { tab = await this.newTab(ctx, actor); } else ({ ctx, tab } = await this.tabFor(actor));
    tab.onceHosts = new Set([...ctx0.hostsOnce]); this.log(ctx, actor, 'open', c.url, 'ok', { background });
    const tA = Date.now(); await this.goto(tab, c.url); const tB = Date.now(); const snapshot = await this.snap(tab); const tC = Date.now();
    this.log(ctx, actor, 'loaded', snapshot.title || c.url, 'ok', { detail: `load ${tB - tA} ms, read ${tC - tB} ms` });
    return { note: `Opened ${snapshot.title || snapshot.url}.`, snapshot };
  }
  async read(actor, { offset = 0, all = false } = {}) { const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor); return { snapshot: await this.snap(tab, { offset, all }) }; }
  async after(tab, before) { await this.settle(tab); const s = await this.snap(tab, { maxChars: 3500, maxElements: 45 }); return this.sig(s) === before ? { unchanged: true } : { snapshot: s, compact: true }; }
  async click(actor, { ref, text }) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor);
    const info = await this.op(tab, 'describe', { ref, text }); if (info.error) throw new Error(info.error);
    if (info.disabled) throw new Error(`"${info.label}" is disabled.`); if (info.coveredBy) throw new Error(`Something is covering it: "${info.coveredBy}". Close that first (a cookie banner or pop-up, for example).`);
    const d = Policy.classifyClick(info, { mode: this.mode() }), e = await this.enforce(ctx, tab, actor, d, { action: 'click', label: info.label, host: info.pageHost });
    if (e.handedOff) { await this.settle(tab); return { note: `The user did this step themselves (${info.label || 'click'}).`, snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true }; }
    const before = this.sig(await this.snap(tab, { maxChars: 3500, maxElements: 45 }).catch(() => ({ url: '', title: '', text: '', elements: [], scrollY: 0 }))); const again = await this.op(tab, 'describe', { ref, text }); if (again.error) throw new Error(again.error);
    await this.op(tab, 'highlight', { rect: again.rect }).catch(() => {}); this.log(ctx, actor, 'click', info.label || info.tag, 'ok', { url: info.pageHost });
    const w = tab.wc, x = again.rect.x, y = again.rect.y; w.sendInputEvent({ type: 'mouseMove', x, y }); w.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); w.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return { note: `Clicked ${info.role} "${info.label}".`, ...(await this.after(tab, before)) };
  }
  async type(actor, { ref, text, value, clear = true, submit = false }) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor);
    const info = await this.op(tab, 'describe', { ref, text }); if (info.error) throw new Error(info.error); if (!info.editable && info.inputType !== 'select') throw new Error(`"${info.label}" is not a text field.`); if (info.coveredBy) throw new Error(`Something is covering it: "${info.coveredBy}".`);
    const d = Policy.classifyType(info, { mode: this.mode() }), e = await this.enforce(ctx, tab, actor, d, { action: 'type', label: info.label || info.placeholder || info.name, host: info.pageHost });
    if (e.handedOff) { await this.settle(tab); return { note: `The user filled in "${info.label}" themselves.`, snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true }; }
    if (submit) { const s = await this.submitDecision(info); if (s.level !== 'free') { const e2 = await this.enforce(ctx, tab, actor, s, { action: 'send', label: info.label || info.placeholder || info.name, host: info.pageHost }); if (e2.handedOff) return { note: 'The user finished this step themselves.', snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true }; } }
    const before = this.sig(await this.snap(tab, { maxChars: 3500, maxElements: 45 }).catch(() => ({ url: '', title: '', text: '', elements: [], scrollY: 0 })));
    await this.op(tab, 'highlight', { rect: info.rect }).catch(() => {}); const f = await this.op(tab, 'focus', { ref, text }); if (f.error) throw new Error(f.error);
    if (clear) { const c = await this.op(tab, 'selectContents', { ref, text }); if (c.error) throw new Error(c.error); }
    tab.wc.insertText(String(value)); await sleep(120); this.log(ctx, actor, 'type', `${info.label || info.name || 'field'} (${String(value).length} characters)`, 'ok', { url: info.pageHost });
    if (submit) { await this.key(tab.wc, 'Enter'); }
    return { note: `Typed ${String(value).length} characters into "${info.label || info.placeholder || info.name}"${submit ? ' and pressed Enter' : ''}.`, ...(await this.after(tab, before)) };
  }
  // Enter can send a message or submit a form: apply the same rules as for a Send button.
  async submitDecision(info) {
    const hay = [info.label, info.name, info.id, info.placeholder].join(' ');
    if (info.formHasPassword) return { level: 'human', category: 'login', why: 'This would sign in. Signing in is done by you, not by the AI.' };
    if (/\b(message|comment|reply|post|tweet|status|compose|chat|caption|subject|email|body)\b/i.test(hay)) return { level: 'ask', category: 'send', why: 'Pressing Enter here may send or post what was typed' };
    return Policy.classifyClick({ label: '', tag: 'button', type: 'submit', inForm: info.inForm, formMethod: info.formMethod, formAction: info.formAction, formHasPassword: info.formHasPassword, pageHost: info.pageHost }, { mode: this.mode() });
  }
  async select(actor, { ref, text, option }) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor); const before = this.sig(await this.snap(tab, { maxChars: 3500, maxElements: 45 }));
    const r = await this.op(tab, 'chooseOption', { ref, text, option }); if (r.error) throw new Error(r.error); this.log(ctx, actor, 'select', r.selected, 'ok', {});
    return { note: `Chose "${r.selected}".`, ...(await this.after(tab, before)) };
  }
  async key(wc, name) {
    const k = KEYS[String(name).toLowerCase()] || (String(name).length === 1 ? String(name) : null); if (!k) throw new Error(`Unknown key "${name}". Use Enter, Tab, Escape, ArrowDown, ArrowUp, PageDown, PageUp, Backspace or Space.`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: k }); if (k === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' }); else if (k === 'Space') wc.sendInputEvent({ type: 'char', keyCode: ' ' }); else if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  async press(actor, key) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor);
    if (String(key).toLowerCase() === 'enter') { const info = await this.op(tab, 'describe', { active: true }); if (!info.error) { const d = await this.submitDecision(info), e = await this.enforce(ctx, tab, actor, d, { action: 'send', label: info.label || info.placeholder || info.name, host: info.pageHost }); if (e.handedOff) return { note: 'The user finished this step themselves.', snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true }; } }
    const before = this.sig(await this.snap(tab, { maxChars: 3500, maxElements: 45 })); await this.key(tab.wc, key); this.log(ctx, actor, 'press', String(key), 'ok', {});
    return { note: `Pressed ${key}.`, ...(await this.after(tab, before)) };
  }
  async scroll(actor, { direction = 'down', amount } = {}) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor); const r = await this.op(tab, 'scroll', { direction, amount }); if (r.error) throw new Error(r.error); this.log(ctx, actor, 'scroll', direction, 'ok', {});
    await sleep(250); return { note: r.moved ? `Scrolled ${direction}.` : `Already at the ${direction === 'up' || direction === 'top' ? 'top' : 'bottom'}.`, snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true };
  }
  async nav(actor, action) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor); const h = tab.wc.navigationHistory;
    if (action === 'back') { if (!(h ? h.canGoBack() : tab.wc.canGoBack())) throw new Error('There is no earlier page.'); h ? h.goBack() : tab.wc.goBack(); } else if (action === 'forward') { if (!(h ? h.canGoForward() : tab.wc.canGoForward())) throw new Error('There is no later page.'); h ? h.goForward() : tab.wc.goForward(); } else if (action === 'reload') tab.wc.reload(); else throw new Error('Use back, forward or reload.');
    this.log(ctx, actor, action, tab.url, 'ok', {}); await this.settle(tab); return { note: `Went ${action}.`, snapshot: await this.snap(tab) };
  }
  async tabs(actor, { action, id, url }) {
    const ctx = this.context(this.contextId(actor)); await this.gate(ctx, actor);
    const list = () => `Tabs in this browser (* = yours):\n` + ([...ctx.tabs.values()].map(t => `${ctx.actorTab.get(actor) === t.id ? '*' : ' '} ${t.id} ${JSON.stringify(t.title || '(no title)')} ${t.url}${t.owner !== actor ? ` [${this.actorName(t.owner)}]` : ''}`).join('\n') || '(no tabs yet)');
    if (action === 'list') return { list: list() };
    if (action === 'new') { if (url) return this.open(actor, url, { newTab: true }); const t = await this.newTab(ctx, actor); await this.goto(t, 'about:blank').catch(() => {}); return { note: `Opened an empty tab ${t.id}.`, list: list() }; }
    const t = ctx.tabs.get(id); if (!t) throw new Error(`There is no tab ${id}. ${list()}`);
    if (action === 'switch') { ctx.actorTab.set(actor, t.id); t.lastUsed = Date.now(); if (!ctx.pinned) { ctx.viewTab = t.id; this.rebind(); } return { note: `Switched to ${t.id}.`, snapshot: await this.snap(t) }; }
    if (action === 'close') { this.closeTab(t.id); return { note: `Closed ${id}.`, list: list() }; } throw new Error('Use list, new, switch or close.');
  }
  async wait(actor, { seconds, text }) {
    const { ctx, tab } = await this.tabFor(actor, { create: false }); await this.gate(ctx, actor); const max = Math.min(20, Math.max(0, +seconds || (text ? 10 : 2))) * 1000, t0 = Date.now();
    if (text) { while (Date.now() - t0 < max) { const s = await this.snap(tab, { maxChars: 20000, maxElements: 1 }).catch(() => null); if (s && s.text.toLowerCase().includes(String(text).toLowerCase())) return { note: `"${text}" appeared.`, snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true }; await sleep(500); } throw new Error(`"${text}" did not appear within ${Math.round(max / 1000)} seconds.`); }
    await sleep(max); await this.settle(tab); return { note: `Waited ${Math.round(max / 1000)} s.`, snapshot: await this.snap(tab, { maxChars: 3500, maxElements: 45 }), compact: true };
  }
  async screenshot(actor) {
    const { tab } = await this.tabFor(actor, { create: false }); let img = await tab.wc.capturePage(); const s = img.getSize(); if (s.width > 1000) img = img.resize({ width: 1000 });
    return { mime: 'image/jpeg', base64: img.toJPEG(70).toString('base64') };
  }

  /* ---------- the Browser screen: watching and taking over ---------- */
  viewTabOf(ctx) { return ctx && ((ctx.viewTab && ctx.tabs.get(ctx.viewTab)) || [...ctx.tabs.values()].pop() || null); }
  // One viewer at a time: frames of the chosen context's shown tab are sent to cb. Other tabs paint at 1 frame a second.
  setViewer(ctxId, cb) { this.unbind(); this.viewer = ctxId ? { ctxId, cb, tabId: null, last: 0 } : null; this.rebind(); }
  unbind() { const v = this.viewer; if (v && v.timer) { clearTimeout(v.timer); v.timer = null; v.pending = null; } if (v && v.tabId) { const t = this.tabIndex.get(v.tabId); if (t) { try { t.wc.removeListener('paint', v.handler); t.wc.setFrameRate(1); } catch { /* tab gone */ } } v.tabId = null; } }
  rebind() {
    const v = this.viewer; if (!v) return; const ctx = this.contexts.get(v.ctxId), tab = this.viewTabOf(ctx); if (!tab || v.tabId === tab.id) return; this.unbind();
    // At most ~9 frames a second, but the LAST frame of a burst is always sent (a static page must not stay stuck on a half-drawn frame).
    const emit = image => { v.last = Date.now(); try { const sz = image.getSize(); v.cb({ ctx: v.ctxId, tab: tab.id, w: sz.width, h: sz.height, jpeg: image.toJPEG(62).toString('base64') }); } catch { /* frame skipped */ } };
    v.tabId = tab.id; v.pending = null; v.timer = null;
    v.handler = (_e, _dirty, image) => { const wait = 110 - (Date.now() - v.last); if (wait <= 0 && !v.timer) return emit(image); v.pending = image; if (!v.timer) v.timer = setTimeout(() => { v.timer = null; const im = v.pending; v.pending = null; if (im && this.viewer === v && v.tabId === tab.id) emit(im); }, Math.max(wait, 20)); };
    try { tab.wc.on('paint', v.handler); tab.wc.setFrameRate(8); tab.wc.invalidate(); } catch { /* tab gone */ }
  }
  input(ctxId, evt) {
    const ctx = this.contexts.get(ctxId); if (!ctx || !ctx.userControl) return { ok: false, reason: 'Press Take over first.' }; ctx.lastInput = Date.now(); const tab = this.viewTabOf(ctx); if (!tab) return { ok: false };
    const w = tab.wc, num = v => Math.max(0, Math.min(5000, Math.round(+v || 0)));
    if (evt.kind === 'mouse') { const type = { move: 'mouseMove', down: 'mouseDown', up: 'mouseUp', wheel: 'mouseWheel' }[evt.type]; if (!type) return { ok: false }; const e = { type, x: num(evt.x), y: num(evt.y) }; if (evt.type === 'down' || evt.type === 'up') { e.button = ['left', 'middle', 'right'].includes(evt.button) ? evt.button : 'left'; e.clickCount = Math.max(1, Math.min(3, evt.clickCount | 0 || 1)); } if (evt.type === 'wheel') { e.deltaX = Math.max(-2000, Math.min(2000, evt.deltaX | 0)); e.deltaY = Math.max(-2000, Math.min(2000, evt.deltaY | 0)); e.canScroll = true; } w.sendInputEvent(e); }
    else if (evt.kind === 'key') { const name = String(evt.key || ''), k = KEYS[name.toLowerCase()] || (name.length === 1 ? name : null); if (!k) return { ok: false }; const mods = (evt.modifiers || []).filter(m => ['shift', 'control', 'alt', 'meta'].includes(m)); if (evt.type === 'up') w.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); else { w.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); if (!mods.some(m => m === 'control' || m === 'alt' || m === 'meta')) { if (k === 'Enter') w.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: mods }); else if (k === 'Space') w.sendInputEvent({ type: 'char', keyCode: ' ', modifiers: mods }); else if (k.length === 1) w.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods }); } } }
    else if (evt.kind === 'text') w.insertText(String(evt.text || '').slice(0, 2000)); else return { ok: false };
    return { ok: true };
  }
  async userNavigate(ctxId, input) {
    const ctx = this.contexts.get(ctxId) || this.context(ctxId), r = Policy.checkUrl(input, { allowLocal: true }); if (!r.ok) throw new Error(r.error);
    if (r.host && Policy.isPrivateHost(r.host)) { const u = new URL(r.url); ctx.hostsOnce.add(u.host.toLowerCase()); }
    let tab = this.viewTabOf(ctx); if (!tab) tab = await this.newTab(ctx, 'user'); tab.onceHosts = new Set([...ctx.hostsOnce]); ctx.pinned = ctx.pinned; this.log(ctx, 'user', 'open', r.url, 'ok', {}); await this.goto(tab, r.url); this.emit('state'); return { url: tab.url };
  }
  userTab(ctxId, action, id) {
    const ctx = this.contexts.get(ctxId); if (!ctx) return false;
    if (action === 'new') { this.newTab(ctx, 'user').then(t => { ctx.viewTab = t.id; ctx.pinned = true; this.rebind(); this.emit('state'); }).catch(() => {}); return true; }
    if (action === 'view') { if (!ctx.tabs.has(id)) return false; ctx.viewTab = id; ctx.pinned = true; this.rebind(); } else if (action === 'unpin') { ctx.pinned = false; this.rebind(); } else if (action === 'close') this.closeTab(id);
    else if (action === 'back' || action === 'forward' || action === 'reload') { const t = this.viewTabOf(ctx); if (!t) return false; const h = t.wc.navigationHistory; if (action === 'reload') t.wc.reload(); else if (action === 'back') h ? h.canGoBack() && h.goBack() : t.wc.canGoBack() && t.wc.goBack(); else h ? h.canGoForward() && h.goForward() : t.wc.canGoForward() && t.wc.goForward(); }
    this.emit('state'); return true;
  }
  async clearData(ctxId) { const c = this.contexts.get(ctxId); if (!c) return false; await c.session.clearStorageData(); await c.session.clearCache(); for (const t of [...c.tabs.values()]) t.wc.loadURL('about:blank').catch(() => {}); this.log(c, 'user', 'clear', 'cookies, storage and cache', 'ok', {}); this.emit('state'); return true; }

  state() {
    return { contexts: [...this.contexts.values()].map(c => ({ id: c.id, userControl: c.userControl, pinned: c.pinned, viewTab: (this.viewTabOf(c) || {}).id || null, handoff: c.handoff ? { reason: c.handoff.reason, actor: c.handoff.actor, actorName: c.handoff.actorName, tab: c.handoff.tabId } : null,
      tabs: [...c.tabs.values()].map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, crashed: t.crashed, owner: t.owner, ownerName: this.actorName(t.owner) })) })), viewer: this.viewer ? this.viewer.ctxId : null, size: { w: VIEW_W, h: VIEW_H } };
  }
  dispose() { this.unbind(); for (const t of [...this.tabIndex.values()]) { try { t.win.destroy(); } catch { /* gone */ } } try { this._ua && this._ua.destroy(); } catch { /* gone */ } try { this.E.ipcMain.removeListener('orbit:result', this.onResult); } catch { /* gone */ } this.tabIndex.clear(); this.contexts.clear(); }
}

module.exports = { BrowserManager, VIEW_W, VIEW_H };
