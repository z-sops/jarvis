'use strict';
// Runs inside every Orbit Browser page, in its own isolated world: the page's scripts cannot see it or change it.
// It answers questions from the app (what is on this page? where is that button?) and never exposes anything to the page.
const { ipcRenderer } = require('electron');

const state = { refs: new Map(), seq: 0 };
const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick]';
const clean = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const visible = el => { try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; } };

function roleOf(el) {
  const r = clean(el.getAttribute('role')); if (r) return r;
  const tag = el.tagName;
  if (tag === 'A') return 'link'; if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'; if (tag === 'SELECT') return 'combobox'; if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'INPUT') { const t = (el.type || 'text').toLowerCase(); if (t === 'checkbox' || t === 'radio') return t; if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button'; return 'textbox'; }
  if (el.isContentEditable) return 'textbox';
  return 'clickable';
}
function nameOf(el) {
  let n = clean(el.getAttribute('aria-label')); if (n) return n;
  const lb = el.getAttribute('aria-labelledby'); if (lb) { n = clean(lb.split(/\s+/).map(id => (document.getElementById(id) || {}).innerText || '').join(' ')); if (n) return n; }
  if (el.labels && el.labels.length) { n = clean([...el.labels].map(l => l.innerText).join(' ')); if (n) return n; }
  if (el.tagName === 'INPUT') { const t = (el.type || '').toLowerCase(); if (['button', 'submit', 'reset'].includes(t)) return clean(el.value) || t; return clean(el.placeholder) || clean(el.title) || clean(el.name); }
  if (el.tagName === 'IMG') return clean(el.alt) || clean(el.title);
  n = clean(el.innerText || el.textContent); if (n) return n.slice(0, 90);
  const img = el.querySelector && el.querySelector('img[alt]'); if (img && clean(img.alt)) return clean(img.alt);
  return clean(el.title) || clean(el.getAttribute('aria-description'));
}
function extraOf(el) {
  const tag = el.tagName, out = [];
  if (tag === 'A') { let h = el.getAttribute('href') || ''; try { const u = new URL(h, location.href); h = u.origin === location.origin ? u.pathname + u.search : u.origin + u.pathname; } catch { /* keep as written */ } if (h && !/^javascript:/i.test(h)) out.push('-> ' + h.slice(0, 70)); }
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'password') out.push('(password: typed by the user)'); else if (t === 'checkbox' || t === 'radio') out.push(el.checked ? '[checked]' : '[unchecked]'); else if (!['button', 'submit', 'reset', 'image', 'file'].includes(t)) out.push(`${t !== 'text' ? t + ' ' : ''}value=${JSON.stringify(String(el.value || '').slice(0, 60))}`);
  }
  if (tag === 'SELECT') out.push('selected=' + JSON.stringify(clean((el.selectedOptions[0] || {}).text)), 'options=' + JSON.stringify([...el.options].slice(0, 8).map(o => clean(o.text))));
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.push('(disabled)');
  if (el.getAttribute('aria-expanded') === 'true') out.push('(expanded)');
  return out.join(' ');
}

function pageText() {
  const root = document.querySelector('main, article, [role=main]') || document.body; if (!root) return '';
  return String(root.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function snapshot(o = {}) {
  const maxChars = o.maxChars || 5000, maxElements = o.maxElements || 60, offset = o.offset || 0;
  state.refs.clear(); state.seq = 0;
  const vh = innerHeight, vw = innerWidth;
  const all = [...document.querySelectorAll(INTERACTIVE)].slice(0, 1500).filter(visible);   // heavy pages (video sites) have thousands
  const inView = all.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; });
  const pick = (o.all ? all : inView).slice(0, maxElements);
  const elements = pick.map(el => { const ref = 'e' + (++state.seq); state.refs.set(ref, new WeakRef(el)); return { ref, role: roleOf(el), name: nameOf(el).slice(0, 90), extra: extraOf(el) }; });
  const full = pageText(), text = full.slice(offset, offset + maxChars);
  const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const alerts = [...document.querySelectorAll('[role=alert],[role=alertdialog],[aria-live=assertive]')].filter(visible).map(a => clean(a.innerText).slice(0, 160)).filter(Boolean).slice(0, 3);
  const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true]')].filter(visible).length;
  return { url: location.href, title: document.title, text, textFrom: offset, textTo: offset + text.length, textTotal: full.length, elements, moreElements: Math.max(0, (o.all ? all.length : inView.length) - pick.length), belowFold: all.length - inView.length,
    scrollY: Math.round(scrollY), scrollMax: Math.max(0, docH - vh), screens: Math.max(1, Math.ceil(docH / vh)), viewH: vh, hasPassword: [...document.querySelectorAll('input[type=password]')].some(visible), alerts, dialogs };
}

