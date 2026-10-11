'use strict';
// Crew agents: each job runs in the background, using only that agent's brain, skills and tools.
// One agent does one job at a time; the rest wait in a queue. A job can be cancelled while it runs or while it waits.
const { buildAgentPrompt } = require('./persona');
const cp = require('./checkpoint');
const tg = require('./tags');
const an = require('./anomaly');
const ju = require('./jobundo');
const jr = require('./jobreport');
const { createJobRuns } = require('./job-runs');
const review = require('./job-review');
const contracts = require('./job-contract');
const { outcomePatch } = require('./job-outcomes');

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  let t;
  const abort = () => { clearTimeout(t); signal.removeEventListener('abort', abort); reject(signal.reason || new Error('Cancelled by the user.')); };
  if (signal?.aborted) return abort();
  t = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  if (signal) signal.addEventListener('abort', abort, { once: true });
});
// A per-minute quota (input tokens or requests per minute) clears by itself within about a minute. A daily quota does not.
// Times every step of a job: how long since the last step and since the job began. Only reports; never changes how the job runs.
const stepTimer = (bus, agent, job, now = Date.now) => {
  const t0 = now(); let last = t0, n = 0;
  return info => { const t = now(); n++; const e = { agent, job, n, sinceLastMs: t - last, totalMs: t - t0, what: info ? String(info).slice(0, 80) : '' }; last = t; try { bus.emit('job:step', e); } catch { /* a listener must never break a job */ } return e; };
};
const minuteQuota = msg => /RESOURCE_EXHAUSTED|\b429\b|quota/i.test(msg) && /input_token_count|per.?minute|tokens per minute/i.test(msg) && !/per.?day|daily/i.test(msg);

