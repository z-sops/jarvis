'use strict';
/*
  Hermes engine. Every crew agent becomes a Hermes Agent profile inside <home>/hermes.
  Orbit starts a local Hermes API server for the profile on demand, sends it jobs and streams progress back.
  Orbit never touches your own ~/.hermes: it runs Hermes with HERMES_HOME=<home>/hermes.
*/
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildAgentPrompt } = require('./persona');

const q = s => `'${String(s).replace(/'/g, "''")}'`; // YAML single-quoted scalar (safe for Windows paths)

const PROVIDERS = {
  gemini: { provider: 'gemini', keyEnv: 'GEMINI_API_KEY' },
  openrouter: { provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY' },
  anthropic: { provider: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  openai: { provider: 'openai-api', keyEnv: 'OPENAI_API_KEY' },
  custom: { provider: 'custom', keyEnv: null }
};

// Turns Orbit settings into the pieces Hermes needs. Pure, so it can be tested.
function providerSetup(cfg) {
  const name = PROVIDERS[cfg.workerProvider] ? cfg.workerProvider : 'gemini';
  const p = PROVIDERS[name];
  const key = String(cfg.workerApiKey || (name === 'gemini' ? cfg.apiKey : '') || '').trim();
  const model = String(cfg.workerModel || (name === 'gemini' ? cfg.textModel : '') || '').trim();
  if (!model) throw new Error('Choose a model for the crew in Settings (Crew engine).');
  if (!key) throw new Error(name === 'gemini' ? 'Add your Gemini key in Settings.' : 'Add the crew API key in Settings (Crew engine).');
  if (name === 'custom' && !cfg.workerBaseUrl) throw new Error('A custom provider needs a base URL (Settings, Crew engine).');
  const lines = ['model:', `  default: ${q(model)}`, `  provider: ${p.provider}`];
  const env = {};
  if (name === 'custom') { lines.push(`  base_url: ${q(cfg.workerBaseUrl)}`, `  api_key: ${q(key)}`, `  context_length: ${parseInt(cfg.workerContext) || 128000}`); }
  else env[p.keyEnv] = key;
  return { name, model, modelYaml: lines.join('\n'), env };
}

function freePort(start) {
  return new Promise(resolve => {
    const tryPort = p => {
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ascii = s => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\t\n\r\x20-\x7e]/g, '');

// Parses a server-sent-events text stream into { event, data } blocks.
function makeSseParser(onBlock) {
  let buf = '';
  return chunk => {
    buf += chunk.replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      let event = 'message'; const data = [];
      for (const l of raw.split('\n')) { if (l.startsWith('event:')) event = l.slice(6).trim(); else if (l.startsWith('data:')) data.push(l.slice(5).trim()); }
      if (data.length) onBlock({ event, data: data.join('\n') });
    }
  };
}

class HermesEngine {
  constructor({ home, getCfg, requireContainment = true }) {
    this.home = home; this.getCfg = getCfg; this.containmentProtocol = requireContainment ? 1 : 0; this.brokerProtocol = 1; this.servers = new Map(); this.starting = new Map();
  }
  get hermesHome() { return path.join(this.home.root, 'hermes'); }
  cmd() { return (this.getCfg().hermesPath || 'hermes').trim(); }
  env(extra = {}) { return { ...require('./sandbox').scrubEnv(process.env), HERMES_HOME: this.hermesHome, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...extra }; }

  // Windows shell quoting for one argument. With shell:true Node used to concatenate the argv
  // array unescaped (DEP0190), which broke paths containing spaces and could be abused through an
  // argument that looked like a flag. We build ONE command string ourselves and pass it as the
  // sole argument, so every piece is quoted exactly once.
  wq(s) { const v = String(s); return /[\s"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v; }
  winCmd(args) { return [this.cmd(), ...args].map(a => this.wq(a)).join(' '); }

  // Spawn Hermes. win32: one quoted command string with shell:true. Everywhere else:
  // spawn(this.cmd(), args, {shell:false}) - a full command string is NOT an executable name
  // when shell is off, so the old winCmd() call in _start() and CommsHub.start() broke Linux/Mac.
  spawnHermes(args, opts = {}) {
    if (process.platform === 'win32') return spawn(this.winCmd(args), { ...opts, shell: true, windowsHide: true });
    return spawn(this.cmd(), args, { ...opts, shell: false, windowsHide: true });
  }

  // Hermes 0.21.x does a GitHub update check on EVERY invocation, including
  // `hermes --version`: measured 28.5 s on Zee's machine. That makes the
  // 30 s spawnSync in hasHermes() time out under parallel test runs, and it
  // makes every crew job and the comms gateway start slow. The check is
  // controlled by updates.check in the HERMES_HOME root config.yaml (profile
  // configs are NOT read by it - verified in hermes_cli/config.py
  // get_config_path()). We write the opt-out once; Zee's own ~/.hermes is
  // never touched because Orbit runs Hermes with its own HERMES_HOME.
  silenceUpdateCheck() {
    const f = path.join(this.hermesHome, 'config.yaml');
    try {
      const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      if (/updates:\s*\n?\s*check:\s*false/m.test(cur)) return;
      fs.mkdirSync(this.hermesHome, { recursive: true });
      fs.writeFileSync(f, (cur ? cur.replace(/\n+$/, '') + '\n\n' : '') + 'updates:\n  check: false\n', { mode: 0o600 });
    } catch {}
  }
  profileDir(id) { return path.join(this.hermesHome, 'profiles', id); }
  logFile(id) { return path.join(this.hermesHome, 'logs', `bridge-${id}.log`); }
  secret() {
    const f = path.join(this.hermesHome, '.bridge-secret');
    try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
    fs.mkdirSync(this.hermesHome, { recursive: true });
    const s = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(f, s, { mode: 0o600 }); return s;
  }
  keyFor(id) { return crypto.createHmac('sha256', this.secret()).update(id).digest('hex').slice(0, 40); } // API server needs 16+ chars

  run(args, { timeout = 60000, cwd } = {}) {
    return new Promise(resolve => {
      let so = '', se = '', done = false;
      let p; try { p = this.spawnHermes(args, { env: this.env(), cwd }); } catch (e) { return resolve({ code: -1, error: e.message }); }
      const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve({ code: -2, timedOut: true, stdout: ascii(so), stderr: ascii(se) }); } }, timeout);
      p.stdout.on('data', d => (so += d)); p.stderr.on('data', d => (se += d));
      p.on('error', e => { if (!done) { done = true; clearTimeout(t); resolve({ code: -1, error: e.message }); } });
      p.on('close', code => { if (!done) { done = true; clearTimeout(t); resolve({ code, stdout: ascii(so), stderr: ascii(se) }); } });
    });
  }

  async detect() {
    if (this.containmentProtocol === 1) return require('./native-containment').checkRuntime(this.getCfg(),'hermes');
    this.silenceUpdateCheck();
    const r = await this.run(['--version'], { timeout: 90000 });
    if (r.code !== 0) return { ok: false, error: r.error || r.stderr || 'Hermes did not answer', hint: `Orbit could not run "${this.cmd()}". Set the full path to hermes in Settings (Crew engine).` };
    return { ok: true, version: r.stdout.split('\n')[0].trim() };
  }

  async ensureProfile(agent) {
    this.silenceUpdateCheck();
    if (!fs.existsSync(this.profileDir(agent.id))) {
      fs.mkdirSync(this.hermesHome, { recursive: true });
      const r = await this.run(['profile', 'create', agent.id], { timeout: 90000 });
      if (!fs.existsSync(this.profileDir(agent.id))) throw new Error(`Could not create the Hermes profile for ${agent.name}: ${(r.error || r.stderr || r.stdout || '').slice(-300)}`);
    }
  }
  writeSoul(agent, cfgOverride) {
    fs.writeFileSync(path.join(this.profileDir(agent.id), 'SOUL.md'), buildAgentPrompt(this.getCfg(), this.home, { ...agent, workspaceDir: cfgOverride?.workspaceDir }));
  }
  writeProfile(agent, port, cfgOverride) {
    const cfg = { ...this.getCfg(), ...(cfgOverride || {}) }, ps = providerSetup(cfg), dir = this.profileDir(agent.id), ws = cfgOverride?.workspaceDir || this.home.p('workspace', agent.id);
    fs.mkdirSync(ws, { recursive: true });
    const xy = (this.extraYaml && this.extraYaml({ ...agent, workspaceDir: ws })) || { agent: '', top: '' };   // Orbit Browser link + Hermes' own browser off
    const approval = ['approvals:', '  mode: manual', '  timeout: 120', '  deny:', ...require('./comms').DENY.map(d => '    - ' + q(d))].join('\n');
    const yaml = `${ps.modelYaml}\nterminal:\n  cwd: ${q(ws)}\n${xy.terminal || ''}${approval}\ncompression:\n  enabled: true\n  threshold: 0.05\nagent:\n  api_max_retries: 5\n${xy.agent}${xy.top}`;
    const envLines = ['API_SERVER_ENABLED=true', `API_SERVER_PORT=${port}`, `API_SERVER_KEY=${this.keyFor(agent.id)}`, ...Object.entries(ps.env).map(([k, v]) => `${k}=${v}`), ...(xy.env || [])];
    fs.writeFileSync(path.join(dir, 'config.yaml'), yaml);
    fs.writeFileSync(path.join(dir, '.env'), envLines.join('\n') + '\n', { mode: 0o600 });
    this.writeSoul(agent, cfgOverride);
    return crypto.createHash('sha1').update(yaml + envLines.filter(l => !l.startsWith('API_SERVER_PORT')).join('\n')).digest('hex');
  }

  tail(id, n = 25) { try { return ascii(fs.readFileSync(this.logFile(id), 'utf8')).split('\n').slice(-n).join('\n'); } catch { return ''; } }
  explain(id) {
    const t = this.tail(id);
    if (/aiohttp not installed/i.test(t)) return 'Hermes needs the "aiohttp" package for its API server. Run:  pip install aiohttp   (in the same Python environment Hermes uses), then try again.';
    if (/API_SERVER_KEY.*(short|placeholder)/i.test(t)) return 'Hermes refused the API key (too short). Delete hermes/.bridge-secret in the home folder and retry.';
    return t.split('\n').filter(Boolean).slice(-4).join('\n');
  }

  async ensureServer(agent, cfgOverride) {
    const cur = this.servers.get(agent.id);
    const cfgSig = (() => { try { const ps = providerSetup({ ...this.getCfg(), ...(cfgOverride || {}) }); return ps.modelYaml + JSON.stringify(ps.env) + (cfgOverride?.workspaceDir || '') + (this.extraSig ? this.extraSig(agent) : ''); } catch (e) { throw e; } })();
    if (cur && cur.alive && cur.cfgSig === cfgSig) { cur.lastUse = Date.now(); return cur; }
    if (cur) this.stop(agent.id);
    if (this.starting.has(agent.id)) return this.starting.get(agent.id);
    const p = this._start(agent, cfgSig, cfgOverride).finally(() => this.starting.delete(agent.id));
    this.starting.set(agent.id, p); return p;
  }
  async _start(agent, cfgSig, cfgOverride) {
    await this.ensureProfile(agent);
    const port = await freePort(8650);
    this.writeProfile(agent, port, cfgOverride);
    if (agent.allowCode === false) {
      // Code execution is switched off for this crew member. If we cannot confirm it is off, do not start.
      await this.run(['-p', agent.id, 'tools', 'disable', '--platform', 'api_server', 'code_execution'], { timeout: 60000 });
      let cfgText = ''; try { cfgText = fs.readFileSync(path.join(this.profileDir(agent.id), 'config.yaml'), 'utf8'); } catch {}
      const blk = /^[ \t]+api_server:[ \t]*\r?\n((?:[ \t]+-[ \t]+\S+[ \t]*\r?\n?)+)/m.exec(cfgText);
      if (!blk || /code_execution/.test(blk[1])) throw new Error(`Could not turn off code execution for ${agent.name}, so I did not start them. Turn the switch back on or check Hermes.`);
    }
    fs.mkdirSync(path.dirname(this.logFile(agent.id)), { recursive: true });
    const log = fs.openSync(this.logFile(agent.id), 'a');
    const proc = this.spawnHermes(['-p', agent.id, 'gateway', 'run'], { env: this.env(), cwd: cfgOverride?.workspaceDir || this.home.p('workspace', agent.id), stdio: ['ignore', log, log], detached: false });
    const s = { proc, port, key: this.keyFor(agent.id), alive: true, lastUse: Date.now(), busy: 0, cfgSig, agent };
    proc.on('exit', () => { s.alive = false; });
    proc.on('error', () => { s.alive = false; });
    this.servers.set(agent.id, s);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      if (!s.alive) { this.servers.delete(agent.id); throw new Error(`Hermes stopped while starting ${agent.name}. ${this.explain(agent.id)}`); }
      try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) break; } catch {}
      if (Date.now() - t0 > 8000 && /aiohttp not installed/i.test(this.tail(agent.id))) { this.stop(agent.id); throw new Error(this.explain(agent.id)); }
      await sleep(600);
    }
    if (Date.now() - t0 >= 90000) { this.stop(agent.id); throw new Error(`Hermes did not start in time for ${agent.name}. ${this.explain(agent.id)}`); }
    s.idleTimer = setInterval(() => {
      const idle = (parseInt(this.getCfg().hermesIdleMinutes) || 10) * 60000;
      if (s.busy === 0 && Date.now() - s.lastUse > idle) this.stop(agent.id);
    }, 30000);
    s.idleTimer.unref && s.idleTimer.unref();
    return s;
  }

  stop(id) {
    const s = this.servers.get(id); if (!s) return;
    this.servers.delete(id); clearInterval(s.idleTimer); s.alive = false;
    try {
      if (process.platform === 'win32' && s.proc.pid) spawn('taskkill', ['/pid', String(s.proc.pid), '/T', '/F'], { windowsHide: true });
      else s.proc.kill('SIGTERM');
    } catch {}
  }
  stopAll() { for (const id of [...this.servers.keys()]) this.stop(id); }
  status(id) { const s = this.servers.get(id); return s && s.alive ? { running: true, port: s.port } : { running: false }; }

  // Sends one job to an agent and streams progress. Resolves with the agent's final report.
  async runTask(agent, task, { onProgress, signal, onUsage, cfgOverride, onText, onTransport } = {}) {
      if (this.containmentProtocol === 1) {
        if (!cfgOverride?.nativeContainer) throw new Error('Native Hermes jobs require OS containment; no host fallback was started.');
        return cfgOverride.nativeContainer.execute(task, { onProgress, onUsage, onText, onTransport });
      }
      signal?.throwIfAborted();
      const s = await this.ensureServer(agent, cfgOverride);
      if (signal?.aborted) { try { this.stop(agent.id); } catch {} signal.throwIfAborted(); }
      const stop = () => { try { this.stop(agent.id); } catch {} };
      signal?.addEventListener('abort', stop, { once: true });
      s.busy++; s.lastUse = Date.now();
      try { this.writeSoul(agent, cfgOverride); return await this._post(s, agent, task, onProgress, signal, onUsage, onText, onTransport); }
      finally { signal?.removeEventListener('abort', stop); s.busy--; s.lastUse = Date.now(); }
  }
  async _post(s, agent, task, onProgress, signal, onUsage, onText, onTransport) {
    const observe = event => { try { if (onTransport) onTransport(event); } catch { /* telemetry only */ } };
    const ctl = new AbortController(); let idle;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error('The agent went silent for 10 minutes.')), 10 * 60000); };
    signal?.throwIfAborted();
    const onAbort = () => ctl.abort(signal.reason);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    bump();
    let text = '';
    try {
      let res;
      try {
        const submitted = JSON.stringify({ model: agent.id, stream: true, messages: [{ role: 'user', content: task }] });
        observe({ kind: 'submitted', source: 'hermes_local_api', bytes: Buffer.byteLength(submitted) });
        res = await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, { method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json' },
          body: submitted });
      } catch (e) { if (ctl.signal.aborted) throw ctl.signal.reason || e; const err = new Error('Lost the connection to the agent process. The job outcome may be unknown. Inspect existing outputs before retrying; Orbit did not replay the request.'); err.code = 'ECONN'; throw err; }
      if (!res.ok) { const errorText = await res.text(); observe({ kind: 'received', source: 'hermes_local_api', bytes: Buffer.byteLength(errorText) }); throw new Error(`Hermes answered ${res.status}: ${ascii(errorText).slice(0, 240)}`); }
      const dec = new TextDecoder();
      const parse = makeSseParser(({ event, data }) => {
        if (data === '[DONE]') return;
        let j; try { j = JSON.parse(data); } catch { return; }
        if (event === 'hermes.tool.progress') { if (onProgress) onProgress({ tool: j.tool, label: j.label, status: j.status, id: j.toolCallId }); return; }
        if (j.usage && onUsage) { try { onUsage(j.usage); } catch {} }
        const d = j.choices && j.choices[0] && j.choices[0].delta; if (d && d.content) { text += d.content; if (onText) { try { onText(text); } catch { /* a listener must never break a job */ } } }
        if (j.error) throw new Error(j.error.message || 'Hermes error');
      });
      for await (const chunk of res.body) { bump(); observe({ kind: 'received', source: 'hermes_local_api', bytes: chunk.byteLength }); parse(dec.decode(chunk, { stream: true })); }
    } finally { clearTimeout(idle); if (signal) signal.removeEventListener('abort', onAbort); }
    return text.trim() || '(The agent finished without a written report.)';
  }

  // Used by Settings > "Test engine". Steps stop at the first failure.
  async check({ smoke = false } = {}) {
    if(this.containmentProtocol===1){const d=await this.detect();return [{name:'Contained Hermes runtime (no model call)',ok:d.ok,detail:d.ok?d.scope+' '+d.version:d.error}];}
    const steps = []; const add = (name, ok, detail) => { steps.push({ name, ok, detail: detail || '' }); return ok; };
    const d = await this.detect();
    if (!add('Hermes found', d.ok, d.ok ? d.version : `${d.error} ${d.hint || ''}`)) return steps;
    let ps; try { ps = providerSetup(this.getCfg()); add('Model and key set', true, `${ps.name} / ${ps.model}`); } catch (e) { add('Model and key set', false, e.message); return steps; }
    const probe = { id: 'bridge-check', name: 'Orbit check', role: 'Self test' };
    try { await this.ensureServer(probe); add('Hermes API server starts', true, 'Profile "bridge-check" is running locally'); }
    catch (e) { add('Hermes API server starts', false, e.message); return steps; }
    if (smoke) {
      try { const t0 = Date.now(); const r = await this.runTask(probe, 'Reply with exactly the single word: pong'); add('One real turn with your model', /pong/i.test(r), `${((Date.now() - t0) / 1000).toFixed(1)}s. Reply: ${r.slice(0, 120)}`); }
      catch (e) { add('One real turn with your model', false, e.message); }
    }
    this.stop(probe.id);
    return steps;
  }
}

module.exports = { HermesEngine, providerSetup, makeSseParser, PROVIDERS };