function findByText(text) {
  const want = clean(text).toLowerCase(); if (!want) return { error: 'No text to look for.' };
  const cands = [...document.querySelectorAll(INTERACTIVE)].filter(visible).map(el => ({ el, name: nameOf(el) })).filter(c => c.name && c.name.toLowerCase().includes(want));
  if (!cands.length) return { error: `Nothing on this page is called "${text}".` };
  const exact = cands.filter(c => c.name.toLowerCase() === want); const use = exact.length ? exact : cands;
  if (use.length > 1 && !exact.length) return { error: `Several things match "${text}": ${use.slice(0, 6).map(c => JSON.stringify(c.name.slice(0, 40))).join(', ')}. Use browser_read and click by ref.` };
  return { el: use[0].el };
}
function resolve(a) {
  if (a.active) { const el = document.activeElement; return el && el !== document.body && el !== document.documentElement ? { el } : { error: 'Nothing on the page has the keyboard focus.' }; }
  if (a.ref) { const el = (state.refs.get(a.ref) || {}).deref && state.refs.get(a.ref).deref(); if (!el || !el.isConnected) return { error: `The reference ${a.ref} is out of date (the page changed). Call browser_read again.` }; return { el }; }
  if (a.text) return findByText(a.text);
  return { error: 'Say which element: a ref from browser_read, or its text.' };
}
const cover = el => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = document.elementFromPoint(cx, cy); if (!top || top === el || el.contains(top) || top.contains(el)) return null; return clean(top.getAttribute('aria-label') || top.innerText || top.tagName).slice(0, 60) || top.tagName; };

// Everything the rules need to decide about an element, and where to click it.
function describe(a) {
  const f = resolve(a); if (f.error) return f; const el = f.el;
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch { /* old element */ }
  const r = el.getBoundingClientRect(), form = el.form || el.closest('form'), pw = [...document.querySelectorAll('input[type=password]')].some(visible);
  const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || (tag === 'button' ? 'submit' : '')).toLowerCase();
  return { tag, type, role: roleOf(el), label: nameOf(el), name: el.getAttribute('name') || '', id: el.id || '', autocomplete: el.getAttribute('autocomplete') || '', placeholder: el.getAttribute('placeholder') || '', href: el.getAttribute('href') || '',
    inputType: tag === 'input' ? (el.type || 'text').toLowerCase() : tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : el.isContentEditable ? 'editable' : '',
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', inForm: !!form, formMethod: form ? (form.getAttribute('method') || 'get') : '', formAction: form ? (form.getAttribute('action') || '') : '',
    formHasPassword: !!(form && [...form.querySelectorAll('input[type=password]')].some(visible)), pageHasPassword: pw, pageHost: location.host,
    rect: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }, coveredBy: cover(el), editable: tag === 'input' || tag === 'textarea' || el.isContentEditable };
}
function focusEl(a) { const f = resolve(a); if (f.error) return f; f.el.focus({ preventScroll: true }); return { ok: document.activeElement === f.el || f.el.contains(document.activeElement) }; }
function selectContents(a) {
  const f = resolve(a); if (f.error) return f; const el = f.el; el.focus({ preventScroll: true });
  if (typeof el.select === 'function') el.select(); else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return { ok: true };
}
function readValue(a) { const f = resolve(a); if (f.error) return f; const el = f.el; return { value: (el.type || '').toLowerCase() === 'password' ? '' : String(el.value != null ? el.value : el.innerText || '').slice(0, 300) }; }
function chooseOption(a) {
  const f = resolve(a); if (f.error) return f; const el = f.el; if (el.tagName !== 'SELECT') return { error: 'That element is not a drop-down list.' };
  const want = clean(a.option).toLowerCase(), opts = [...el.options], hit = opts.find(o => clean(o.text).toLowerCase() === want) || opts.find(o => clean(o.text).toLowerCase().includes(want)) || opts.find(o => String(o.value).toLowerCase() === want);
  if (!hit) return { error: `No option called "${a.option}". Options: ${opts.slice(0, 10).map(o => JSON.stringify(clean(o.text))).join(', ')}` };
  el.value = hit.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, selected: clean(hit.text) };
}
function scrollPage(a) {
  const vh = innerHeight; const max = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - vh), before = scrollY;
  if (a.direction === 'top') scrollTo(0, 0); else if (a.direction === 'bottom') scrollTo(0, max); else scrollBy(0, (a.direction === 'up' ? -1 : 1) * (a.amount || Math.round(vh * 0.8)));
  return { scrollY: Math.round(scrollY), scrollMax: Math.round(max), moved: Math.round(scrollY - before) };
}
let hlRoot = null, hlHost = null;
function highlight(a) {
  try {
    if (!hlHost || !hlHost.isConnected) { hlHost = document.createElement('div'); hlHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647'; (document.documentElement || document.body).appendChild(hlHost); hlRoot = hlHost.attachShadow({ mode: 'closed' }); }
    const box = document.createElement('div'), r = a.rect || { x: 0, y: 0, w: 0, h: 0 };
    box.style.cssText = `position:fixed;left:${r.x - r.w / 2 - 4}px;top:${r.y - r.h / 2 - 4}px;width:${r.w + 8}px;height:${r.h + 8}px;border:2px solid #ffb23e;border-radius:6px;box-shadow:0 0 0 3px rgba(255,178,62,.25);transition:opacity .4s`;
    hlRoot.appendChild(box); setTimeout(() => { box.style.opacity = '0'; setTimeout(() => box.remove(), 500); }, a.ms || 900);
  } catch { /* the outline is only for show */ }
  return { ok: true };
}
const OPS = { snapshot, describe, focus: focusEl, selectContents, readValue, chooseOption, scroll: scrollPage, highlight, ping: () => ({ ok: true, url: location.href, ready: document.readyState }) };

ipcRenderer.on('orbit:op', async (_e, id, op, args) => {
  let result; try { result = OPS[op] ? await OPS[op](args || {}) : { error: 'Unknown operation ' + op }; } catch (e) { result = { error: String((e && e.message) || e) }; }
  ipcRenderer.send('orbit:result', id, result);
});
