'use strict';
// Rules for the Orbit Browser: which addresses may be opened, and which actions need the user. Pure functions, no browser code here.
const net = require('net');

/* ---------- addresses ---------- */
function ipv4Int(ip) { return ip.split('.').reduce((n, p) => n * 256 + (+p), 0); }
const V4_PRIVATE = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]];
function isPrivateIp(ip) {
  const h = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(h)) { const n = ipv4Int(h); return V4_PRIVATE.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(ipv4Int(base) / 2 ** (32 - bits))); }
  if (net.isIPv6(h)) {
    if (h === '::' || h === '::1') return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h); if (m) return isPrivateIp(m[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);        // how a web address parser writes an IPv4 address inside IPv6
    if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);          // fc00::/7 and fe80::/10
  }
  return false;
}
// The names of things inside your own computer or network: localhost, printers, routers, intranet servers.
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (net.isIP(h)) return isPrivateIp(h);
  return h === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(h) || !h.includes('.');
}

// Turns what was typed into an address to open: adds https://, or turns plain words into a search.
function checkUrl(input, { allowLocal = false, allowedHosts = null } = {}) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return { ok: false, error: 'No address was given.' };
  let search = false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[a-z0-9.-]+:\d+(\/|$)/i.test(s)) {          // no scheme, or "host:port"
    if (/\s/.test(s) || !/[.:]/.test(s)) { s = 'https://duckduckgo.com/?q=' + encodeURIComponent(s); search = true; }
    else s = 'https://' + s;
  }
  let u; try { u = new URL(s); } catch { return { ok: false, error: `"${input}" is not a web address.` }; }
  if (u.protocol === 'about:' && u.href === 'about:blank') return { ok: true, url: 'about:blank', host: '', search: false };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: `Only http and https pages can be opened (not ${u.protocol}).` };
  if (u.username || u.password) return { ok: false, error: 'Addresses that contain a user name or password are not allowed.' };
  const host = u.hostname.toLowerCase();
  if (isPrivateHost(host) && !allowLocal && !(allowedHosts && allowedHosts.has(u.host.toLowerCase()))) return { ok: false, local: true, host: u.host.toLowerCase(), url: u.toString(), error: `${u.host} is a program or device on your own computer or network.` };
  return { ok: true, url: u.toString(), host, search };
}
// Requests a page makes by itself (images, scripts, fetch): never to your own machine or network unless that was allowed.
function requestBlocked(url, { allowLocal = false, allowedHosts = null } = {}) {
  let u; try { u = new URL(url); } catch { return true; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return false;
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return true;
  if (allowLocal) return false;
  return isPrivateHost(u.hostname) && !(allowedHosts && allowedHosts.has(u.host.toLowerCase()));
}

/* ---------- sensitive actions ---------- */
const W = {
  login: /\b(sign[ -]?in|log[ -]?in|login|authenticate|continue with (google|facebook|apple|github|microsoft)|verify (your )?(identity|account|phone|email)|two[- ]factor|2fa|one[- ]time|passcode|otp)\b|لاگ ان|سائن ان/i,
  purchase: /\b(buy( now)?|purchase|place (your |the |my )?order|complete (your |the )?(order|purchase)|confirm (your |the )?(order|purchase|payment)|pay( now| with)?|checkout|check out|add (a )?(card|payment)|subscribe|upgrade|donate|bid|book (now|it)|reserve|renew)\b|خریدیں|آرڈر کریں|ادائیگی/i,
  destructive: /\b(delete|remove|erase|destroy|terminate|drop|wipe|purge|revoke|deactivate|close (my )?account|cancel (my |your |the )?(subscription|account|order|plan|membership)|unpublish|discard|reset (password|account)|clear all)\b|حذف|ڈیلیٹ/i,
  sending: /\b(send|reply|forward|post|publish|tweet|share|invite|comment|broadcast|submit|save and send|schedule)\b|بھیجیں|شائع/i,
  cloud: /\b(deploy|redeploy|promote|rollback|roll back|scale|restart|reboot|provision|apply changes|save changes|create (a )?(new )?(project|instance|bucket|database|cluster|server|key|token|api key|secret)|rotate|grant|billing|invoice)\b/i
};
const CLOUD_HOSTS = /(^|\.)(console\.aws\.amazon\.com|aws\.amazon\.com|console\.cloud\.google\.com|portal\.azure\.com|dash\.cloudflare\.com|vercel\.com|netlify\.com|supabase\.com|supabase\.io|digitalocean\.com|heroku\.com|render\.com|railway\.app|fly\.io|github\.com|gitlab\.com|hostinger\.com|godaddy\.com|namecheap\.com|firebase\.google\.com|console\.firebase\.google\.com)$/i;
const cleanLabel = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 100);

