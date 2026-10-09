'use strict';
/*
  OpenCode engine. An alternative to Hermes: every crew agent becomes its own OpenCode project
  (its own workspace folder with its own opencode.json) and a job is one `opencode run` call,
  scoped to that folder with --dir. Orbit never touches your own ~/.config/opencode: each
  agent's config lives inside its own workspace folder, so it is picked up as that run's
  project-level config only, same as Hermes keeps every profile inside <home>/hermes.
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROVIDERS = {
  gemini: { id: 'google', keyEnv: 'GEMINI_API_KEY' },
  opencode: { id: 'opencode', keyEnv: 'OPENCODE_API_KEY' },
  openrouter: { id: 'openrouter', keyEnv: 'OPENROUTER_API_KEY' },
  anthropic: { id: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  openai: { id: 'openai', keyEnv: 'OPENAI_API_KEY' },
  custom: { id: 'custom', keyEnv: 'BRIDGE_CREW_KEY' }
};

// Turns Orbit settings into an opencode.json provider block + the "provider/model" string + env vars to set.
// Pure, so it can be tested without spawning anything. Shares the same Settings fields Hermes uses
// (workerProvider / workerModel / workerApiKey / workerBaseUrl) so switching engines keeps the same crew setup.
function providerSetup(cfg) {
  const name = PROVIDERS[cfg.workerProvider] ? cfg.workerProvider : 'gemini';
  const p = PROVIDERS[name];
  const key = String(cfg.workerApiKey || (name === 'gemini' ? cfg.apiKey : '') || '').trim();
  let model = String(cfg.workerModel || (name === 'gemini' ? cfg.textModel : '') || '').trim(); if (name === 'opencode') model = model.replace(/^opencode\//, '');
  if (!model) throw new Error('Choose a model for the crew in Settings (Crew engine).');
  if (!key) throw new Error(name === 'gemini' ? 'Add your Gemini key in Settings.' : 'Add the crew API key in Settings (Crew engine).');
  if (name === 'custom' && !cfg.workerBaseUrl) throw new Error('A custom provider needs a base URL (Settings, Crew engine).');
  const env = { [p.keyEnv]: key };
  if (name === 'custom') {
    const provider = { custom: { npm: '@ai-sdk/openai-compatible', name: 'Orbit crew', options: { baseURL: cfg.workerBaseUrl, apiKey: `{env:${p.keyEnv}}` }, models: { [model]: { name: model, limit: { context: parseInt(cfg.workerContext) || 128000 } } } } };
    return { name, model: `custom/${model}`, provider, env };
  }
  const provider = { [p.id]: { options: { apiKey: `{env:${p.keyEnv}}` } } };
  return { name, model: `${p.id}/${model}`, provider, env };
}

const ascii = s => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\t\n\r\x20-\x7e]/g, '');

// Windows: the arguments are put into one command line for cmd.exe. cmd.exe ends a command at the first line break, so line breaks are joined with " | ", and a double quote inside an argument becomes a single quote.
function winArgs(args) { return args.map(a => (/[\s"]/.test(a) ? `"${String(a).replace(/\r?\n+/g, ' | ').replace(/"/g, "'")}"` : a)); }

class OpenCodeEngine {
  constructor({ home, getCfg }) { this.home = home; this.getCfg = getCfg; }
  get root() { return path.join(this.home.root, 'opencode'); }
  cmd() { return (this.getCfg().opencodePath || 'opencode').trim(); }
  profileDir(id) { const d = path.join(this.root, 'profiles', id); fs.mkdirSync(d, { recursive: true }); return d; }
  env(extra = {}) { const data = path.join(this.root, 'data'); try { fs.mkdirSync(data, { recursive: true }); } catch {} const clean = require('./sandbox').scrubEnv(process.env); for (const k of Object.keys(clean)) if (/^OPENCODE_|^NODE_OPTIONS$/i.test(k)) delete clean[k]; return { ...clean, XDG_DATA_HOME: data, ...extra }; }

  // Writes this agent's workspace + the opencode.json that scopes OpenCode to the crew's model and key.
  // cfgOverride lets one agent run a different provider/model than the crew default (Settings > that
  // agent's own engine fields) -- only the fields it sets are overridden, everything else still comes
  // from the shared crew settings.
  writeProjectConfig(agent, cfgOverride = {}) {
    const ps = providerSetup({ ...this.getCfg(), ...cfgOverride });
    const ws = cfgOverride.workspaceDir || this.home.p('workspace', agent.id);
    fs.mkdirSync(ws, { recursive: true });
    const permission = { '*': 'deny', read: { '*': 'allow', '*.env': 'deny', '.env*': 'deny', '*secrets*': 'deny', '*.pem': 'deny', '*.key': 'deny' }, glob: 'allow', grep: 'allow', edit: { '*': 'allow', '.env*': 'deny', '*secrets*': 'deny', '*.pem': 'deny', '*.key': 'deny', '.git/*': 'deny' }, bash: 'deny', external_directory: 'deny' };
    const conf = { $schema: 'https://opencode.ai/config.json', model: ps.model, provider: ps.provider, permission };
    fs.writeFileSync(path.join(ws, 'opencode.json'), JSON.stringify(conf, null, 2));
    const config = path.join(this.profileDir(agent.id), 'config'); fs.mkdirSync(config, { recursive: true });
    return { ws, env: { ...ps.env, XDG_CONFIG_HOME: config, OPENCODE_PERMISSION: JSON.stringify(permission) }, model: ps.model };
  }

  _spawn(args, opts) {
    const argv = process.platform === 'win32' ? winArgs(args) : args;
    return require('./killtree').wrap(spawn(this.cmd(), argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', windowsHide: true }), { log: m => { try { fs.appendFileSync(path.join(this.root, 'killtree.log'), new Date().toISOString() + ' ' + m + '\n'); } catch { /* no log */ } } });
  }

  run(args, { timeout = 60000, cwd, env } = {}) {
    return new Promise(resolve => {
      let so = '', se = '', done = false, p;
      try { p = this._spawn(args, { env: this.env(env), cwd }); } catch (e) { return resolve({ code: -1, error: e.message }); }
      const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve({ code: -2, timedOut: true, stdout: ascii(so), stderr: ascii(se) }); } }, timeout);
      p.stdout.on('data', d => (so += d)); p.stderr.on('data', d => (se += d));
      p.on('error', e => { if (!done) { done = true; clearTimeout(t); resolve({ code: -1, error: e.message }); } });
      p.on('close', code => { if (!done) { done = true; clearTimeout(t); resolve({ code, stdout: ascii(so), stderr: ascii(se) }); } });
    });
  }

  async detect() {
    const r = await this.run(['--version'], { timeout: 30000 });
    if (r.code !== 0) return { ok: false, error: r.error || r.stderr || 'OpenCode did not answer', hint: `Orbit could not run "${this.cmd()}". Set the full path to opencode in Settings (Crew engine).` };
    return { ok: true, version: (r.stdout || '').split('\n')[0].trim() };
  }

  // Sends one job to an agent. OpenCode has no long-running server of its own here: each job is its
  // own one-shot `opencode run`, scoped to the agent's own workspace folder (--dir), so two jobs for
  // two different agents never see each other's files or config.
  async runTask(agent, task, { onProgress, signal, cfgOverride, onData, onText } = {}) {
    signal?.throwIfAborted();
    const ready = await this.preflight(cfgOverride); if (!ready.ok) throw new Error(ready.error);
    signal?.throwIfAborted();
    const { ws, env } = this.writeProjectConfig(agent, cfgOverride);
    if (onProgress) onProgress({ tool: 'opencode', label: 'Working', status: 'running' });
    const timeout = 10 * 60000; const jsonOn = this.getCfg().opencodeJson !== false; const ev = jsonOn ? require('./ocevents').makeCollector({ onProgress, onText, log: m => { try { const lf = path.join(this.root, 'events.log'); fs.mkdirSync(this.root, { recursive: true }); fs.appendFileSync(lf, new Date().toISOString().slice(11, 19) + ' ' + agent.id + ' ' + m + '\n'); } catch { /* no log */ } } }) : null;
    const r = await new Promise(resolve => {
      let so = '', se = '', done = false, p;
      try { const argv = ['run', task, ...(jsonOn ? ['--format', 'json'] : []), '--dir', ws]; if (ev) ev.note('spawn ' + this.cmd() + ' run <task: ' + String(task).length + ' chars, ' + (String(task).match(/"/g) || []).length + ' double quotes> ' + argv.slice(2).join(' ')); p = this._spawn(argv, { env: this.env(env), cwd: ws }); } catch (e) { return resolve({ code: -1, error: e.message }); }
      const onAbort = () => { try { p.kill(); } catch {} };
      if (signal) signal.addEventListener('abort', onAbort);
      const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve({ code: -2, timedOut: true, stdout: so, stderr: se }); } }, timeout);
      // No output at all for a while means it is stuck (a model that never answers, a hidden prompt): stop it instead of waiting the full 10 minutes.
      const idleMs = Number(this.getCfg().opencodeIdleMs) || 4 * 60000; let idleT;
      let probeT; const probeMs = Number(this.getCfg().opencodeProbeMs) || 90000;
      const probeLater = () => { clearTimeout(probeT); probeT = setTimeout(async () => { if (done) return; if (onProgress) onProgress({ tool: 'model-health', label: 'No output for ' + Math.round(probeMs / 1000) + ' s; worker state is unknown. No paid model probe was submitted.', status: 'unknown' }); }, probeMs); if (probeT.unref) probeT.unref(); };
      const bump = () => { probeLater(); clearTimeout(idleT); idleT = setTimeout(() => { if (!done) { done = true; clearTimeout(t); try { p.kill(); } catch {} resolve({ code: -3, idle: true, stdout: ascii(so), stderr: ascii(se) }); } }, idleMs); if (idleT.unref) idleT.unref(); };
      bump();
      p.stdout.on('data', d => { so += d; bump(); if (onData) onData(d.length); if (ev) ev.push(d); }); p.stderr.on('data', d => { se += d; bump(); if (onData) onData(d.length); if (ev) ev.note('err ' + String(d).replace(/\s+/g, ' ').slice(0, 160)); });
      p.on('error', e => { if (!done) { done = true; clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve({ code: -1, error: e.message }); } });
      p.on('close', code => { if (!done) { done = true; clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve({ code, stdout: ascii(so), stderr: ascii(se) }); } });
    });
    if (onProgress) onProgress({ tool: 'opencode', label: 'Finished', status: 'done' });
    if (r.idle) throw new Error('The OpenCode agent wrote nothing for ' + Math.round((Number(this.getCfg().opencodeIdleMs) || 4 * 60000) / 60000) + ' minutes, so Orbit stopped it. Check Settings > Test engine (OpenCode installed, model and key working), or set this agent to Built-in.');
    if (r.timedOut) throw new Error('The OpenCode agent went silent for 10 minutes.');
    if (r.code !== 0) throw new Error(`OpenCode exited with an error: ${(r.stderr || r.stdout || '').trim().slice(-400) || ('code ' + r.code)}`);
    if (ev) ev.end(); if (ev && ev.count()) return ev.text() || '(The agent finished without a written report.)';
    return (r.stdout || '').trim() || '(The agent finished without a written report.)';
  }

  async probe(cfgOverride, timeout = 45000) {
    let ps; try { ps = providerSetup({ ...this.getCfg(), ...(cfgOverride || {}) }); } catch (e) { return { ok: false, error: e.message, ms: 0 }; }
    const dir = this.profileDir('probe');
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: ps.model, provider: ps.provider }, null, 2));
    const t0 = Date.now(); const r = await this.run(['run', 'Reply with exactly the single word: pong', '--dir', dir], { timeout, cwd: dir, env: ps.env }); const ms = Date.now() - t0;
    if (r.timedOut) return { ok: false, error: 'no answer in ' + Math.round(timeout / 1000) + ' s', ms };
    if (r.error) return { ok: false, error: r.error, ms };
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout || ('exit code ' + r.code)).trim().slice(-200), ms };
    return /pong/i.test(r.stdout) ? { ok: true, ms } : { ok: false, error: 'unexpected answer: ' + (r.stdout || '').trim().slice(0, 80), ms };
  }

  // A quick look before a job starts: does OpenCode run, and are a model and key set for this agent? No model call.
  async preflight(cfgOverride) {
    if (!this._det || !this._det.r.ok || Date.now() - this._det.t > 60000) this._det = { t: Date.now(), r: await this.detect() };
    const d = this._det.r;
    if (!d.ok) return { ok: false, error: `OpenCode is not ready: ${d.error || 'it did not answer'} ${d.hint || ''}`.trim() };
    if (!/^(?:OpenCode\s+)?1\./i.test(d.version || '')) return { ok: false, error: 'OpenCode native policy currently supports version 1.x only. Other permission schemas require a verified adapter before execution.' };
    try { providerSetup({ ...this.getCfg(), ...(cfgOverride || {}) }); } catch (e) { return { ok: false, error: `OpenCode is not ready: ${e.message}` }; }
    return { ok: true };
  }

  // Used by Settings > "Test engine" when the crew engine is set to OpenCode. Steps stop at the first failure.
  async check({ smoke = false } = {}) {
    const steps = []; const add = (name, ok, detail) => { steps.push({ name, ok, detail: detail || '' }); return ok; };
    const d = await this.detect();
    if (!add('OpenCode found', d.ok, d.ok ? d.version : `${d.error} ${d.hint || ''}`)) return steps;
    let ps; try { ps = providerSetup(this.getCfg()); add('Model and key set', true, ps.model); } catch (e) { add('Model and key set', false, e.message); return steps; }
    if (smoke) {
      const probe = { id: 'bridge-check', name: 'Orbit check', role: 'Self test' };
      try { const t0 = Date.now(); const r = await this.runTask(probe, 'Reply with exactly the single word: pong'); add('One real turn with your model', /pong/i.test(r), `${((Date.now() - t0) / 1000).toFixed(1)}s. Reply: ${r.slice(0, 120)}`); }
      catch (e) { add('One real turn with your model', false, e.message); }
    }
    return steps;
  }
}

module.exports = { OpenCodeEngine, providerSetup, winArgs };
