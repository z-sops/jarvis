'use strict';
// Crew agents: each job runs in the background, using only that agent's brain, skills and tools.
// One agent does one job at a time; the rest wait in a queue. A job can be cancelled while it runs or while it waits.
const { buildAgentPrompt } = require('./persona');
const cp = require('./checkpoint');
const tg = require('./tags');
const an = require('./anomaly');
const ju = require('./jobundo');
const jr = require('./jobreport');

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('Cancelled by the user.')); }, { once: true });
});
// A per-minute quota (input tokens or requests per minute) clears by itself within about a minute. A daily quota does not.
// Times every step of a job: how long since the last step and since the job began. Only reports; never changes how the job runs.
const stepTimer = (bus, agent, job, now = Date.now) => {
  const t0 = now(); let last = t0, n = 0;
  return info => { const t = now(); n++; const e = { agent, job, n, sinceLastMs: t - last, totalMs: t - t0, what: info ? String(info).slice(0, 80) : '' }; last = t; try { bus.emit('job:step', e); } catch { /* a listener must never break a job */ } return e; };
};
const minuteQuota = msg => /RESOURCE_EXHAUSTED|\b429\b|quota/i.test(msg) && /input_token_count|per.?minute|tokens per minute/i.test(msg) && !/per.?day|daily/i.test(msg);

