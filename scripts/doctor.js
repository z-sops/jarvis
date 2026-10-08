#!/usr/bin/env node
'use strict';
/*
  Bridge doctor: checks whether Hermes Agent and Ollama on THIS computer are ready to power the crew.
  No dependencies. Read-only (it never edits your Hermes or Ollama config). Needs Node 18+.

    node scripts/doctor.js                 quick checks
    node scripts/doctor.js --smoke         also runs one real Hermes turn (can take a minute)
    node scripts/doctor.js --model qwen2.5-coder:7b     test a specific Ollama model

  It writes bridge-doctor-report.txt. Paste that file's content back to Claude.
  API keys are never printed.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const OLLAMA = (process.env.OLLAMA_HOST ? (/^https?:/.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : 'http://' + process.env.OLLAMA_HOST) : 'http://127.0.0.1:11434').replace(/\/$/, '');
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');

const lines = []; const results = [];
const out = s => { console.log(s); lines.push(s); };
const mark = { ok: '[ OK ]', warn: '[WARN]', bad: '[FAIL]', info: '[info]' };
function report(level, title, detail) {
  results.push({ level, title });
  out(`${mark[level]} ${title}` + (detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function http(url, { method = 'GET', body, timeout = 8000, stream = false } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout); const t0 = Date.now();
  try {
    const res = await fetch(url, { method, signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (stream) return { res, ctl, t0, clear: () => clearTimeout(t) };
    const text = await res.text(); clearTimeout(t);
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text, ms: Date.now() - t0 };
  } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: e.name === 'AbortError' ? `no answer within ${timeout / 1000}s` : e.message, ms: Date.now() - t0 }; }
}
function run(cmd, cmdArgs, timeout = 15000) {
  return new Promise(resolve => {
    let so = '', se = '', done = false; const t0 = Date.now();
    // with shell:true on Windows, arguments are not quoted for us
    const argv = process.platform === 'win32' ? cmdArgs.map(a => (/[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)) : cmdArgs;
    let p; try { p = spawn(cmd, argv, { shell: process.platform === 'win32', windowsHide: true }); } catch (e) { return resolve({ code: -1, error: e.message, ms: 0 }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} resolve({ code: -2, stdout: so, stderr: se, timedOut: true, ms: Date.now() - t0 }); } }, timeout);
    p.stdout.on('data', d => (so += d)); p.stderr.on('data', d => (se += d));
    p.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, error: e.message, ms: Date.now() - t0 }); } });
    p.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout: so, stderr: se, ms: Date.now() - t0 }); } });
  });
}
const clean = s => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\t\n\r\x20-\x7e]/g, '');
const gb = b => (b / 1e9).toFixed(1) + ' GB';

// Read only the `model:` block of Hermes config.yaml (no YAML dependency), hiding secrets.
function readHermesModelBlock(file) {
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const rows = txt.split(/\r?\n/); const i = rows.findIndex(l => /^model:\s*$/.test(l)); if (i < 0) return {};
  const o = {};
  for (let k = i + 1; k < rows.length; k++) {
    const l = rows[k]; if (/^\S/.test(l)) break;
    const m = l.match(/^\s+([A-Za-z_]+):\s*(.*?)\s*$/); if (m) o[m[1]] = /key|token|secret/i.test(m[1]) ? '(hidden)' : m[2].replace(/^["']|["']$/g, '');
  }
  return o;
}

async function checkSystem() {
  out('\n== This computer ==');
  report('info', `${os.platform()} ${os.release()}, Node ${process.version}`);
  if (parseInt(process.versions.node) < 18) report('bad', 'Node is older than 18', 'Bridge needs Node 18 or newer. Install the current LTS from nodejs.org.');
  report('info', `RAM: ${gb(os.totalmem())} total, ${gb(os.freemem())} free`);
  if (os.totalmem() < 15e9) report('warn', 'Under 16 GB of RAM', 'Local coding models plus Bridge will be tight. Prefer a small model (7B) or use Gemini for the crew.');
  const g = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader'], 6000);
  if (g.code === 0 && g.stdout.trim()) report('info', 'GPU: ' + clean(g.stdout).trim().split('\n').join(' | '));
  else report('info', 'No NVIDIA GPU detected by nvidia-smi', 'Fine for small models. Ollama will run on CPU or another GPU vendor (slower).');
}

async function checkHermes() {
  out('\n== Hermes Agent ==');
  const v = await run('hermes', ['--version'], 20000);
  if (v.code !== 0) { report('bad', 'hermes command not found or failed', clean(v.error || v.stderr || '').slice(0, 200) + '\nOpen a NEW terminal after installing, or add Hermes to PATH.'); return { ok: false }; }
  const ver = clean(v.stdout).split('\n')[0].trim();
  report('ok', ver);
  report(fs.existsSync(HERMES_HOME) ? 'ok' : 'warn', `Hermes home: ${HERMES_HOME}`, fs.existsSync(HERMES_HOME) ? '' : 'Folder does not exist yet. Run "hermes setup" once.');
  const cfgFile = path.join(HERMES_HOME, 'config.yaml'); const block = readHermesModelBlock(cfgFile);
  let model = null;
  if (block === null) report('warn', 'No config.yaml found', 'Hermes has no model configured yet. Run "hermes setup" or "hermes model".');
  else {
    model = block; const shown = Object.entries(block).map(([k, x]) => `${k}: ${x}`).join('\n');
    report('info', 'Default model settings in config.yaml', shown || '(model block is empty)');
    if (/11434|ollama/i.test((block.base_url || '') + (block.provider || ''))) {
      const cl = parseInt(block.context_length || '0');
      if (!cl) report('warn', 'context_length is not set for the Ollama model', 'Hermes recommends at least 64000 for agent work. Add "context_length: 64000" under model: (with Hermes closed, it rewrites this file while running).');
      else if (cl < 32000) report('bad', `context_length is only ${cl}`, 'Too small for agent work. Use 32768 at the very least, 64000 is recommended.');
      else report('ok', `context_length ${cl}`);
    }
  }
  const pdir = path.join(HERMES_HOME, 'profiles');
  let profiles = []; try { profiles = fs.readdirSync(pdir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
  report('info', `Profiles (one per crew agent): ${profiles.length ? profiles.join(', ') : 'none yet'}`);
  const gs = await run('hermes', ['gateway', 'status'], 20000);
  report('info', 'Gateway: ' + (clean(gs.stdout || gs.stderr).split('\n').map(s => s.trim()).filter(Boolean)[0] || 'unknown'));
  // API servers: default profile 8642, per-profile ports from 8650
  const alive = [];
  for (const port of [8642, 8650, 8651, 8652, 8653, 8654]) { const h = await http(`http://127.0.0.1:${port}/health`, { timeout: 1500 }); if (h.ok) alive.push(port); }
  report('info', alive.length ? `Hermes API server answering on port(s): ${alive.join(', ')}` : 'No Hermes API server is running right now', alive.length ? '' : 'Normal. Bridge starts one per crew agent when needed (needs "pip install aiohttp" inside the Hermes environment).');
  return { ok: true, model };
}

async function checkOllama(hermesModel) {
  out('\n== Ollama ==');
  const ver = await http(`${OLLAMA}/api/version`, { timeout: 4000 });
  if (!ver.ok) { report('bad', `Ollama is not answering at ${OLLAMA}`, (ver.error || `HTTP ${ver.status}`) + '\nStart it (the Ollama app, or "ollama serve") and run this again.'); return null; }
  report('ok', `Ollama ${ver.json?.version || ''} is running at ${OLLAMA}`);
  const tags = await http(`${OLLAMA}/api/tags`, { timeout: 8000 });
  const models = tags.json?.models || [];
  if (!models.length) { report('bad', 'No models installed', 'Pull one that supports tool calling, for example: ollama pull qwen2.5-coder:7b'); return null; }
  report('ok', `${models.length} model(s) installed`, models.map(m => `${m.name}  ${gb(m.size)}${m.details?.parameter_size ? '  ' + m.details.parameter_size : ''}`).join('\n'));
  const ps = await http(`${OLLAMA}/api/ps`, { timeout: 5000 });
  const loaded = ps.json?.models || [];
  if (loaded.length) report('info', 'Currently loaded in memory', loaded.map(m => `${m.name}  ${m.context_length ? 'context ' + m.context_length : 'context unknown (run "ollama ps")'}`).join('\n'));
  else report('info', 'No model is loaded right now', 'The first request will be slow while the model loads.');

  const wanted = opt('--model') || (hermesModel && /11434|ollama/i.test((hermesModel.base_url || '') + (hermesModel.provider || '')) ? hermesModel.default : undefined);
  const model = (wanted && models.find(m => m.name === wanted || m.name.startsWith(wanted + ':'))?.name) || (wanted && wanted) || models[0].name;
  report('info', `Testing with model: ${model}`, wanted ? '' : 'Pick another with --model <name>.');
  const ctxEnv = process.env.OLLAMA_CONTEXT_LENGTH;
  const ctxLoaded = loaded.find(m => m.name === model)?.context_length;
  if (ctxLoaded) report(ctxLoaded >= 32000 ? 'ok' : 'bad', `Ollama context window for ${model}: ${ctxLoaded}`, ctxLoaded >= 32000 ? '' : 'Ollama defaults to a small window. Set OLLAMA_CONTEXT_LENGTH=32768 (64K if your memory allows) and restart Ollama.');
  else if (ctxEnv) report('info', `OLLAMA_CONTEXT_LENGTH=${ctxEnv} in this terminal`, 'This only matters if it is set for the Ollama service itself.');
  else report('warn', 'Could not confirm the context window', 'Run "ollama ps" while the model is loaded and look at the CONTEXT column. It should be 32768 or more.');

  const tool = (name, description) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } });
  // 1) Can it call a tool at all?
  const t1 = await http(`${OLLAMA}/v1/chat/completions`, { method: 'POST', timeout: 150000, body: { model, stream: false, max_tokens: 1024,
    messages: [{ role: 'user', content: 'What is the weather in Karachi right now? You must use the get_weather tool.' }],
    tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }] } });
  if (!t1.ok) report('bad', `Chat request failed (${t1.error || 'HTTP ' + t1.status})`, clean(t1.text || '').slice(0, 200) + (t1.ms > 100000 ? '\nA cold model can take a while to load. Run again once it is loaded.' : ''));
  else {
    const msg = t1.json?.choices?.[0]?.message || {};
    if (msg.tool_calls?.length) report('ok', `Tool calling works (${(t1.ms / 1000).toFixed(1)}s)`, `Model asked for: ${msg.tool_calls[0].function?.name}(${msg.tool_calls[0].function?.arguments})`);
    else report('bad', 'This model did NOT call the tool', 'Crew agents need tool calling to write files and run commands. Choose a model built for tools (a coder or instruct model with tool support).\nModel said: ' + clean(msg.content || '(nothing)').slice(0, 120));
    if (t1.ms > 60000) report('warn', `Slow first answer (${(t1.ms / 1000).toFixed(0)}s)`, 'Probably loading into memory. Set OLLAMA_KEEP_ALIVE=24h so it stays loaded.');
  }
  // 2) Hermes sends streaming requests with ~25 tools. Some Ollama versions hang on that.
  const many = Array.from({ length: 25 }, (_, i) => tool('tool_' + i, 'Placeholder tool number ' + i));
  const s = await http(`${OLLAMA}/v1/chat/completions`, { method: 'POST', stream: true, timeout: 120000, body: { model, stream: true, max_tokens: 256, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], tools: many } });
  if (s.error) report('bad', 'Streaming request with 25 tools failed', s.error);
  else if (!s.res.ok) { s.clear(); report('bad', `Streaming request with 25 tools returned HTTP ${s.res.status}`, 'This matches a known Ollama/Hermes problem. Update Ollama, or try another model.'); }
  else {
    let first = null; try { const reader = s.res.body.getReader(); const { value } = await reader.read(); first = Date.now() - s.t0; try { await reader.cancel(); } catch {} void value; } catch (e) { first = null; }
    s.clear(); if (s.ctl) try { s.ctl.abort(); } catch {}
    if (first === null) report('bad', 'Streaming with many tools hung or broke', 'This is the same pattern people report with some Ollama versions. Update Ollama and retry.');
    else report(first < 45000 ? 'ok' : 'warn', `Streaming with 25 tools works, first data after ${(first / 1000).toFixed(1)}s`);
  }
  // 3) Thinking models can burn the whole token budget on hidden reasoning.
  const th = await http(`${OLLAMA}/v1/chat/completions`, { method: 'POST', timeout: 120000, body: { model, stream: false, max_tokens: 24, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }] } });
  if (th.ok) {
    const c = th.json?.choices?.[0]; const empty = !(c?.message?.content || '').trim();
    if (c?.finish_reason === 'length' && empty) report('warn', 'Thinking model detected', 'It used a tiny budget entirely on hidden reasoning. In Hermes config.yaml under model: set max_tokens: 16384 and context_length: 65536 so replies are not cut off.');
    else report('ok', 'Model answers normally with a small budget');
  }
  return { model };
}

async function smoke(model, hermesModel) {
  out('\n== One real Hermes turn (--smoke) ==');
  const a = ['chat', '-q', 'Reply with exactly the single word: pong', '-Q'];
  if (model && !(hermesModel && hermesModel.default)) a.push('-m', model);
  out('       running: hermes ' + a.join(' '));
  const r = await run('hermes', a, 180000);
  const text = clean(r.stdout).trim();
  if (r.timedOut) report('bad', 'Hermes did not answer within 3 minutes', 'This is the "hangs with local Ollama" case. Check the context window and update Hermes and Ollama. Then try another model.');
  else if (r.code !== 0) report('bad', `Hermes exited with an error (${r.code})`, clean(r.stderr || r.stdout).slice(-400));
  else report(/pong/i.test(text) ? 'ok' : 'warn', `Hermes answered in ${(r.ms / 1000).toFixed(1)}s`, text.slice(-200));
}

(async () => {
  out(`Bridge doctor  ${new Date().toISOString()}`);
  await checkSystem();
  const h = await checkHermes();
  const o = await checkOllama(h && h.model);
  if (flag('--smoke') && h && h.ok) await smoke(o && o.model, h && h.model);
  const bad = results.filter(r => r.level === 'bad'), warn = results.filter(r => r.level === 'warn');
  out('\n== Verdict ==');
  if (!bad.length && !warn.length) out('Everything needed for local crew agents looks ready.');
  else { if (bad.length) out('Fix first:\n  - ' + bad.map(b => b.title).join('\n  - ')); if (warn.length) out('Worth a look:\n  - ' + warn.map(b => b.title).join('\n  - ')); }
  const file = path.join(process.cwd(), 'bridge-doctor-report.txt');
  try { fs.writeFileSync(file, lines.join('\n') + '\n'); console.log(`\nReport saved to ${file}\nPaste its contents to Claude.`); } catch {}
})();
