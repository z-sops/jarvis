'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/browser-policy');

test('addresses: https is added, plain words become a search, only http(s) pages open', () => {
  assert.equal(P.checkUrl('daraz.pk/catalog').url, 'https://daraz.pk/catalog'); assert.equal(P.checkUrl('https://example.com/a?b=1').ok, true);
  const s = P.checkUrl('think and grow rich'); assert.equal(s.ok, true); assert.equal(s.search, true); assert.match(s.url, /^https:\/\/duckduckgo\.com\/\?q=think%20and%20grow%20rich/);
  assert.equal(P.checkUrl('orbit').search, true, 'a single word is a search, not a host');
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'chrome://settings', 'view-source:https://a.com', 'ftp://a.com/x', 'blob:https://a.com/1']) assert.equal(P.checkUrl(bad).ok, false, bad);
  assert.equal(P.checkUrl('').ok, false); assert.equal(P.checkUrl(null).ok, false); assert.equal(P.checkUrl('about:blank').ok, true);
  assert.equal(P.checkUrl('https://user:pw@example.com/').ok, false, 'no user name or password in an address'); assert.match(P.checkUrl('https://user:pw@example.com/').error, /user name or password/);
});

test('addresses: your own computer and network are not opened (unless you said so)', () => {
  for (const h of ['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:8080', '10.1.2.3', '172.16.5.5', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '[::1]', 'printer.local', 'server.internal', 'intranet', 'foo.localhost', '100.64.0.5', '[fd12:3456::1]', '[fe80::1]', '[::ffff:127.0.0.1]']) {
    const r = P.checkUrl('http://' + h + '/x'); assert.equal(r.ok, false, h); assert.equal(r.local, true, h + ' is flagged as local'); }
  for (const h of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '11.0.0.1', 'example.com', 'my-app.vercel.app', '[2606:4700::1]']) assert.equal(P.checkUrl('https://' + h + '/').ok, true, h + ' is public');
  assert.equal(P.checkUrl('localhost:3000').local, true, 'typed without a scheme too'); assert.equal(P.checkUrl('http://localhost:3000', { allowLocal: true }).ok, true);
  assert.equal(P.checkUrl('http://localhost:3000/a', { allowedHosts: new Set(['localhost:3000']) }).ok, true, 'a host allowed for this session'); assert.equal(P.checkUrl('http://localhost:4000/a', { allowedHosts: new Set(['localhost:3000']) }).ok, false);
});

test('requests made by a page itself: never to your own network, and never to file: or chrome:', () => {
  assert.equal(P.requestBlocked('https://cdn.example.com/a.js'), false); assert.equal(P.requestBlocked('http://192.168.0.1/admin'), true); assert.equal(P.requestBlocked('http://localhost:9222/json'), true);
  assert.equal(P.requestBlocked('file:///etc/passwd'), true); assert.equal(P.requestBlocked('chrome://gpu'), true); assert.equal(P.requestBlocked('data:image/png;base64,AAAA'), false); assert.equal(P.requestBlocked('wss://live.example.com/socket'), false);
  assert.equal(P.requestBlocked('http://localhost:3000/api', { allowedHosts: new Set(['localhost:3000']) }), false); assert.equal(P.requestBlocked('http://localhost:3000/api', { allowLocal: true }), false); assert.equal(P.requestBlocked('not a url'), true);
});

test('clicks: buying, deleting, sending and cloud changes ask; signing in is for the user; ordinary clicks are free', () => {
  const c = (label, extra = {}) => P.classifyClick({ label, tag: 'button', type: 'button', pageHost: 'shop.example.com', ...extra });
  for (const [l, cat] of [['Place your order', 'purchase'], ['Buy now', 'purchase'], ['Pay now', 'purchase'], ['Checkout', 'purchase'], ['Subscribe', 'purchase'], ['Delete account', 'delete'], ['Remove', 'delete'], ['Cancel my subscription', 'delete'], ['Send', 'send'], ['Publish', 'send'], ['Post', 'send'], ['Reply', 'send']]) { const r = c(l); assert.equal(r.level, 'ask', l); assert.equal(r.category, cat, l); assert.ok(r.why.includes(l), 'the reason names the button'); }
  for (const l of ['Add to cart', 'Search', 'Next', 'Show more', 'Close', 'Menu', 'Read more', 'Filters', 'Sort by price', '']) assert.equal(c(l).level, 'free', l);
  assert.equal(P.classifyClick({ label: 'Deploy', tag: 'button', type: 'button', pageHost: 'vercel.com' }).category, 'cloud'); assert.equal(P.classifyClick({ label: 'Deploy', tag: 'button', type: 'button', pageHost: 'blog.example.com' }).level, 'free', 'the word alone on a blog is fine');
  assert.equal(P.classifyClick({ label: 'Save changes', tag: 'button', type: 'submit', inForm: true, pageHost: 'dash.cloudflare.com' }).level, 'ask');
  assert.equal(P.classifyClick({ label: 'Delete', tag: 'button', type: 'button', pageHost: 'x.com', disabled: true }).level, 'free', 'a disabled button does nothing');
  assert.equal(P.classifyClick({ label: 'Go', tag: 'button', type: 'submit', inForm: true, formMethod: 'post', formAction: 'https://collector.evil.example/steal', pageHost: 'shop.example.com' }).level, 'ask', 'a form that posts to another website');
  assert.equal(P.classifyClick({ label: 'Go', tag: 'button', type: 'submit', inForm: true, formMethod: 'post', formAction: '/search', pageHost: 'shop.example.com' }).level, 'free', 'a form that stays on the site');
});

