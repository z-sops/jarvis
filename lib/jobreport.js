'use strict';
/*
  What a crew member is doing right now, kept cheaply (no model call), and the short note that lets a stopped job go on without re-reading everything.
    makeTrail()          records progress steps and the last words of a running job
    recentFiles(dir,t)   files changed in the workspace since the job began
    format(snap, ...)    the report text for the user
    checkpoint(snap)     the SHORT note that is saved when the job is stopped for a report
    resumeTask(cp,note)  the task text for the new run: the note only, never the old conversation
*/
const fs = require('fs');
const path = require('path');

const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function makeTrail(now = Date.now) {
  const m = new Map();
  const slot = (id, job) => { let t = m.get(id); if (!t || t.jobId !== job.id) { t = { jobId: job.id, task: String(job.task || ''), startedAt: now(), steps: [], text: '', lastAt: now(), bytes: 0, textLen: 0, textBytes: 0, submittedBytes: 0, attempts: 0, sources: [], lastDataAt: 0, samples: [] }; m.set(id, t); } return t; };
  return {
    begin: (id, job) => { m.delete(id); slot(id, job); },
    add(id, job, p) {
      const t = slot(id, job); const what = clip((p && (p.label || p.tool)) || '', 100) + (p && p.status ? ' [' + p.status + ']' : '');
      if (!what.trim()) return; const last = t.steps[t.steps.length - 1]; t.lastAt = now(); if (last && last.what === what) return;
      t.steps.push({ at: now(), what }); if (t.steps.length > 40) t.steps.shift();
    },
    data(id, job, n) { const t = slot(id, job); n = Number(n) || 0; if (n <= 0) return; t.bytes += n; t.lastDataAt = t.lastAt = now(); t.samples.push({ at: t.lastDataAt, b: t.bytes }); if (t.samples.length > 80) t.samples.shift(); },
    transport(id, job, event) {
      if (!event || !['submitted', 'received'].includes(event.kind) || !Number.isSafeInteger(event.bytes) || event.bytes < 0) return;
      const t = slot(id, job);
      const source = ['gemini_http_body', 'hermes_local_api', 'opencode_process_output'].includes(event.source) ? event.source : 'unspecified';
      if (!t.sources.includes(source)) t.sources.push(source);
      if (event.kind === 'submitted') { t.submittedBytes += event.bytes; t.attempts++; t.lastAt = now(); }
      else this.data(id, job, event.bytes);
    },
    say(id, job, s) { const t = slot(id, job); t.text = String(s || '').slice(-1500); t.lastAt = now(); },
    text(id, job, s) { const t = slot(id, job); s = String(s || ''); t.textLen = s.length; t.textBytes = Buffer.byteLength(s); t.text = s.slice(-1500); t.lastAt = now(); },
    snapshot(id, job) { const t = m.get(id); if (!t || (job && t.jobId !== job.id)) return null; return { ...t, steps: t.steps.slice(), sources: t.sources.slice(), samples: t.samples.slice() }; }
  };
}

function recentFiles(dir, since, { limit = 12, maxEntries = 3000, maxDepth = 4 } = {}) {
  const out = []; let seen = 0;
  const walk = (d, depth) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (++seen > maxEntries) return; if (e.name === 'node_modules' || e.name === '.git' || e.name === 'opencode.json' || e.name.toLowerCase() === 'progress.md') continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) walk(f, depth + 1); }
      else { try { const st = fs.statSync(f); if (st.mtimeMs >= since) out.push({ f: path.relative(dir, f), t: st.mtimeMs }); } catch { /* gone */ } }
    }
  };
  walk(dir, 0); return out.sort((a, b) => b.t - a.t).slice(0, limit).map(x => x.f);
}

const mins = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? s + ' s' : Math.round(s / 60) + ' min'; };
const uniq = list => { const seen = new Set(), out = []; for (const x of list) if (!seen.has(x)) { seen.add(x); out.push(x); } return out; };

