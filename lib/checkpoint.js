'use strict';
/*
  Checkpoints: a short, structured card per job, saved to disk after every step.
  The card is built by plain code from what really happened (no model call, no extra cost).
  If the model fails in the middle of a job, the job continues from the card (a few hundred tokens)
  instead of sending the whole conversation (many thousand tokens) to the next model.
  Everything here is best-effort: a problem with a checkpoint never stops a job.
*/
const fs = require('fs');
const path = require('path');

const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s == null ? '' : (s.length > n ? s.slice(0, n) + '…' : s); };
const PATH_TOOLS = new Set(['write_file', 'read_file', 'read_image', 'list_dir', 'give_file']);

const createCard = goal => ({ goal: String(goal || ''), steps: [], files: [], lastResult: '', lastSaid: '', updatedAt: null });

// Rebuild the card from the conversation so far. Pure: same convo, same card.
function fromConvo(card, convo) {
  const steps = []; const files = []; let lastResult = '', lastSaid = '';
  const pending = [];
  for (const m of convo || []) {
    const parts = (m && m.parts) || [];
    if (m && m.role === 'model') {
      for (const p of parts) {
        if (p.functionCall) {
          const a = p.functionCall.args || {};
          const brief = {}; for (const [k, v] of Object.entries(a)) brief[k] = k === 'content' ? `(${String(v).length} chars)` : clip(v, 100);
          const s = { tool: p.functionCall.name, args: brief, ok: null }; steps.push(s); pending.push(s);
          if (PATH_TOOLS.has(p.functionCall.name) && typeof a.path === 'string' && !files.includes(a.path)) files.push(a.path);
        } else if (p.text && !p.thought) lastSaid = p.text;
      }
    } else if (m && m.role === 'user') {
      for (const p of parts) {
        if (!p.functionResponse) continue;
        const r = p.functionResponse.response && p.functionResponse.response.result;
        const name = p.functionResponse.name, index = name ? pending.findIndex(s => s.tool === name) : 0;
        const s = index >= 0 ? pending.splice(index, 1)[0] : null;
        if (s) s.ok = !(r && typeof r === 'object' && (r.error || r.ok === false || r.isError === true || (typeof r.exitCode === 'number' && r.exitCode !== 0)));
        lastResult = clip(r, 700);
      }
    }
  }
  card.steps = steps.slice(-12); card.stepCount = steps.length;
  card.files = files.slice(-10); card.lastResult = lastResult; card.lastSaid = clip(lastSaid, 300);
  card.updatedAt = new Date().toISOString();
  return card;
}

function file(home, jobId) { return home.p('checkpoints', String(jobId) + '.json'); }

// Called after every step. Never throws.
function update(home, agentId, jobId, card, { convo } = {}) {
  try {
    fromConvo(card, convo);
    card.agentId = agentId; card.jobId = jobId;
    const f = file(home, jobId); fs.mkdirSync(path.dirname(f), { recursive: true });
    require('./job-storage').atomicWrite(f, card);
  } catch { /* a checkpoint problem must never stop the job */ }
}

function finish(home, agentId, jobId) { try { fs.unlinkSync(file(home, jobId)); } catch { /* nothing to remove */ } }

function load(home, jobId) { try { return JSON.parse(fs.readFileSync(file(home, jobId), 'utf8')); } catch { return null; } }

// The only context the next model gets.
function resumeText(card) {
  const lines = [
    'You are continuing a job that was interrupted by a model problem. You have a short summary, not new authorization. Never transfer approvals from an old run. Unknown/pending tool outcomes must be inspected before any repeat; successful tools do not prove that the whole job is complete.',
    'JOB: ' + card.goal,
    `DONE SO FAR (${card.stepCount || card.steps.length} steps, most recent last):`,
    ...card.steps.map((s, i) => `  - ${s.tool}(${clip(s.args, 140)}) ${s.ok === false ? 'FAILED' : s.ok ? 'ok' : '?'}`)
  ];
  if (card.files.length) lines.push('FILES TOUCHED: ' + card.files.join(', '));
  if (card.lastResult) lines.push('LAST TOOL RESULT: ' + card.lastResult);
  if (card.lastSaid) lines.push('YOU LAST SAID: ' + card.lastSaid);
  lines.push('Continue from here and finish the job. If you need the content of a file, read it again instead of guessing.');
  return lines.join('\n');
}

// Worth continuing from a card? Only for temporary model/network trouble, never for a used-up daily quota.
function isTransient(e, msg) {
  const m = msg != null ? msg : String((e && e.message) || e || '');
  if (e && e.quotaDaily) return false;
  if (e && [429, 500, 502, 503, 504].includes(e.status)) return true;
  return /Gemini (429|5\d\d)|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network|socket hang up/i.test(m);
}

module.exports = { createCard, fromConvo, update, finish, load, resumeText, isTransient };