function createWorkers({ home, getCfg, gemini, tools, bus, hermes, usage, opencode }) {
  const states = new Map();      // agentId -> { state: 'idle'|'working', task, jobId }
  const queues = new Map();      // agentId -> promise chain, so one agent does one job at a time
  const active = new Map();      // agentId -> { job, ctl } for the job that is running now
  const waiting = new Map();     // agentId -> Set of ids of jobs that are queued
  const skip = new Set();        // ids of queued jobs that were cancelled: run() must not start them
  const stateOf = id => states.get(id) || { state: 'idle' };
  const trail = jr.makeTrail();   // what each running job did so far (for /name report)
  const setState = (id, s) => { states.set(id, s); bus.emit('agent:state', { id, ...s }); };
  const finishCancelled = (agent, job) => {
    const j = home.updateJob(agent.id, job.id, { status: 'cancelled', finishedAt: new Date().toISOString(), error: 'Cancelled by the user.' });
    bus.emit('job:done', { agent, job: j });
  };

  async function run(agent, job) {
    const cfg = getCfg();
    // A per-agent override (set from that agent's own card in the office) wins over the crew default.
    // Blank/missing fields on the agent still fall back to the shared Settings > Crew engine values.
    const engine = agent.engine || cfg.engine;
    const cfgOverride = agent.engine ? {
      workerProvider: agent.workerProvider || cfg.workerProvider, workerModel: agent.workerModel || cfg.workerModel,
      workerApiKey: agent.workerApiKey || cfg.workerApiKey, workerBaseUrl: agent.workerBaseUrl || cfg.workerBaseUrl,
      workerContext: agent.workerContext || cfg.workerContext
    } : undefined;
    const wait = waiting.get(agent.id); if (wait) wait.delete(job.id);
    if (skip.delete(job.id)) return;                                 // it was cancelled while it was still waiting (already reported)
    const ctl = new AbortController(); active.set(agent.id, { job, ctl });
    setState(agent.id, { state: 'working', task: job.task, jobId: job.id });
    home.updateJob(agent.id, job.id, { status: 'running', startedAt: new Date().toISOString() });
    trail.begin(agent.id, job); const stepAt = stepTimer(bus, agent, job); ju.begin(home, agent.id, job.id, job.task); ju.snapDir(home, agent.id, home.p("workspace", agent.id));
    const progress = p => { trail.add(agent.id, job, p); stepAt((p.label || p.tool || '') + (p.status ? ' [' + p.status + ']' : '')); bus.emit('job:progress', { agent, job, ...p }); if (p.status === 'running') setState(agent.id, { state: 'working', task: p.label || p.tool, jobId: job.id }); };
    try {
      let text;
      const nonBuiltin = (engine === 'hermes' && hermes) || (engine === 'opencode' && opencode); if (nonBuiltin) ju.note(home, agent.id, 'external_engine');
      const seenNotes = tg.peek(home, agent.id, 5).map(t => t.id);                 // the notes this job is shown
      const taskForEngine = nonBuiltin ? tg.wrapTask(home, agent, job.task) + jr.progressNote() : job.task;   // Hermes/OpenCode get the notes inside the task
      if (engine === 'hermes' && hermes) {
        home.updateJob(agent.id, job.id, { engine: 'hermes' });
        const once = () => {
          const started = Date.now(), model = (cfgOverride && cfgOverride.workerModel) || cfg.workerModel || cfg.textModel;
          return hermes.runTask(agent, taskForEngine, { signal: ctl.signal, onProgress: progress, cfgOverride, onText: t => trail.text(agent.id, job, t),
            onUsage: u => { if (usage && u) usage.add({ source: 'hermes', model, agentId: agent.id, inTok: u.prompt_tokens, outTok: u.completion_tokens, run: true, startedAt: started }); } });
        };
        try { text = await once(); }
        catch (e) {
          // The free tier allows only so many tokens a minute. Wait for the minute to pass and go again, once.
          if (ctl.signal.aborted || !minuteQuota(String(e.message))) throw e;
          const ms = cfg.quotaWaitMs != null ? cfg.quotaWaitMs : 65000;
          progress({ tool: 'gemini', label: `waiting ${Math.round(ms / 1000)}s for the per-minute quota`, status: 'running' });
          await sleep(ms, ctl.signal); text = await once();
        }
      } else if (engine === 'opencode' && opencode) {
        home.updateJob(agent.id, job.id, { engine: 'opencode' });
        if (typeof opencode.preflight === 'function') { const pf = await opencode.preflight(cfgOverride); if (!pf.ok) throw new Error(pf.error); }   // not ready: fail now with a clear message
        text = await opencode.runTask(agent, taskForEngine, { signal: ctl.signal, onProgress: progress, cfgOverride, onData: n => trail.data(agent.id, job, n), onText: t => trail.say(agent.id, job, t) });
      } else {
        const shownTags = tg.peek(home, agent.id, 5).map(t => t.id);   // the notes this job is shown
        const card = cp.createCard(job.task);
        const loop = (contents, model) => gemini.runLoop({
          model, onStep: s => { stepAt(s && (s.name || s.tool || s.kind || s.type)); cp.update(home, agent.id, job.id, card, s); an.check({ home, bus, agent, job, card, ctl }); },
          cfg,
          system: buildAgentPrompt(cfg, home, agent),
          contents, // the whole task, or a short saved summary when continuing after a model problem
          tools: tools.declarationsFor(agent.id),
          exec: (n, a) => { ju.note(home, agent.id, n); return tools.exec(n, a, agent.id); },
          agentId: agent.id,
          maxSteps: 14,
          shouldStop: () => ctl.signal.aborted,
          onRetry: r => bus.emit('job:progress', { agent, job, tool: 'gemini', label: r.fallback ? 'busy, switching to ' + r.fallback : 'busy (' + r.status + '), retry ' + r.attempt + '/' + r.of + ' in ' + Math.round(r.waitMs / 1000) + 's', status: 'running' })
        });
        try { ({ text } = await loop([{ role: 'user', parts: [{ text: job.task }] }])); }
        catch (e) {
          // A temporary model problem in the middle of a job: continue from the short saved card, not the whole conversation.
          if (ctl.signal.aborted || !card.stepCount || !cp.isTransient(e)) throw e;
          progress({ tool: 'checkpoint', label: 'continuing from a short saved summary (' + card.stepCount + ' steps done)', status: 'running' });
          await sleep(2000, ctl.signal);
          ({ text } = await loop([{ role: 'user', parts: [{ text: cp.resumeText(card) }] }], cfg.textFallbackModel || undefined));
        }
        cp.finish(home, agent.id, job.id);
        tg.markRead(home, agent.id, shownTags);
      }
      if (ctl.signal.aborted) throw ctl.signal.reason || new Error('Cancelled by the user.');
      if (nonBuiltin) text = tg.collectFromReport(home, bus, getCfg(), agent, text, seenNotes);   // NOTE lines in the report become notes
      const done = home.updateJob(agent.id, job.id, { status: 'done', finishedAt: new Date().toISOString(), result: text });
      home.appendMemory(agent.id, `Finished: ${job.task.slice(0, 100)} → ${text.slice(0, 160)}`);
      setState(agent.id, { state: 'idle' });
      bus.emit('job:done', { agent, job: done });
    } catch (e) {
      const cancelled = ctl.signal.aborted;
      const byRule = cancelled && ctl.signal.reason && ctl.signal.reason.anomaly ? ctl.signal.reason : null;   // stopped by an anomaly rule, not by the user
      const failed = home.updateJob(agent.id, job.id, { status: cancelled && !byRule ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(), error: byRule ? byRule.message : cancelled ? 'Cancelled by the user.' : e.message });
      setState(agent.id, { state: 'idle' });
      bus.emit('job:done', { agent, job: failed });
    } finally { active.delete(agent.id); ju.diffDir(home, agent.id); ju.end(agent.id); }
  }

  function dispatch(agentId, task) {
    const agent = home.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent ${agentId}`);
    const job = home.createJob(agent.id, task);
    const queuedBehind = (active.has(agent.id) ? 1 : 0) + (waiting.get(agent.id) ? waiting.get(agent.id).size : 0);
    if (!waiting.has(agent.id)) waiting.set(agent.id, new Set());
    waiting.get(agent.id).add(job.id);
    bus.emit('job:created', { agent, job });
    const prev = queues.get(agent.id) || Promise.resolve();
    queues.set(agent.id, prev.then(() => run(agent, job)).catch(() => {}));
    job.queuedBehind = queuedBehind;                                  // not saved to disk, only for the caller
    return job;
  }

  // Stops the job that is running now and every job waiting behind it. Returns how many were stopped.
  function cancel(agentId) {
    const agent = home.getAgent(agentId); if (!agent) return 0;
    let n = 0; const a = active.get(agent.id);
    if (a) { a.ctl.abort(new Error('Cancelled by the user.')); n++; }
    for (const id of [...(waiting.get(agent.id) || [])]) {
      const j = home.findJob(id); if (!j) continue;
      waiting.get(agent.id).delete(id); n++;
      skip.add(id); finishCancelled(agent, j);                       // shown as cancelled at once; run() will skip it
    }
    return n;
  }

  // The Stop button: cancel every agent's running and waiting jobs. Returns how many were stopped.
  const cancelAll = () => home.listAgents().reduce((n, a) => n + cancel(a.id), 0);

  const resumeDir = () => home.p('resume');
  const firstName = a => String(a.name || a.id).split(/\s+/)[0].toLowerCase();
  const savedNote = agent => { const s = jr.load(resumeDir(), agent.id); return s ? String(s.task || '').replace(/\s+/g, ' ').slice(0, 70) : ''; };

  // /name report: stop now, say what was done (no model call), keep a SHORT note for /name continue.
  function pauseForReport(agentId) {
    const agent = home.getAgent(agentId); if (!agent) return { ok: false, text: 'Unknown agent.' };
    const a = active.get(agent.id);
    if (!a) return { ok: true, working: false, text: agent.name + ' is not working on anything now.' + (savedNote(agent) ? ' An older stopped job is still saved ("' + savedNote(agent) + '"): /' + firstName(agent) + ' continue carries it on.' : '') };
    const snap = trail.snapshot(agent.id, a.job) || { jobId: a.job.id, task: a.job.task, startedAt: Date.now(), steps: [], text: '' };
    const wdir = home.p('workspace', agent.id); let plan = jr.readPlan(wdir); const planOld = !!(plan && plan.ageMs > Date.now() - (snap.startedAt - 2000)); if (planOld) plan = null; const files = jr.measure(wdir, jr.recentFiles(wdir, snap.startedAt - 2000));
    jr.save(resumeDir(), agent.id, jr.checkpoint(snap, { files, plan }));
    const n = cancel(agent.id);
    return { ok: true, working: true, text: jr.format(snap, { name: agent.name, files, plan }) + (planOld ? '\nPlan: this job has not written PROGRESS.md yet (the file there is from an older job, so it is not counted).' : '') + '\n' + (n > 1 ? (n - 1) + ' waiting job(s) were stopped too. ' : '') + 'A short note is saved: /' + firstName(agent) + ' continue carries on from it without reading everything again.' };
  }
  // /name continue [new instruction]: a new run that starts from the short note only.
  function resumeJob(agentId, note) {
    const agent = home.getAgent(agentId); if (!agent) return { ok: false, text: 'Unknown agent.' };
    const saved = jr.load(resumeDir(), agent.id);
    if (!saved) return { ok: false, text: 'Nothing is saved to continue for ' + agent.name + '. Give a new job with /' + firstName(agent) + ' <job>.' };
    const job = dispatch(agent.id, jr.resumeTask(saved, note)); jr.clear(resumeDir(), agent.id);
    return { ok: true, job, text: agent.name + ' goes on from the short note (' + job.id + ').' + (job.queuedBehind ? ' It waits behind ' + job.queuedBehind + ' other job(s).' : '') };
  }
  async function healthCheck(agentId) {
    const agent = home.getAgent(agentId); if (!agent) return { ok: false, text: 'Unknown agent.' };
    const cfg = getCfg(), engine = agent.engine || cfg.engine;
    const ov = agent.engine ? { workerProvider: agent.workerProvider || cfg.workerProvider, workerModel: agent.workerModel || cfg.workerModel, workerApiKey: agent.workerApiKey || cfg.workerApiKey, workerBaseUrl: agent.workerBaseUrl || cfg.workerBaseUrl, workerContext: agent.workerContext || cfg.workerContext } : undefined;
    const a = active.get(agent.id), live = a ? jr.meter(trail.snapshot(agent.id, a.job)) : '';
    const lines = ['**' + agent.name + '** (' + (engine || 'builtin') + ' engine, ' + (a ? 'working now' : 'idle') + ')', ''];
    try {
      if (engine === 'opencode' && opencode) {
        const pf = await opencode.preflight(ov); lines.push('- ' + (pf.ok ? 'OK: ' : 'FAIL: ') + 'OpenCode installed, model and key set' + (pf.ok ? '' : ' (' + pf.error + ')'));
        if (pf.ok) { const pr = await opencode.probe(ov); lines.push('- ' + (pr.ok ? 'OK: ' : 'FAIL: ') + 'the model answers' + (pr.ok ? ' (' + pr.ms + ' ms)' : ' (' + pr.error + ')')); }
      } else if (engine === 'hermes' && hermes && hermes.check) {
        const res = await hermes.check({ smoke: true }); const steps = Array.isArray(res) ? res : (res && res.steps) || [];
        for (const s of steps) lines.push('- ' + (s.ok ? 'OK: ' : 'FAIL: ') + s.name + (s.detail ? ' (' + s.detail + ')' : ''));
      } else lines.push('- This agent uses the built-in engine (Gemini directly): nothing separate to check.');
    } catch (e) { lines.push('- FAIL: the check itself broke: ' + ((e && e.message) || e)); }
    if (live) lines.push('', live);
    return { ok: true, text: lines.join('\n') };
  }
  return { run, dispatch, cancel, cancelAll, stateOf, states, pauseForReport, resumeJob, healthCheck };   // run: one job, right now (dispatch queues it)
}

module.exports = { createWorkers, minuteQuota, stepTimer };