// How much is written: words and lines of each (text) file, counted on disk. No model is asked.
function measure(dir, names) {
  const out = [];
  for (const f of names || []) {
    try {
      const full = path.join(dir, f), st = fs.statSync(full); const o = { f, bytes: st.size };
      if (st.size <= 2e6) { const t = fs.readFileSync(full, 'utf8'); if (!t.includes('\u0000')) { o.words = (t.match(/\S+/g) || []).length; o.lines = t.split(/\r?\n/).length; } }
      out.push(o);
    } catch { out.push({ f }); }
  }
  return out;
}
// A number in the job ("500 words", "20 lines") is the target; without one nobody can say how much is left.
function targetOf(task) {
  const m = /(\d[\d,]{1,6})\s*(words?|lafz|alfaz|lines?)\b/i.exec(String(task || '')); if (!m) return null;
  return { n: parseInt(m[1].replace(/,/g, ''), 10), unit: /^l[ia]/i.test(m[2]) && !/^lines?$/i.test(m[2]) ? 'words' : /^line/i.test(m[2]) ? 'lines' : 'words' };
}
const asObj = f => (typeof f === 'string' ? { f } : f);
const have = (o, unit) => (unit === 'lines' ? o.lines : o.words);
function progress(snap, files) {
  const t = targetOf(snap.task); const list = (files || []).map(asObj);
  const main = list.filter(o => have(o, t ? t.unit : 'words') != null).sort((a, b) => have(b, t ? t.unit : 'words') - have(a, t ? t.unit : 'words'))[0];
  return { t, list, main };
}


// How fast data is coming in: bytes so far, the speed over the last 20 s, how long since the last data, and what that means.
const kb = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
function meter(snap, now = Date.now()) {
  if (!snap) return '';
  const submitted = `${snap.attempts || 0} request attempt(s), ${kb(snap.submittedBytes || 0)} submitted`;
  const scope = (snap.sources || []).map(s => ({ gemini_http_body: 'Gemini HTTP body', hermes_local_api: 'local Hermes API (not provider traffic)', opencode_process_output: 'OpenCode process output (not network traffic)' })[s] || 'unspecified output').join(', ') || 'telemetry unavailable';
  if (!snap.bytes) return `**Data:** nothing received yet (${mins(now - snap.startedAt)} since the start); ${submitted}. ${scope}. No packet measurement; silence does not prove a stuck job.`;
  const recent = snap.samples.filter(x => now - x.at <= 20000); let rate = 0;
  if (recent.length > 1) { const span = (recent[recent.length - 1].at - recent[0].at) / 1000; if (span >= 1) rate = (recent[recent.length - 1].b - recent[0].b) / span; }
  const quiet = Math.round((now - snap.lastDataAt) / 1000);
  const state = quiet < 15 ? 'recent output' : quiet < 90 ? 'quiet' : 'no recent observed output; worker state unknown';
  return `**Data:** ${kb(snap.bytes)} so far, ${rate >= 1 ? kb(Math.round(rate)) + '/s' : 'no flow'} over the last 20 s, last data ${quiet} s ago (${state}); ${submitted}. Source: ${scope}. Application bytes only; no packet measurement.`;
}

// The agent's own checklist (PROGRESS.md in its workspace): [x] done, [ ] still to do.
function readPlan(dir, now = Date.now()) {
  try {
    const name = fs.readdirSync(dir).find(n => n.toLowerCase() === 'progress.md'); if (!name) return null;
    const full = path.join(dir, name), text = fs.readFileSync(full, 'utf8').slice(0, 20000), st = fs.statSync(full);
    const done = (text.match(/^\s*(?:[-*]|\d+[.)])\s*\[[xX]\]/gm) || []).length;
    const todo = (text.match(/^\s*(?:[-*]|\d+[.)])\s*\[ \]\s*(.+)$/gm) || []).map(l => clip(l.replace(/^\s*(?:[-*]|\d+[.)])\s*\[ \]\s*/, ''), 90));
    if (!done && !todo.length) return null;
    return { done, total: done + todo.length, todo: todo.slice(0, 8), more: Math.max(0, todo.length - 8), ageMs: Math.max(0, now - st.mtimeMs) };
  } catch { return null; }
}
const progressNote = () => '\n\n[Orbit house rule: if this job has several steps, keep a short checklist of your plan in PROGRESS.md in your workspace. Write it first, change "[ ]" to "[x]" after each finished item, never delete the file, keep it short.]';

