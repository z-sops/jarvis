'use strict';
/*
  Decision layer ("System 1"): small, fast, typed decisions made BEFORE the big model starts working.
  Each decision asks one closed question and gets one answer from a fixed list (Gemini structured output),
  never free text. Plain code rules always go first; the model only fills in what rules cannot know.
  Every path fails open: if anything is slow, down or confusing, no decision is returned and nothing changes.
  A failure pauses the model step for a minute (circuit breaker) so a broken classifier can never slow every message.
*/
const ESC = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DELEGATE_WORDS = /\b(crew|team|assign|delegate|handoff|hand over|handover|karwa\w*|agents?)\b/i;
const ROUTES = ['self', 'crew', 'ask'];
const COMPLEXITY = ['simple', 'complex'];

const SYSTEM = [
  'You are a fast triage classifier inside a desktop assistant. You never answer the user. You only classify their latest message.',
  'route:',
  '- self: the assistant can do it directly: conversation, questions, explaining, a quick lookup, reading or describing a file or image, a simple one-step action.',
  '- crew: real specialist work that belongs to a crew member: writing or fixing code, building something, running tests, a long multi-step job.',
  '- ask: too vague or missing a detail, so the assistant must ask the user first.',
  'urgency: 0 (no rush) to 5 (the user is clearly in a hurry or something is broken).',
  'complexity: simple (short answer or one small action) or complex (several steps or careful reasoning).',
  'confidence: 0 to 1, how sure you are of the route.',
  'A short follow-up such as "again", "same job" or "do it once more" refers to the previous assistant reply, shown for context.'
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    route: { type: 'STRING', enum: ROUTES },
    urgency: { type: 'INTEGER' },
    complexity: { type: 'STRING', enum: COMPLEXITY },
    confidence: { type: 'NUMBER' }
  },
  required: ['route', 'urgency', 'complexity', 'confidence']
};

function createDecider({ getCfg, gemini, timeoutMs = 4000, attemptMs = 3500, pauseMs = 20000, log = (...a) => console.log(...a) } = {}) {
  let pick = null;        // the model that last worked for decisions
  let thinkOk;            // undefined = unknown, true = thinkingBudget:0 accepted, false = send without it
  let lastErr = '';       // why the last attempt failed, shown in the chat
  let pausedUntil = 0;    // circuit breaker

  // routerModel if set, else a "-lite" sibling of the text model, else the text model itself.
  const candidates = cfg => {
    const out = [];
    if (pick) out.push(pick);
    if (cfg.routerModel) out.push(cfg.routerModel);
    const base = String(cfg.textModel || '');
    if (/flash$/.test(base)) out.push(base + '-lite');
    if (base) out.push(base);
    return [...new Set(out)];
  };

  const makeBody = (prompt, thinkOff) => ({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: Object.assign(
      { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json', responseSchema: SCHEMA },
      thinkOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}
    )
  });

  async function classify(cfg, prompt) {
    lastErr = '';
    const quick = { ...cfg, geminiRetryDelays: [], geminiNoFallback: true }; // a decision must never wait in a retry queue
    const start = Date.now(); let attempts = 0;
    for (const model of candidates(cfg)) {
      for (const think of (thinkOk === false ? [false] : [true, false])) {
        if (attempts++ >= 3 || Date.now() - start > timeoutMs) return null;
        const t0 = Date.now(), deadline = t0 + attemptMs;
        try {
          // shouldStop aborts the request itself when the attempt runs out of time, so nothing keeps running in the background
          const resp = await gemini.generate(quick, makeBody(prompt, think), model, undefined, () => Date.now() > deadline);
          const parts = (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || [];
          const j = JSON.parse(parts.map(p => p.text || '').join(''));
          pick = model; thinkOk = think;
          log(`[decide] ${model} ${think ? 'think-off' : 'plain'} ok ${Date.now() - t0}ms`);
          return { j, model, usage: resp.usageMetadata || null };
        } catch (e) {
          const ms = Date.now() - t0;
          lastErr = e && e.stopped ? `no answer after ${ms}ms [${model}]`
            : ((e && e.status ? e.status + ' ' : '') + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 110) + ' [' + model + ']');
          log(`[decide] ${model} ${think ? 'think-off' : 'plain'} FAILED ${ms}ms: ${lastErr}`);
          if (model === pick) pick = null;
          if (e && (e.status === 429 || e.stopped)) return null;                 // out of quota: stop, never hammer it
          if (e && e.status === 400 && think) { thinkOk = false; continue; } // maybe thinkingConfig is not accepted: retry without it
          break;                                                  // slow, missing or unusable model: next candidate
        }
      }
    }
    return null;
  }

  // The lighter model, only when we know one that works and it differs from the main one.
  const liteModel = cfg => (pick && pick !== cfg.textModel ? pick : undefined);

  const fail = (why, ms) => ({ route: 'none', urgency: null, complexity: 'complex', confidence: 0, by: 'none', why, ms });

  async function routeMessage(text, { crewNames = [], recent = '', cfg } = {}) {
    cfg = cfg || (getCfg && getCfg()) || {};
    const t = String(text || '').trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    // 1. Plain rules first. Naming a crew member, or asking to delegate, always keeps delegation open.
    const named = crewNames.find(n => n && new RegExp('(^|[^a-z0-9])' + ESC(String(n).toLowerCase()) + '([^a-z0-9]|$)').test(lower));
    if (named) return { route: 'crew', urgency: null, complexity: 'complex', confidence: 1, by: 'rule', why: `names ${named}`, ms: 0 };
    if (DELEGATE_WORDS.test(t)) return { route: 'crew', urgency: null, complexity: 'complex', confidence: 1, by: 'rule', why: 'asks to delegate', ms: 0 };
    // 2. A recent failure pauses the model step, so a broken classifier does not slow every message.
    if (!cfg.modelDecision) return null;   // the model step is opt-in; rules above always run
    if (Date.now() < pausedUntil) return fail(`paused ${Math.ceil((pausedUntil - Date.now()) / 1000)}s after: ${lastErr}`, 0);
    // 3. Otherwise a fast typed decision from a small model.
    const prompt = (recent ? `Previous assistant reply (context only):\n${String(recent).slice(0, 300)}\n\n` : '') + `User message:\n${t.slice(0, 1200)}`;
    const t0 = Date.now();
    let timer; const timeout = new Promise(res => { timer = setTimeout(() => res(null), timeoutMs + 500); });
    let r; try { r = await Promise.race([classify(cfg, prompt), timeout]); } finally { clearTimeout(timer); }
    if (!r || !r.j || !ROUTES.includes(r.j.route)) {
      pausedUntil = Date.now() + pauseMs;
      return fail(!r ? (lastErr || 'no answer in time') : 'unusable answer', Date.now() - t0);
    }
    pausedUntil = 0;
    const conf = Number(r.j.confidence); const urg = Math.max(0, Math.min(5, Math.round(Number(r.j.urgency)) || 0));
    return {
      route: r.j.route, urgency: urg, complexity: COMPLEXITY.includes(r.j.complexity) ? r.j.complexity : 'complex',
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
      by: 'model', model: r.model, liteModel: liteModel(cfg), ms: Date.now() - t0,
      tokens: r.usage ? (r.usage.promptTokenCount || 0) + (r.usage.candidatesTokenCount || 0) : null
    };
  }

  return { routeMessage, liteModel, _candidates: candidates };
}

module.exports = { createDecider, ROUTES, COMPLEXITY, SCHEMA };
