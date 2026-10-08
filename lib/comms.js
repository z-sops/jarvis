'use strict';
/*
  Comms hub. Gives the AI its own inbox: Telegram, WhatsApp and Email, handled by a Hermes gateway
  running the "comms" profile. Safe by construction:
    - every channel needs an allowlist; strangers are ignored
    - risky shell commands ask for approval (right in the chat), destructive ones are denied outright
    - email content never gets a shell: the email channel only gets web, file and memory tools
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { providerSetup } = require('./hermes');
const { buildMessagingPrompt } = require('./persona');

const PROFILE = 'comms';
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const ascii = s => String(s || '').replace(/[^\t\n\r\x20-\x7e]/g, '');
const list = v => (Array.isArray(v) ? v.map(String) : String(v || '').split(/[\s,;]+/)).map(x => x.trim()).filter(Boolean);
// phone numbers may contain spaces (+92 300 1234567), so only commas, semicolons and new lines separate them
const numbers = v => (Array.isArray(v) ? v.map(String) : String(v || '').split(/[,;\n]+/)).map(x => x.replace(/[^\d]/g, '')).filter(Boolean);

// Patterns Hermes blocks outright, before any approval prompt (fnmatch globs, case-insensitive).
const DENY = ['rm -rf /*', 'rm -rf ~*', '*format c:*', '*format d:*', '*mkfs*', '*dd if=*of=/dev/*', 'shutdown*', '*reg delete hk*', '*del /s /q c:*', '*rd /s /q c:*'];

// Turns the saved channel settings into validated values. Pure, so it can be tested.
function normalize(comms = {}) {
  const errors = []; const out = { pcControl: comms.pcControl === 'off' ? 'off' : 'approve' };
  const tg = comms.telegram || {}, wa = comms.whatsapp || {}, em = comms.email || {};
  out.telegram = { enabled: !!tg.enabled, token: String(tg.token || '').trim(), allowed: list(tg.allowed) };
  out.whatsapp = { enabled: !!wa.enabled, allowed: numbers(wa.allowed) };
  out.email = { enabled: !!em.enabled, address: String(em.address || '').trim(), password: String(em.password || '').trim(), imapHost: String(em.imapHost || '').trim(), smtpHost: String(em.smtpHost || '').trim(), allowed: list(em.allowed).map(x => x.toLowerCase()) };
  if (out.telegram.enabled) {
    if (!/^\d{5,}:[\w-]{20,}$/.test(out.telegram.token)) errors.push('Telegram: the bot token looks wrong. Create one with @BotFather and paste it whole.');
    if (!out.telegram.allowed.length) errors.push('Telegram: add your numeric Telegram ID (message @userinfobot to get it). Only listed people can command the AI.');
    else if (out.telegram.allowed.some(x => !/^\d+$/.test(x))) errors.push('Telegram: allowed IDs must be numbers, not usernames.');
  }
  if (out.whatsapp.enabled && !out.whatsapp.allowed.length) errors.push('WhatsApp: add your own number with country code, for example 923001234567. Only listed numbers can command the AI.');
  if (out.email.enabled) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email.address)) errors.push("Email: enter the AI's own email address.");
    if (!out.email.password) errors.push('Email: an app password is required (not your normal password).');
    if (!out.email.imapHost || !out.email.smtpHost) errors.push('Email: IMAP and SMTP hosts are required (Gmail: imap.gmail.com and smtp.gmail.com).');
    if (!out.email.allowed.length || out.email.allowed.some(x => !/^[^@\s]+@[^@\s]+$/.test(x))) errors.push('Email: list the addresses allowed to command the AI. Mail from anyone else is ignored.');
  }
  return { value: out, errors };
}

// Builds the profile files for the gateway. Pure.
function buildFiles(cfg, comms, home) {
  const ps = providerSetup(cfg), c = comms, full = c.pcControl !== 'off';
  const chatTools = full ? ['hermes-telegram'] : ['safe', 'file', 'memory'];
  const yaml = [
    ps.modelYaml,
    'terminal:', `  cwd: ${q(home.p('workspace', PROFILE))}`,
    'approvals:', '  mode: manual', '  timeout: 120', '  deny:', ...DENY.map(d => `    - ${JSON.stringify(d)}`),
    'platform_toolsets:',
    '  telegram:', ...chatTools.map(t => `    - ${t}`),
    '  whatsapp:', ...chatTools.map(t => `    - ${t}`),
    '  email:', '    - safe', '    - file', '    - memory',
    'unauthorized_dm_behavior: ignore', ''
  ].join('\n');
  const env = { ...ps.env };
  if (c.telegram.enabled) { env.TELEGRAM_BOT_TOKEN = c.telegram.token; env.TELEGRAM_ALLOWED_USERS = c.telegram.allowed.join(','); env.TELEGRAM_HOME_CHANNEL = c.telegram.allowed[0]; }
  if (c.whatsapp.enabled) { env.WHATSAPP_ENABLED = 'true'; env.WHATSAPP_MODE = 'bot'; env.WHATSAPP_ALLOWED_USERS = c.whatsapp.allowed.join(','); }
  if (c.email.enabled) { env.EMAIL_ADDRESS = c.email.address; env.EMAIL_PASSWORD = c.email.password; env.EMAIL_IMAP_HOST = c.email.imapHost; env.EMAIL_SMTP_HOST = c.email.smtpHost; env.EMAIL_ALLOWED_USERS = c.email.allowed.join(','); }
  return { yaml, envText: Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', soul: buildMessagingPrompt(cfg, home) };
}

class CommsHub {
  constructor({ home, getCfg, setCfg, hermes, bus, restartBaseMs = 2000, restartMaxMs = 60000, maxRestarts = 5, restartWindowMs = 300000 } = {}) {
    Object.assign(this, { home, getCfg, setCfg, hermes, bus });
    this.proc = null; this.stopping = false; this.restarts = []; this.timer = null; this.lastSig = '';
    this.restartBaseMs = restartBaseMs; this.restartMaxMs = restartMaxMs; this.maxRestarts = maxRestarts; this.restartWindowMs = restartWindowMs;
    // Set by the supervisor when the gateway exits for a non-retryable reason (bad token,
    // fatal config). status() reports it until the next apply() clears it. Never restarted.
    this.fatal = null;
  }
  dir() { return this.hermes.profileDir(PROFILE); }
  logFile() { return this.hermes.logFile(PROFILE); }
  settings() { const s = normalize(this.getCfg().comms).value; return JSON.parse(JSON.stringify(s)); }

  async save(comms) {
    const { value, errors } = normalize(comms);
    if (errors.length) return { ok: false, errors };
    this.setCfg({ comms: value });
    return this.apply();
  }

  // Writes the profile and (re)starts or stops the gateway to match the settings.
  async apply() {
    const c = normalize(this.getCfg().comms).value;
    const any = c.telegram.enabled || c.whatsapp.enabled || c.email.enabled;
    if (!any) { this.stop(); this.fatal = null; return { ok: true, running: false }; }
    try {
      await this.hermes.ensureProfile({ id: PROFILE, name: 'Comms' });
      const f = buildFiles(this.getCfg(), c, this.home);
      fs.mkdirSync(this.home.p('workspace', PROFILE), { recursive: true });
      fs.writeFileSync(path.join(this.dir(), 'config.yaml'), f.yaml);
      fs.writeFileSync(path.join(this.dir(), '.env'), f.envText, { mode: 0o600 });
      fs.writeFileSync(path.join(this.dir(), 'SOUL.md'), f.soul);
    } catch (e) { return { ok: false, errors: [e.message] }; }
    this.fatal = null; this.stop(); this.start();
    return { ok: true, running: true };
  }

  start() {
    if (this.proc) return;
    this.stopping = false;
    fs.mkdirSync(path.dirname(this.logFile()), { recursive: true });
    const log = fs.openSync(this.logFile(), 'a');
    const p = this.hermes.spawnHermes(['-p', PROFILE, 'gateway', 'run'], { env: this.hermes.env(), cwd: this.home.p('workspace', PROFILE), stdio: ['ignore', log, log] });
    this.proc = p;
    const onEnd = async (code) => {
      if (this.proc !== p) return; this.proc = null;
      if (this.stopping) return;
      // Hermes v0.21.3 exits 78 (EX_CONFIG) when a platform fails for a non-retryable
      // reason such as a rejected bot token. That is NOT a crash: restarting it forever
      // just loops. Decide fatal from the state file, never from the log tail (the banner
      // is written last, so it is not a reliable signal).
      const st = this.readState();
      const fatal = code === 78 || (st && st.gateway_state === 'startup_failed') ||
        Object.entries(st && st.platforms || {}).some(([k, v]) => this.settings()[k].enabled && v.state === 'fatal');
      if (fatal) {
        const cfg = this.settings();
        let platform = null, message = (st && st.exit_reason) || '';
        for (const k of ['telegram', 'whatsapp', 'email']) {
          const ps = st && st.platforms && st.platforms[k];
          if (cfg[k].enabled && ps && ps.state === 'fatal') { platform = k; if (ps.error_message) message = ps.error_message; break; }
        }
        this.fatal = { platform, message: ascii(message).slice(0, 220) };
        this.bus.emit('comms:event', { text: `${platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'A platform'} rejected: ${this.fatal.message.slice(0, 120)}. Fix it in Comms hub, then Save and connect.` });
        return;
      }
      // A real crash: restart with backoff, but give up after maxRestarts restarts within restartWindowMs.
      const now = Date.now(); this.restarts = this.restarts.filter(t => now - t < this.restartWindowMs); this.restarts.push(now);
      if (this.restarts.length > this.maxRestarts) {
        this.bus.emit('comms:event', { text: 'The chat gateway keeps crashing. Check the log.' });
        return;
      }
      const delay = Math.min(this.restartMaxMs, this.restartBaseMs * 2 ** (this.restarts.length - 1));
      this.bus.emit('comms:event', { text: `The chat gateway stopped. Restarting in ${Math.round(delay / 1000)}s.` });
      this.timer = setTimeout(() => { if (!this.stopping) this.start(); }, delay);
    };
    p.on('exit', onEnd); p.on('error', onEnd);
  }
  readState() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir(), 'gateway_state.json'), 'utf8')); } catch { return null; }
  }
  stop() {
    this.stopping = true; clearTimeout(this.timer);
    const p = this.proc; this.proc = null; if (!p) return;
    try { if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGTERM'); } catch {}
  }

  status() {
    const c = normalize(this.getCfg().comms).value; let st = null;
    try { st = JSON.parse(fs.readFileSync(path.join(this.dir(), 'gateway_state.json'), 'utf8')); } catch {}
    const running = !!this.proc && !!st && st.gateway_state === 'running';
    const platforms = {};
    for (const k of ['telegram', 'whatsapp', 'email']) {
      if (!c[k].enabled) { platforms[k] = { state: 'off' }; continue; }
      const ps = st && st.platforms && st.platforms[k];
      if (this.fatal && this.fatal.platform === k) { platforms[k] = { state: 'fatal', error: this.fatal.message }; continue; }
      platforms[k] = ps ? { state: ps.state, error: ps.error_message ? ascii(ps.error_message).slice(0, 220) : '' } : { state: this.proc ? 'starting' : 'stopped' };
    }
    return { running, platforms, whatsappPaired: this.whatsappPaired(), pcControl: c.pcControl, fatal: this.fatal };
  }
  whatsappPaired() {
    for (const d of [path.join(this.dir(), 'platforms', 'whatsapp', 'session'), path.join(this.hermes.hermesHome, 'platforms', 'whatsapp', 'session')]) {
      try { if (fs.readdirSync(d).length) return true; } catch {}
    }
    return false;
  }
  pollChanged() { const s = JSON.stringify(this.status()); const ch = s !== this.lastSig; this.lastSig = s; return ch ? JSON.parse(s) : null; }

  // Opens a terminal with the WhatsApp QR pairing wizard. Returns the manual command as well.
  pairWhatsApp() {
    const home = this.hermes.hermesHome, cmd = this.hermes.cmd();
    const manual = process.platform === 'win32' ? `$env:HERMES_HOME='${home}'; ${cmd} -p ${PROFILE} whatsapp` : `HERMES_HOME='${home}' ${cmd} -p ${PROFILE} whatsapp`;
    try {
      fs.mkdirSync(home, { recursive: true });
      if (process.platform === 'win32') {
        const f = path.join(home, 'pair-whatsapp.cmd');
        fs.writeFileSync(f, `@echo off\r\nset "HERMES_HOME=${home}"\r\necho Open WhatsApp on the AI's phone: Settings, Linked devices, Link a device. Scan the QR below.\r\n"${cmd}" -p ${PROFILE} whatsapp\r\npause\r\n`);
        spawn('cmd.exe', ['/c', 'start', '"Orbit WhatsApp pairing"', `"${f}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
        return { ok: true, manual };
      }
    } catch (e) { return { ok: false, error: e.message, manual }; }
    return { ok: false, error: 'Automatic terminal opening is only set up for Windows. Run the command below in a terminal.', manual };
  }
}

module.exports = { CommsHub, normalize, buildFiles, PROFILE, DENY };