// "4 files", "each", "har file": the number in the job is per file, so the total left cannot be counted from it.
const several = task => /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(files?|documents?|pages?|notes?)\b|\beach\b|\bevery\b|\bper file\b|\bhar\b|\bsab\b/i.test(String(task || ''));
// A to-do line that names a file which already exists (the agent has not ticked it yet): say so.
const withFile = (item, list) => { const o = list.map(asObj).find(x => x.f && item.toLowerCase().includes(String(x.f).toLowerCase())); return o ? item + ' \u2014 file already exists' + (o.words != null ? ` (${o.words} words)` : '') : item; };

function format(snap, { name = 'The agent', files = [], plan = null, now = Date.now() } = {}) {
  const { t, list, main } = progress(snap, files);
  const lines = [`**${name}** stopped after ${mins(now - snap.startedAt)}.`, ''];
  if (list.length) {
    lines.push('**Written so far:**');
    for (const o of list) lines.push('- ' + o.f + (o.words != null ? `: ${o.words} words, ${o.lines} lines` : ''));
    lines.push('');
  } else lines.push('**Written so far:** no file changed yet.', '');
  if (plan) {
    lines.push(`**Plan (PROGRESS.md):** ${plan.done} of ${plan.total} done.` + (plan.todo.length ? ' Still to do:' : ' Nothing left on the list.'));
    for (const x of plan.todo) lines.push('- ' + withFile(x, list)); if (plan.more) lines.push(`- \u2026and ${plan.more} more`);
    if (plan.ageMs > 120000 && snap.lastDataAt && plan.ageMs - (Date.now() - snap.lastDataAt) > 120000) lines.push('(The list was last updated ' + mins(plan.ageMs) + ' ago, so it may be behind.)');
    lines.push('');
  }
  if (t && several(snap.task)) {
    lines.push(`**Target:** ${t.n} ${t.unit} per file. The job covers several files, so the total left cannot be counted from the numbers` + (plan ? ' (the plan above says what is left).' : '.'));
  } else if (t && main) {
    const got = have(main, t.unit), left = Math.max(0, t.n - got);
    lines.push(left ? `**Pending:** about ${left} more ${t.unit} (${got} of ${t.n}, ${Math.round(100 * got / t.n)}%).` : `**Pending:** nothing by the numbers (${got} of ${t.n} ${t.unit} done).`);
  } else if (t) lines.push(`**Pending:** the whole ${t.n} ${t.unit}, nothing written yet.`);
  else if (!plan) lines.push('**Pending:** the job has no number in it, so I cannot count what is left. Tell me and I will ask the model for a list (small cost).');
  lines.push('', meter(snap, now));
  const steps = uniq(snap.steps.map(s => s.what)).slice(-4);
  if (steps.length) lines.push('', 'Last steps: ' + steps.join(' → '));
  if (snap.text) lines.push('', 'Its last words: ' + clip(snap.text.slice(-300), 300));
  return lines.join('\n');
}

function checkpoint(snap, { files = [], plan = null, now = Date.now() } = {}) {
  const { t, main } = progress(snap, files);
  return { jobId: snap.jobId, task: String(snap.task || ''), steps: uniq(snap.steps.map(s => s.what)).slice(-12), files: files.map(asObj).slice(0, 12), target: t, doneIn: main ? { f: main.f, n: have(main, t ? t.unit : 'words'), unit: t ? t.unit : 'words' } : null, plan: plan ? { done: plan.done, total: plan.total, todo: plan.todo } : null, tail: clip(snap.text.slice(-600), 600), savedAt: new Date(now).toISOString() };
}