test('sign-in is done by the user: the button that submits a password, and "continue with Google"; a plain Log in link is just a link', () => {
  assert.equal(P.classifyClick({ label: 'Sign in', tag: 'button', type: 'submit', inForm: true, formHasPassword: true, pageHost: 'a.com' }).level, 'human');
  assert.equal(P.classifyClick({ label: 'Continue', tag: 'button', type: 'submit', inForm: true, pageHasPassword: true, pageHost: 'a.com' }).category, 'login');
  assert.equal(P.classifyClick({ label: 'Continue with Google', tag: 'button', type: 'button', pageHost: 'a.com' }).level, 'human');
  assert.equal(P.classifyClick({ label: 'Log in', tag: 'a', href: '/login', pageHost: 'a.com' }).level, 'free', 'opening the sign-in page is harmless');
  assert.equal(P.classifyClick({ label: 'Log in', tag: 'button', type: 'button', pageHost: 'a.com', pageHasPassword: false }).level, 'free', 'a header button that only opens a form');
});

test('links to log out, delete or buy paths ask; strict mode asks about every click and every field except search', () => {
  assert.equal(P.classifyClick({ label: 'here', tag: 'a', href: 'https://a.com/account/delete', pageHost: 'a.com' }).level, 'ask'); assert.equal(P.classifyClick({ label: 'Help', tag: 'a', href: '/help', pageHost: 'a.com' }).level, 'free');
  assert.equal(P.classifyClick({ label: 'Next', tag: 'button', type: 'button', pageHost: 'a.com' }, { mode: 'strict' }).level, 'ask'); assert.equal(P.classifyClick({ label: 'Docs', tag: 'a', href: '/docs', pageHost: 'a.com' }, { mode: 'strict' }).level, 'ask');
  assert.equal(P.classifyType({ inputType: 'text', name: 'first_name' }, { mode: 'strict' }).level, 'ask'); assert.equal(P.classifyType({ inputType: 'search', name: 'q' }, { mode: 'strict' }).level, 'free'); assert.equal(P.classifyType({ inputType: 'text', name: 'first_name' }).level, 'free');
});

test('typing: passwords, codes, card numbers and any field of a sign-in form are typed by the user', () => {
  for (const info of [{ inputType: 'password' }, { inputType: 'text', autocomplete: 'one-time-code' }, { inputType: 'text', autocomplete: 'cc-number' }, { inputType: 'text', label: 'Card number' }, { inputType: 'text', name: 'cvv' }, { inputType: 'text', placeholder: 'Enter OTP' }, { inputType: 'tel', label: 'Security code' }, { inputType: 'text', name: 'pin code' }, { inputType: 'text', label: 'پاس ورڈ' }]) { const r = P.classifyType(info); assert.equal(r.level, 'human', JSON.stringify(info)); assert.equal(r.category, 'secret'); }
  assert.equal(P.classifyType({ inputType: 'email', name: 'email', formHasPassword: true }).category, 'login'); assert.equal(P.classifyType({ inputType: 'email', name: 'email' }).level, 'free');
  assert.equal(P.classifyType({ inputType: 'text', label: 'Search' }).level, 'free'); assert.equal(P.classifyType({ inputType: 'text', label: 'Pinterest board' }).level, 'free', 'a word that only contains "pin" is fine');
});

test('downloads: programs are refused, other files are saved under a safe name', () => {
  for (const n of ['setup.exe', 'tool.MSI', 'run.bat', 'x.ps1', 'a.js', 'app.jar', 'thing.lnk', 'disk.iso', 'script.sh', 'installer.dmg']) assert.equal(P.dangerousDownload(n), true, n);
  for (const n of ['report.pdf', 'data.csv', 'photo.jpg', 'notes.txt', 'archive.zip', 'sheet.xlsx', 'json.json']) assert.equal(P.dangerousDownload(n), false, n);
  assert.equal(P.safeFileName('..\\..\\evil.txt'), '_.._evil.txt'.replace('_.._', '_.._')); assert.equal(P.safeFileName('a/b:c*d?.pdf'), 'a_b_c_d_.pdf'); assert.equal(P.safeFileName(''), 'download'); assert.equal(P.safeFileName('.hidden'), 'hidden'); assert.ok(P.safeFileName('x'.repeat(500)).length <= 120);
});