function createWorkers({ askNative, home, getCfg, gemini, tools, bus, hermes, usage, opencode, getGuidance = () => null, runs = createJobRuns(), jobTimeoutMs = null, getPlanner = () => null, getNativeGateway = () => null }) {
  const emit = (name, payload) => { try { bus.emit(name, payload); } catch { /* UI/audit listeners cannot corrupt job settlement */ } };
  const states = new Map();      // agentId -> { state: 'idle'|'working', task, jobId }
  const queues = new Map();      // agentId -> promise chain, so one agent does one job at a time
  const active = new Map();      // agentId -> { job, ctl } for the job that is running now
  const waiting = new Map();     // agentId -> Set of ids of jobs that are queued
  const skip = new Set();        // ids of queued jobs that were cancelled: run() must not start them
  const stateOf = id => states.get(id) || { state: 'idle' };
  const trail = jr.makeTrail();   // what each running job did so far (for /name report)
  const activityOf = (id, jobId = active.get(id)?.job.id) => {
    try {
      const s = trail.snapshot(id, jobId ? { id: jobId } : undefined); if (!s) return null;
      return { jobId: s.jobId, startedAt: s.startedAt, submittedBytes: s.submittedBytes, receivedBytes: s.bytes, textBytes: s.textBytes, attempts: s.attempts, lastDataAt: s.lastDataAt, sources: s.sources };
    } catch { return null; } // telemetry failure cannot change a job's outcome
  };
  const setState = (id, s) => { states.set(id, s); emit('agent:state', { id, ...s }); };
  const finishCancelled = (agent, job) => {
    const j = home.updateJob(agent.id, job.id, { status: 'cancelled', finishedAt: new Date().toISOString(), error: 'Cancelled by the user.' }, {expectedStatus:'queued',event:'queued_cancelled'});
    emit('job:done', { agent, job: j });
  };

  async function run(agent, job) {
    home.assertJobsHealthy?.(agent.id);
    require('./crew-config').assertReady(home);
    agent = home.getAgent(agent.id) || agent;
    if(agent.desiredLifecycle==='paused'){
      waiting.get(agent.id)?.delete(job.id);skip.delete(job.id);
      const current=home.findJob(job.id);if(current?.status==='queued')finishCancelled(agent,current);
      return;
    }
    const sharedCfg = getCfg();
    const engine = agent.engine || sharedCfg.engine;
    const cfg = engine === 'builtin' && agent.engine === 'builtin' ? { ...sharedCfg, apiKey: agent.workerApiKey || sharedCfg.apiKey, textModel: agent.workerModel || sharedCfg.textModel } : sharedCfg;
    const timeoutMs = jobTimeoutMs ?? (cfg.workerTimeoutSeconds ?? 1800) * 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) {
      const failed = home.updateJob(agent.id, job.id, { status: 'failed', error: 'Invalid worker execution deadline.' }, { expectedStatus: 'queued' });
      waiting.get(agent.id)?.delete(job.id); emit('job:done', { agent, job: failed }); return;
    }
    // A per-agent override (set from that agent's own card in the office) wins over the crew default.
    // Blank/missing fields on the agent still fall back to the shared Settings > Crew engine values.
    const cfgOverride = agent.engine ? {
      workerProvider: agent.workerProvider || cfg.workerProvider, workerModel: agent.workerModel || cfg.workerModel,
      workerApiKey: agent.workerApiKey || cfg.workerApiKey, workerBaseUrl: agent.workerBaseUrl || cfg.workerBaseUrl,
      workerContext: agent.workerContext || cfg.workerContext
    } : undefined;
    const wait = waiting.get(agent.id); if (wait) wait.delete(job.id);
    if (skip.delete(job.id)) return;                                 // it was cancelled while it was still waiting (already reported)
    const dependencyDeadline = Date.now() + 30 * 60 * 1000;
    while (job.dependencies?.length) {
      const dep = contracts.dependencyState(home, job);
      if (dep.ready) break;
      if (dep.error || Date.now() > dependencyDeadline) { const failed = home.updateJob(agent.id, job.id, { status: 'failed', error: dep.error || 'Dependency wait timed out. Review its prerequisite jobs before retrying.' }, { expectedStatus: 'queued' }); emit('job:done', { agent, job: failed }); return; }
      waiting.get(agent.id)?.add(job.id);
      await new Promise(resolve => { const timer = setTimeout(resolve, 200); });
      if (skip.delete(job.id)) return;
    }
    waiting.get(agent.id)?.delete(job.id);
    if (job.status !== 'queued' || job.recoveryNeeded) throw new Error('This job needs an explicit retry before it can run.');
    if (active.has(agent.id)) throw new Error('This worker already has an active job. Use dispatch to queue another.');
    const ctl = new AbortController(), runContext = runs.begin(agent.id, job.id, ctl.signal);
    job = { ...job, runId: runContext.runId };
    active.set(agent.id, { job, ctl, runContext });
    const deadline = setTimeout(() => ctl.abort(Object.assign(new Error('Worker execution deadline exceeded. Inspect prior effects before explicitly retrying; Orbit did not replay this job.'), { jobTimeout: true })), timeoutMs);
    deadline.unref?.(); // A pending job must not keep a quitting process alive by itself.
    // A provider may ignore AbortSignal. Settle Orbit's wait and fence late callbacks.
    const awaitEngine = fn => new Promise((resolve, reject) => {
      const abort = () => reject(ctl.signal.reason || new Error('Cancelled by the user.'));
      if (ctl.signal.aborted) return abort();
      ctl.signal.addEventListener('abort', abort, { once: true });
      try { runs.assert(runContext); Promise.resolve(fn()).then(resolve, reject).finally(() => ctl.signal.removeEventListener('abort', abort)); }
      catch (e) { ctl.signal.removeEventListener('abort', abort); reject(e); }
    });
    const liveCallback = fn => runs.guard(runContext, fn);
    return runs.within(runContext, async () => {
      let stepAt, nativeBroker, nativeContainer;
      let lastActivityEvent = 0;
      const transport = liveCallback(event => {
        try {
          trail.transport(agent.id, job, event);
          if (Date.now() - lastActivityEvent >= 250) { lastActivityEvent = Date.now(); emit('job:activity', { actor: agent.id, activity: activityOf(agent.id) }); }
        } catch { /* telemetry cannot break an engine callback */ }
      });
      const progress = liveCallback(p => { trail.add(agent.id, job, p); stepAt((p.label || p.tool || '') + (p.status ? ' [' + p.status + ']' : '')); emit('job:progress', { agent, job, ...p }); if (p.status === 'running') setState(agent.id, { state: 'working', task: p.label || p.tool, jobId: job.id }); });
      try {
        setState(agent.id, { state: 'working', task: job.task, jobId: job.id });
        const runningJob = home.updateJob(agent.id, job.id, { status: 'running', runId: runContext.runId, startedAt: new Date().toISOString() }, { expectedStatus: 'queued' });
        if (runningJob) job = runningJob;
        home.updateJob(agent.id, job.id, { routing: { engine: engine || 'builtin', provider: engine === 'builtin' ? 'gemini' : cfgOverride?.workerProvider || cfg.workerProvider, model: engine === 'builtin' ? cfg.textModel : cfgOverride?.workerModel || cfg.workerModel || cfg.textModel, source: 'configured_selection_not_live_availability', at: new Date().toISOString() } }, { expectedStatus: 'running', expectedRunId: runContext.runId, event: 'routing_selected' });
        if (agent.credentialStorageLocked) throw new Error('Worker credential storage is locked. Unlock the OS key store before running this worker.');
        if (engine === 'builtin' && agent.engine === 'builtin' && agent.workerProvider && agent.workerProvider !== 'gemini') throw new Error('The built-in worker supports Gemini only. Choose a Gemini provider or use a compatible native engine.');
        if (job.nativeBridge && engine === 'builtin') throw new Error('Native history requires a broker-capable native engine; do not discard it during a built-in switch.');
        const budgetPolicy = require('./job-budget').policy(cfg);
        const nativeEngine = engine === 'hermes' ? hermes : engine === 'opencode' ? opencode : null;
        if (engine && engine !== 'builtin' && (nativeEngine?.containmentProtocol === 1 || budgetPolicy.enabled || job.tokenBudget || job.nativeBridge || cfg.workerAllowedModels?.length || cfg.nativeContinuity && nativeEngine?.brokerProtocol === 1)) {
          if (nativeEngine?.brokerProtocol !== 1) throw new Error('Native pre-submission policy requires a broker-capable engine adapter.');
          nativeBroker = await require('./native-broker').start({ home, job, run: runContext, runs, cfg: { ...cfg, ...cfgOverride, ...(cfgOverride?.workerModel && cfg.workerRoutes?.length ? {workerRoutes:cfg.workerRoutes.filter(r=>r.model===cfgOverride.workerModel&&r.provider===(cfgOverride.workerProvider||cfg.workerProvider||'gemini'))} : {}) }, signal: ctl.signal, askNative, decide: tools.decide, nativeResume:!!job.nativeCheckpoint?.engineState?.sessionPresent });
        }
        if (job.managed) {
          if (!getGuidance()) throw new Error('Managed job guidance is not available.');
          job = await getGuidance().prepare(job, engine);
        }
        const isolated = job.projectRoot || job.reviewTarget ? await contracts.prepareWorkspace(home, agent.id, job) : null;
        runs.assert(runContext);
        if (isolated) { job = home.updateJob(agent.id, job.id, isolated, { expectedStatus: 'running', expectedRunId: runContext.runId }); }
        if (nativeEngine?.containmentProtocol === 1 && !job.workspaceDir) {
          const dir=home.p('workspace',agent.id,'.native',job.id);
          require('fs').mkdirSync(dir,{recursive:true});
          job=home.updateJob(agent.id,job.id,{workspaceDir:dir,isolation:'native_container'},{expectedStatus:'running',expectedRunId:runContext.runId});
        }
        if (nativeEngine?.containmentProtocol === 1 && job.nativeCheckpoint) require('./native-containment').restoreCheckpoint(home,job,{engine,image:({...cfg,...cfgOverride}).nativeContainerImage,route:nativeBroker.identity});
        const handoffs = contracts.prepareHandoffs(home, agent.id, job);
        if (handoffs.length) job = home.updateJob(agent.id, job.id, { handoffs }, { expectedStatus: 'running', expectedRunId: runContext.runId });
        if (nativeEngine?.containmentProtocol === 1) nativeContainer=await require('./native-containment').start({home,job,agent,engine,cfg:{...cfg,...cfgOverride},broker:nativeBroker,gateway:getNativeGateway(agent,job),signal:ctl.signal,runs,run:runContext});
        active.get(agent.id).job = job;
        trail.begin(agent.id, job); stepAt = stepTimer(bus, agent, job); ju.begin(home, agent.id, job.id, job.task); ju.snapDir(home, agent.id, job.workspaceDir || home.p("workspace", agent.id));

        let text;
        const nonBuiltin = (engine === 'hermes' && hermes) || (engine === 'opencode' && opencode); if (nonBuiltin) ju.note(home, agent.id, 'external_engine');
        const seenNotes = tg.peek(home, agent.id, 5).map(t => t.id);                 // the notes this job is shown
        const taskWithOutputs = job.task + '\n\n' + contracts.prompt(home, job) + (job.expectedOutputs?.length ? '\nREQUIRED OUTPUT FILES (relative to your workspace):\n' + job.expectedOutputs.join('\n') + '\nThese files will be checked before human acceptance. Do not report them as produced unless they exist.' : '');
        const taskForEngine = nonBuiltin ? tg.wrapTask(home, agent, taskWithOutputs) + jr.progressNote() : taskWithOutputs;   // Hermes/OpenCode get the notes inside the task
        const contextBudget = require('./context-budget');
        const contextUsage = { ...contextBudget.check({ system: nonBuiltin ? '' : buildAgentPrompt(cfg, home, { ...agent, workspaceDir: job.workspaceDir }), task: taskForEngine }), boundary: nonBuiltin ? 'external_task_only' : 'builtin_system_and_task' };
        home.updateJob(agent.id, job.id, { contextUsage }, { expectedStatus: 'running', expectedRunId: runContext.runId });
        if (engine === 'hermes' && hermes) {
          home.updateJob(agent.id, job.id, { engine: 'hermes' });
          const once = () => {
            const started = Date.now(), model = (cfgOverride && cfgOverride.workerModel) || cfg.workerModel || cfg.textModel;
            return hermes.runTask(agent, taskForEngine, { signal: ctl.signal, onProgress: progress, onTransport: transport, cfgOverride: { ...cfgOverride, ...nativeBroker?.override, nativeContainer, ...(job.workspaceDir ? { workspaceDir: job.workspaceDir } : {}) }, onText: liveCallback(t => trail.text(agent.id, job, t)),
              onUsage: liveCallback(u => { if (usage && u) usage.add({ source: 'hermes', model, agentId: agent.id, inTok: u.prompt_tokens, outTok: u.completion_tokens, run: true, startedAt: started }); }) });
          };
          try { text = await awaitEngine(once); }
          catch (e) {
            // A remote agent can exhaust quota after changing files. Reposting the entire goal is not a safe retry.
            if (ctl.signal.aborted || !minuteQuota(String(e.message))) throw e;
            throw new Error(e.message + ' Orbit did not automatically replay this job. Wait for the quota reset, inspect existing outputs, then retry explicitly.');
          }
        } else if (engine === 'opencode' && opencode) {
          home.updateJob(agent.id, job.id, { engine: 'opencode' });
          if (typeof opencode.preflight === 'function') { const pf = await awaitEngine(() => opencode.preflight({...cfgOverride,nativeContainer})); if (!pf.ok) throw new Error(pf.error); runs.assert(runContext); }   // not ready: fail now with a clear message
          text = await awaitEngine(() => opencode.runTask(agent, taskForEngine, { signal: ctl.signal, onProgress: progress, cfgOverride: { ...cfgOverride, ...nativeBroker?.override, nativeContainer, ...(job.workspaceDir ? { workspaceDir: job.workspaceDir } : {}) }, onData: n => transport({ kind: 'received', source: 'opencode_process_output', bytes: n }), onText: liveCallback(t => trail.say(agent.id, job, t)) }));
        } else {
          const shownTags = tg.peek(home, agent.id, 5).map(t => t.id);   // the notes this job is shown
          const card = cp.createCard(taskWithOutputs);
          const accounting = require('./job-budget').createBudget(cfg, evidence => home.updateJob(agent.id, job.id, { tokenBudget: evidence }, { expectedStatus: 'running', expectedRunId: runContext.runId }), job.tokenBudget);
          const requestBudget = contextBudget.createRequestBudget(cfg.workerMaxRequests, reservation => home.updateJob(agent.id, job.id, { requestBudget: reservation }, { expectedStatus: 'running', expectedRunId: runContext.runId }));
          const loop = (contents, model) => {
            const priorOutcomes = (card.outcomes || []).slice(), priorFiles = card.files.slice();
            return gemini.runLoop({
              onCheckpoint: liveCallback(s => cp.update(home, agent.id, job.id, card, { ...s, priorOutcomes, priorFiles })),
              model, onStep: liveCallback(s => { stepAt(s && (s.name || s.tool || s.kind || s.type)); cp.update(home, agent.id, job.id, card, { ...s, priorOutcomes, priorFiles }); an.check({ home, bus, agent, job, card, ctl }); }),
              cfg,
              accounting,
              onTransport: transport,
              system: buildAgentPrompt(cfg, home, { ...agent, workspaceDir: job.workspaceDir }),
              contents, // the whole task, or a short saved summary when continuing after a model problem
              tools: tools.declarationsFor(agent.id),
              exec: (n, a) => runs.within(runContext, () => { ju.note(home, agent.id, n); return tools.exec(n, a, agent.id); }),
              agentId: agent.id,
              maxSteps: 14,
              requestBudgetBytes: contextBudget.DEFAULT_REQUEST_BYTES,
              beforeSubmit: requestBudget.beforeSubmit,
              compactReadHistory: true,
              onContext: liveCallback(measurement => { home.updateJob(agent.id, job.id, { contextCompaction: measurement }, { expectedStatus: 'running', expectedRunId: runContext.runId }); }),
              shouldStop: () => ctl.signal.aborted,
              onRetry: liveCallback(r => emit('job:progress', { agent, job, tool: 'gemini', label: r.fallback ? 'busy, switching to ' + r.fallback : 'busy (' + r.status + '), retry ' + r.attempt + '/' + r.of + ' in ' + Math.round(r.waitMs / 1000) + 's', status: 'running' }))
            });
          };
          try { ({ text } = await awaitEngine(() => loop([{ role: 'user', parts: [{ text: taskWithOutputs }] }]))); }
          catch (e) {
            // A temporary model problem in the middle of a job: continue from the short saved card, not the whole conversation.
            if (ctl.signal.aborted || !cp.canResume(card) || !cp.isTransient(e)) throw e;
            progress({ tool: 'checkpoint', label: 'continuing from a short saved summary (' + card.stepCount + ' calls recorded)', status: 'running' });
            await sleep(2000, ctl.signal);
            ({ text } = await awaitEngine(() => loop([{ role: 'user', parts: [{ text: cp.resumeText(card) }] }], cfg.textFallbackModel || undefined)));
          }
          runs.assert(runContext);
          tg.markRead(home, agent.id, shownTags);
        }
        runs.assert(runContext);
        nativeBroker?.assertHealthy();
        if (nonBuiltin) text = tg.collectFromReport(home, bus, getCfg(), agent, text, seenNotes);   // NOTE lines in the report become notes
        if (typeof text !== 'string' || !text.trim()) throw new Error('The worker returned no report. The job has not been completed.');
        const verification = review.evidence(home, agent.id, { ...job, result: text });
        const done = home.updateJob(agent.id, job.id, outcomePatch(home.findJob?.(job.id) || job, { status: 'review', finishedAt: new Date().toISOString(), result: text, verification, activity: activityOf(agent.id, job.id) }), { expectedStatus: 'running', expectedRunId: runContext.runId });
        if (!nonBuiltin) cp.finish(home, agent.id, job.id);
        // A memory/log listener is secondary; it must not turn a durably recorded report into a failure.
        try { home.appendMemory(agent.id, `Report ready for review: ${job.task.slice(0, 100)} → ${text.slice(0, 160)}`); } catch { /* job record is authoritative */ }
        setState(agent.id, { state: 'idle' });
        emit('job:done', { agent, job: done });
      } catch (e) {
        const cancelled = ctl.signal.aborted;
        const timedOut = cancelled && ctl.signal.reason?.jobTimeout;
        const byRule = cancelled && ctl.signal.reason && ctl.signal.reason.anomaly ? ctl.signal.reason : null;   // stopped by an anomaly rule, not by the user
        let failed;
        try { failed = home.updateJob(agent.id, job.id, outcomePatch(home.findJob?.(job.id) || job, { status: cancelled && !byRule && !timedOut ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(), activity: activityOf(agent.id), error: timedOut ? ctl.signal.reason.message : byRule ? byRule.message : cancelled ? 'Cancelled by the user.' : e.message }), { expectedRunId: runContext.runId }); }
        catch {
          const message = 'Job storage could not record the outcome. This worker is blocked. Inspect its files and repair storage before restarting Orbit.';
          home.recoveryFaults?.set(agent.id, message); emit('job:storage-error', { agent, jobId: job.id, error: message });
        }
        setState(agent.id, { state: 'idle' });
        if (failed) emit('job:done', { agent, job: failed });
      } finally {
        runs.end(runContext);
        if (nativeContainer) { try { await nativeContainer.close(); } catch { /* close quarantines the worker and persists unknown cleanup */ } }
        nativeBroker?.close();
        clearTimeout(deadline);
        if (stateOf(agent.id).jobId === job.id && stateOf(agent.id).state === 'working') setState(agent.id, { state: 'idle' });
        if (active.get(agent.id)?.runContext === runContext) active.delete(agent.id);
        try { ju.diffDir(home, agent.id); } finally { ju.end(agent.id); }
      }
    });
  }

  function enqueue(agent, job) {
    const queuedBehind = (active.has(agent.id) ? 1 : 0) + (waiting.get(agent.id) ? waiting.get(agent.id).size : 0);
    if (!waiting.has(agent.id)) waiting.set(agent.id, new Set());
    waiting.get(agent.id).add(job.id);
    emit('job:created', { agent, job });
    const prev = queues.get(agent.id) || Promise.resolve();
    queues.set(agent.id, prev.then(() => run(agent, job)).catch(() => {}));
    return { ...job, queuedBehind };
  }
  function dispatch(agentId, task, options = {}, beforeEnqueue) {
    if(home.getAgent(agentId)?.desiredLifecycle==='paused')throw new Error('Worker is paused. Explicitly make it ready before assigning work.');
    const agent = home.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent ${agentId}`);
    home.assertJobsHealthy?.(agent.id);
    require('./crew-config').assertReady(home);
    const job = home.createJob(agent.id, task, { ...options, contract: contracts.build(home, agent, task, options) });
    // Trusted host callers can persist their parent linkage before execution starts.
    try { if (beforeEnqueue) beforeEnqueue(job); }
    catch (e) {
      home.updateJob(agent.id, job.id, { status: 'cancelled', error: 'Parent linkage could not be saved; execution was not queued.' }, { expectedStatus: 'queued', event: 'linkage_failed' });
      throw e;
    }
    return enqueue(agent, job);
  }

  function retryJob(jobId) {
    if(home.getAgent(home.findJob(jobId)?.agent)?.desiredLifecycle==='paused')throw new Error('Worker is paused. Explicitly make it ready before retrying.');
    const old = home.findJob(jobId), agent = old && home.getAgent(old.agent);
    if (old?.reviewTarget) throw new Error('Queue a fresh independent review from the target project job; reviewer bindings cannot transfer through a generic retry.');
    if (!agent || !(['interrupted', 'failed', 'cancelled', 'rejected'].includes(old.status) || (old.status === 'queued' && old.recoveryNeeded))) throw new Error('Only a stopped, failed or recovered job can be retried.');
    home.assertJobsHealthy?.(agent.id);
    require('./crew-config').assertReady(home);
    const card = cp.load(home, old.id);
    const task = old.status === 'queued' ? old.task : [old.task, '\nRECOVERY: The previous run stopped. Inspect existing outputs first. Do not repeat an external action unless its outcome is known or the user authorizes it.', card ? cp.resumeText(card) : 'No step checkpoint is available; do not assume earlier actions failed.'].join('\n');
    // Persist a retry intent before creating another job, so double-clicks cannot create duplicates.
    home.updateJob(agent.id, old.id, { status: 'retrying', retryIntent: { version: 1, carry: require('./job-retry').carry(old) }, retryRequestedAt: new Date().toISOString() }, { expectedStatus: old.status, event: 'retry_requested' });
    let next;
    try {
      const options = { managed: old.managed === true, expectedOutputs: old.expectedOutputs || [], retryOf: old.id, dependencies: old.dependencies || [], skills: (old.selectedSkills || []).map(s => s.slug), ...(old.projectRoot ? { projectRoot: old.projectRoot } : {}) };
      next = home.createJob(agent.id, task, { ...options, contract: contracts.build(home, agent, task, options) });
      next = require('./job-retry').complete(home, home.findJob(old.id), next);
      home.updateJob(agent.id, old.id, { status: 'retried', retryJobId: next.id }, { expectedStatus: 'retrying', event: 'retry_created' });
    } catch (e) {
      if (next) { try { require('./job-retry').planLink(home, old, next, true); } catch { home.recoveryFaults?.set(agent.id, 'Retry project linkage needs repair before further work.'); } }
      if (next) home.updateJob(agent.id, next.id, { status: 'cancelled', error: 'Retry linkage could not be saved; no execution was started.' });
      home.updateJob(agent.id, old.id, { status: old.status }, { expectedStatus: 'retrying', event: 'retry_setup_failed' });
      throw e;
    }
    return enqueue(agent, next);
  }
  function decideReview(jobId, decision) {
    const job = home.findJob(jobId), agent = job && home.getAgent(job.agent);
    if (!agent || job.status !== 'review') throw new Error('This job is not ready for review.');
    if (decision === 'accept' && job.projectBinding && (!getPlanner() || getPlanner().inspect(job.projectBinding.projectId).unresolved.length)) throw new Error('Resolve current project conflicts through human permission before acceptance.');
    const updated = decision === 'accept' ? review.accept(home, agent.id, job.id, outcomePatch) : decision === 'reject' ? home.updateJob(agent.id, job.id, outcomePatch(job, { status: 'rejected', reviewedBy: 'human', reviewedAt: new Date().toISOString() }), { expectedStatus: 'review', event: 'human_rejected' }) : null;
    if (!updated) throw new Error('Choose accept or reject.');
    emit('job:reviewed', { agent, job: updated }); return updated;
  }

  async function syncOutcome(jobId) {
    if (!getGuidance()?.sync) throw new Error('NeuralOps outcome synchronization is unavailable.');
    const job = await getGuidance().sync(jobId), agent = home.getAgent(job.agent);
    emit('job:reviewed', { agent, job }); return job;
  }

  // Stops the job that is running now and every job waiting behind it. Returns how many were stopped.
  function cancel(agentId) {
    const agent = home.getAgent(agentId); if (!agent) return 0;
    let n = 0; const a = active.get(agent.id);
    if (a) { a.ctl.abort(new Error('Cancelled by the user.')); n++; }
    const queuedIds = new Set([...(waiting.get(agent.id) || []), ...(home.listJobs?.(agent.id, Infinity) || []).filter(j => j.status === 'queued').map(j => j.id)]);
    for (const id of queuedIds) {
      const j = home.findJob(id); if (!j || j.status !== 'queued') continue;
      waiting.get(agent.id)?.delete(id); n++;
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
    const wdir = a.job.workspaceDir || home.p('workspace', agent.id); let plan = jr.readPlan(wdir); const planOld = !!(plan && plan.ageMs > Date.now() - (snap.startedAt - 2000)); if (planOld) plan = null; const files = jr.measure(wdir, jr.recentFiles(wdir, snap.startedAt - 2000));
    jr.save(resumeDir(), agent.id, { ...jr.checkpoint(snap, { files, plan }), originalJobId: a.job.id, managed: a.job.managed === true, expectedOutputs: a.job.expectedOutputs || [], dependencies: a.job.dependencies || [], skills: (a.job.selectedSkills || []).map(s => s.slug), previousWorkspace: a.job.workspaceDir || null });
    const n = cancel(agent.id);
    return { ok: true, working: true, text: jr.format(snap, { name: agent.name, files, plan }) + (planOld ? '\nPlan: this job has not written PROGRESS.md yet (the file there is from an older job, so it is not counted).' : '') + '\n' + (n > 1 ? (n - 1) + ' waiting job(s) were stopped too. ' : '') + 'A short note is saved: /' + firstName(agent) + ' continue carries on from it without reading everything again.' };
  }
  // /name continue [new instruction]: a new run that starts from the short note only.
  function resumeJob(agentId, note) {
    const agent = home.getAgent(agentId); if (!agent) return { ok: false, text: 'Unknown agent.' };
    const saved = jr.load(resumeDir(), agent.id);
    if (!saved) return { ok: false, text: 'Nothing is saved to continue for ' + agent.name + '. Give a new job with /' + firstName(agent) + ' <job>.' };
    if (saved.originalJobId) {
      const previous = home.findJob(saved.originalJobId);
      if (!previous || previous.agent !== agent.id || !['failed','cancelled','interrupted','rejected'].includes(previous.status)) throw new Error('Paused job has not settled or its identity changed. Inspect it before continuing.');
      if (note?.trim()) throw new Error('Changed goals need a new explicit job. Continue without extra instructions to preserve this job binding.');
      const job = retryJob(previous.id); jr.clear(resumeDir(), agent.id);
      return { ok: true, job, text: agent.name + ' continues in a fresh run with prior workspace/budget evidence; previous approvals are not restored (' + job.id + ').' };
    }
    const task = jr.resumeTask(saved, note) + (saved.previousWorkspace ? '\nPrevious isolated workspace (inspect existing outputs before repeating): ' + saved.previousWorkspace : '');
    const job = dispatch(agent.id, task, { managed: saved.managed === true, expectedOutputs: saved.expectedOutputs || [], dependencies: saved.dependencies || [], skills: saved.skills }); jr.clear(resumeDir(), agent.id);
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
        if(opencode.containmentProtocol===1){for(const s of await opencode.check())lines.push('- '+(s.ok?'OK: ':'FAIL: ')+s.name+' ('+s.detail+')');}
        else {
        const pf = await opencode.preflight(ov); lines.push('- ' + (pf.ok ? 'OK: ' : 'FAIL: ') + 'OpenCode installed, model and key set' + (pf.ok ? '' : ' (' + pf.error + ')'));
        if (pf.ok) { const pr = await opencode.probe(ov); lines.push('- ' + (pr.ok ? 'OK: ' : 'FAIL: ') + 'the model answers' + (pr.ok ? ' (' + pr.ms + ' ms)' : ' (' + pr.error + ')')); }
        }
      } else if (engine === 'hermes' && hermes && hermes.check) {
        const res = await hermes.check({ smoke: true }); const steps = Array.isArray(res) ? res : (res && res.steps) || [];
        for (const s of steps) lines.push('- ' + (s.ok ? 'OK: ' : 'FAIL: ') + s.name + (s.detail ? ' (' + s.detail + ')' : ''));
      } else lines.push('- This agent uses the built-in engine (Gemini directly): nothing separate to check.');
    } catch (e) { lines.push('- FAIL: the check itself broke: ' + ((e && e.message) || e)); }
    if (live) lines.push('', live);
    return { ok: true, text: lines.join('\n') };
  }
  return { run, dispatch, retryJob, decideReview, syncOutcome, cancel, cancelAll, activityOf, hasPending: () => active.size > 0 || [...waiting.values()].some(s => s.size > 0), stateOf, states, pauseForReport, resumeJob, healthCheck };   // human review is UI-only, never a model tool
}

module.exports = { createWorkers, minuteQuota, stepTimer };