function resumeTask(cp, note) {
  const parts = ['Continue a job that was stopped half way. Do NOT start over and do not rewrite finished work.', 'The original job: ' + cp.task];
  if (cp.doneIn) {
    let s = `${cp.doneIn.f} already has ${cp.doneIn.n} ${cp.doneIn.unit}.`;
    if (cp.target) { const left = Math.max(0, cp.target.n - cp.doneIn.n); s += left ? ` The target is ${cp.target.n}: read the end of the file, keep everything in it, and add about ${left} more ${cp.target.unit} after it.` : ` The target of ${cp.target.n} is already reached: only check and finish.`; }
    parts.push(s);
  }
  if (cp.plan && cp.plan.todo.length) parts.push(`Your own checklist (PROGRESS.md) says ${cp.plan.done} of ${cp.plan.total} are done. Still to do:\n` + cp.plan.todo.map(x => '- ' + x).join('\n'));
  if (cp.steps && cp.steps.length) parts.push('Steps already done (from the log):\n' + cp.steps.map(s => '- ' + s).join('\n'));
  if (cp.files && cp.files.length) parts.push('Files it had already changed:\n' + cp.files.map(o => '- ' + (typeof o === 'string' ? o : o.f)).join('\n'));
  if (cp.tail) parts.push('Its last words before it was stopped: ' + cp.tail);
  parts.push('First look at your workspace to see what already exists, then do only what is still missing, and finish with your report.');
  if (note && String(note).trim()) parts.push('New instruction from the user: ' + String(note).trim());
  return parts.join('\n\n');
}

const file = (dir, id) => path.join(dir, String(id).replace(/[^\w-]/g, '_') + '.json');
const save = (dir, id, cp) => { fs.mkdirSync(dir, { recursive: true }); require('./job-storage').atomicWrite(file(dir, id), cp); };
const load = (dir, id) => { try { return JSON.parse(fs.readFileSync(file(dir, id), 'utf8')); } catch { return null; } };
const clear = (dir, id) => { try { fs.unlinkSync(file(dir, id)); } catch { /* none */ } };

// Notifications are a bounded untrusted report projection, never an acceptance verdict.
function completionReport(agent, job) {
  const result=String(job.result||''), truncated=result.length>3000;
  const excerpt=truncated?result.slice(0,1500)+'\n[Report middle omitted; call get_job before assessing completion.]\n'+result.slice(-1500):result;
  const reviewReady=job.status==='review', ok=reviewReady||job.status==='done';
  const secs=job.startedAt&&job.finishedAt?Math.max(0,Math.round((Date.parse(job.finishedAt)-Date.parse(job.startedAt))/1000)):null;
  const state=reviewReady?'submitted an unaccepted report for human review':ok?'has a stored completion record':'failed';
  const text=`[CREW REPORT] ${agent.name} ${state} for job ${job.id}${secs!=null?` after ${secs} seconds`:''}. Task: "${String(job.task||'').slice(0,1000)}". ${ok?'Worker-reported result (untrusted): '+excerpt:'Observed error: '+job.error}\nPreserve reported risks, placeholder content and missing checks. Worker claims and file presence do not prove correctness, browser delivery or independent QA. ${reviewReady?'Open Office to inspect and accept or reject; do not announce verified completion.':ok?'Inspect completionKind and verification with get_job before stating acceptance or correctness.':'Do not infer provider/native-engine root cause from this error alone.'}`;
  return {text,agent:agent.name,ok,secs,reviewReady,reportTruncated:truncated};
}

module.exports = { makeTrail, recentFiles, measure, targetOf, meter, readPlan, progressNote, format, checkpoint, resumeTask, save, load, clear, completionReport };