// What is about to be clicked? info: { label, tag, type, href, inForm, formMethod, formAction, formHasPassword, pageHost, pageHasPassword }
function classifyClick(info, { mode = 'sensitive' } = {}) {
  const label = cleanLabel(info.label), host = String(info.pageHost || '').toLowerCase(), tag = String(info.tag || '').toLowerCase(), type = String(info.type || '').toLowerCase();
  const isButton = tag === 'button' || type === 'submit' || type === 'button' || type === 'image' || info.role === 'button', isLink = tag === 'a' && !isButton;
  const submits = type === 'submit' || (tag === 'button' && info.inForm && type !== 'button');
  if (info.disabled) return { level: 'free', category: 'other', why: '' };
  // Signing in is the user's job: a button that submits a password, or "continue with Google". A plain "Log in" link only opens the sign-in page.
  if ((isButton || submits) && (info.formHasPassword || (info.pageHasPassword && (submits || W.login.test(label))))) return { level: 'human', category: 'login', why: `“${label || 'Sign in'}” would sign in. Signing in is done by you, not by the AI.` };
  if (isButton && /\b(continue|sign[ -]?in|log[ -]?in|sign[ -]?up) with (google|facebook|apple|github|microsoft|linkedin|x|twitter)\b/i.test(label)) return { level: 'human', category: 'login', why: `“${label}” signs in with another account. Signing in is done by you, not by the AI.` };
  if (isButton || submits) {
    if (W.purchase.test(label)) return { level: 'ask', category: 'purchase', why: `“${label}” may spend money or place an order` };
    if (W.destructive.test(label)) return { level: 'ask', category: 'delete', why: `“${label}” may delete or cancel something` };
    if (W.cloud.test(label) && (CLOUD_HOSTS.test(host) || submits)) return { level: 'ask', category: 'cloud', why: `“${label}” may change something in a cloud account` };
    if (W.sending.test(label)) return { level: 'ask', category: 'send', why: `“${label}” may send or publish something` };
    if (submits && String(info.formMethod || '').toLowerCase() === 'post' && info.formAction) {
      let other = false; try { other = new URL(info.formAction, `https://${host}/`).host.toLowerCase() !== host; } catch { /* keep false */ }
      if (other) return { level: 'ask', category: 'send', why: 'This form sends what you entered to a different website' };
    }
  }
  if (isLink && info.href && /\/(logout|signout|sign-out|log-out|delete|remove|unsubscribe|checkout|buy|pay)(\/|\?|$)/i.test(String(info.href).replace(/^[a-z]+:\/\/[^/]+/i, '')) && !/^(mailto|tel):/i.test(info.href)) return { level: 'ask', category: 'other', why: `This link goes to ${cleanLabel(String(info.href).replace(/^[a-z]+:\/\/[^/]+/i, ''))}` };
  if (mode === 'strict' && (isButton || isLink || submits)) return { level: 'ask', category: 'other', why: `Strict mode: “${label || 'this'}” needs your OK` };
  return { level: 'free', category: 'other', why: '' };
}

// What is about to be typed into? info: { inputType, name, id, autocomplete, label, placeholder, formHasPassword }
function classifyType(info, { mode = 'sensitive' } = {}) {
  const t = String(info.inputType || '').toLowerCase(), hay = [info.name, info.id, info.autocomplete, info.label, info.placeholder].map(x => String(x || '').toLowerCase()).join(' ');
  if (t === 'password' || /(^|\s)(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(String(info.autocomplete || '').toLowerCase()) || /\b(password|passcode|passwd|otp|one[- ]time|cvv|cvc|card number|security code|ssn|social security|iban|pin code)\b/.test(hay) || /پاس ورڈ/.test(hay))
    return { level: 'human', category: 'secret', why: 'This field takes a password, code or card number. Those are typed by you, never by the AI.' };
  if (info.formHasPassword) return { level: 'human', category: 'login', why: 'This is a sign-in form. Signing in is done by you, not by the AI.' };
  if (mode === 'strict' && !/search|query|\bq\b/.test(hay) && t !== 'search') return { level: 'ask', category: 'other', why: 'Strict mode: typing into this field needs your OK' };
  return { level: 'free', category: 'other', why: '' };
}

/* ---------- downloads ---------- */
const DANGEROUS_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|dll|sys|lnk|hta|reg|cpl|msc|apk|appx|msix|dmg|pkg|app|sh|bin|iso)$/i;
const dangerousDownload = name => DANGEROUS_EXT.test(String(name || '').trim());
function safeFileName(name) { const n = String(name || 'download').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 120); return n || 'download'; }

module.exports = { checkUrl, requestBlocked, isPrivateHost, isPrivateIp, classifyClick, classifyType, dangerousDownload, safeFileName, cleanLabel, CLOUD_HOSTS };
