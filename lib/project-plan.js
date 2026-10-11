'use strict';
// Structured project cards link existing jobs. This is not another execution engine.
const fs = require('fs'), crypto = require('crypto'), storage = require('./job-storage');
const text = (v, n, label) => { if (typeof v !== 'string' || !v.trim() || v.length > n) throw new Error('Invalid ' + label); return v.trim(); };
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const idOK = v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(v);
function createPlanner({ home, dispatch, bus }) {
  const file = id => { if (!/^project-[a-f0-9-]{36}$/.test(id || '')) throw new Error('Invalid project ID.'); return home.p('projects', id + '.json'); };
  const read = id => { const f = file(id); if (fs.lstatSync(f).isSymbolicLink()) throw new Error('Project card cannot be a link.'); const p = JSON.parse(fs.readFileSync(f)); if (p.id !== id || p.schemaVersion !== 1) throw new Error('Invalid project record.'); return p; };
  const save = p => { storage.atomicWrite(file(p.id), p); return p; };
  function create(input) {
    const goal = text(input.goal, 12000, 'goal'), assumptions = input.assumptions || [], risks = input.risks || [];
    const teamLeader=input.teamLeader===undefined?null:text(input.teamLeader,100,'team leader');
    if(teamLeader&&!home.getAgent(teamLeader))throw Error('Team leader must be an existing worker.');
    if (![assumptions,risks].every(a => Array.isArray(a) && a.length <= 20 && a.every(v => typeof v === 'string' && v.length <= 1000))) throw new Error('Invalid bounded assumptions or risks.');
    const business = input.business || {};
    if (!business || typeof business !== 'object' || Array.isArray(business) || Object.keys(business).some(k => !['budgetUsd','estimatedCostUsd','deadlineHours','estimatedHours','successCriteria','unknowns'].includes(k))) throw new Error('Invalid business assessment fields.');
    for (const k of ['budgetUsd','estimatedCostUsd','deadlineHours','estimatedHours']) if (business[k] !== undefined && (!Number.isFinite(business[k]) || business[k] < 0 || business[k] > 100000000)) throw new Error('Business estimates must be bounded nonnegative numbers.');
    for (const k of ['successCriteria','unknowns']) if (business[k] !== undefined && (!Array.isArray(business[k]) || business[k].length > 20 || business[k].some(v => typeof v !== 'string' || !v.trim() || v.length > 1000))) throw new Error('Invalid business assessment text.');
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) throw new Error('A project needs 1–100 structured steps.');
    const steps = input.steps.map(s => {
      if (!idOK(s.id)) throw new Error('Invalid step ID.');
      const dependencies = s.dependencies || [], skills = s.skills || [];
      if (!Array.isArray(dependencies) || dependencies.length > 20 || dependencies.some(d => !idOK(d)) || !Array.isArray(skills) || skills.length > 3 || skills.some(n => typeof n !== 'string' || n.length > 100)) throw new Error('Invalid step dependencies or skills.');
      if(s.estimatedHours!==undefined&&(!Number.isFinite(s.estimatedHours)||s.estimatedHours<0||s.estimatedHours>1000000))throw Error('Invalid step effort estimate.');
      return { id: s.id, task: text(s.task, 8000, 'step task'), role: text(s.role, 200, 'worker role'), agent: s.agent ? text(s.agent, 100, 'worker') : null, ...(s.estimatedHours!==undefined?{estimatedHours:s.estimatedHours}:{}),
        dependencies: [...new Set(dependencies)], skills, expectedOutputs: storage.outputs(s.expected_outputs || []), ...(s.project_root ? { projectRoot: text(s.project_root, 1000, 'project root') } : {}) };
    });
    const ids = new Set(steps.map(s => s.id)); if (ids.size !== steps.length) throw new Error('Duplicate step IDs.');
    const visiting = new Set(), seen = new Set();
    const visit = id => { if (visiting.has(id)) throw new Error('Project dependencies contain a cycle.'); if (seen.has(id)) return; visiting.add(id); for (const d of steps.find(s => s.id === id).dependencies) { if (!ids.has(d)) throw new Error('Unknown prerequisite step.'); visit(d); } visiting.delete(id); seen.add(id); };
    for (const s of steps) visit(s.id);
    return inspect(save({ id: 'project-' + crypto.randomUUID(), schemaVersion: 1, goal, assumptions, risks, business, steps, teamLeader, resolutions: [], createdAt: new Date().toISOString(), origin: 'model_proposal_not_approval' }));
  }
  function inspect(value) {
    const p = typeof value === 'string' ? read(value) : value;
    const { Library } = require('./library'), lib = new Library(home), agents = home.listAgents();
    const steps = p.steps.map(s => {
      const words = new Set(s.role.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
      const candidates = agents.filter(a => !a.credentialStorageLocked&&a.desiredLifecycle!=='paused').map(a => ({ id: a.id, load:home.listJobs(a.id,Infinity).filter(j=>['queued','running'].includes(j.status)).length, skillScore: s.skills.filter(n => { try { return !!lib.skillFor(a.id, n); } catch { return false; } }).length, score: (String(a.role).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => words.has(w)).length })).filter(a => a.score > 0||s.skills.length>0&&a.skillScore===s.skills.length).sort((a,b) => b.skillScore-a.skillScore || a.load-b.load || b.score-a.score || a.id.localeCompare(b.id));
      let agent = s.agent ? home.getAgent(s.agent) : candidates[0] && home.getAgent(candidates[0].id);
      if (agent?.credentialStorageLocked||agent?.desiredLifecycle==='paused') agent = null;
      const missingSkills = s.skills.filter(n => { try { return !agent || !lib.skillFor(agent.id, n); } catch { return true; } });
      const job = s.jobId ? home.findJob(s.jobId) : null;
      let accepted = job?.status === 'done' && job.acceptedBy === 'human';
      if (accepted) try {
        const review = require('./job-review');
        if (job.verification?.revision && review.revisionEvidence(home, job.agent, job)?.sha256 !== job.verification.revision.sha256) accepted = false;
        for (const a of job.verification?.artifacts || []) if (review.inspectOutput(home, job.agent, a.path, job.workspaceDir).sha256 !== a.sha256) accepted = false;
      } catch { accepted = false; }
      let status = job ? accepted ? 'accepted' : job.status : !agent || missingSkills.length ? 'needs_team_or_skills' : 'ready';
      if (job?.status === 'done' && !accepted) status = 'stale_accepted_evidence';
      return { ...s, recommendedAgent: agent?.id || null, missingSkills, status, jobStatus: job?.status || null, accepted, recommendationSource: s.agent ? 'explicit' : 'role_keyword_match_not_verified_expertise' };
    });
    for (const s of steps) if (!s.jobId && s.dependencies.some(id => !steps.find(d => d.id === id)?.accepted)) s.status = 'waiting_dependencies';
    const claims = new Map();
    for (const s of steps) for (const c of (s.jobId && home.findJob(s.jobId)?.projectClaims) || []) { if (!claims.has(c.key)) claims.set(c.key, []); claims.get(c.key).push({ step: s.id, jobId: s.jobId, value: c.value }); }
    const conflicts = [...claims].filter(([,cs]) => new Set(cs.map(c => JSON.stringify(c.value))).size > 1).map(([key,claims]) => ({ key, claims, hash: hash({ key, claims }) }));
    // Semantic findings supplied by Laila remain proposals. Exact source quotations and hashes bind them to reports.
    for (const c of p.reportFindings || []) {
      const fresh = c.evidence.every(e => { const j = home.findJob(e.jobId); return j?.projectBinding?.projectId === p.id && hash(String(j.result || '')) === e.reportHash; });
      conflicts.push({ key: 'report/' + c.topic, claims: c.evidence, hash: fresh ? hash(c) : hash({c,current:c.evidence.map(e=>hash(String(home.findJob(e.jobId)?.result || '')))}), source: fresh ? 'laila_analysis_unverified_semantics' : 'stale_report_analysis_requires_reinspection', explanation: c.explanation });
    }
    const unresolved = conflicts.filter(c => !p.resolutions.some(r => r.hash === c.hash && r.origin === 'human_permission'));
    const groups = new Map();
    for (const s of steps.filter(s => !s.jobId && (!s.recommendedAgent || s.missingSkills.length))) {
      const key = s.recommendedAgent ? 'existing/' + s.recommendedAgent : JSON.stringify([s.role.toLowerCase(), [...s.skills].sort()]);
      if (!groups.has(key)) groups.set(key, { name: 'Project ' + s.role.slice(0, 20), role: s.role, steps: [], skills: [], existingAgent:s.recommendedAgent,
        unavailableSkills: [], source: 'role_requirement_not_verified_expertise' });
      const group=groups.get(key);group.steps.push(s.id);group.skills=[...new Set([...group.skills,...s.skills])];group.unavailableSkills=group.skills.filter(n=>!lib.skillMetadata(n));
    }
    const business = p.business || {}, blockers = [];
    if (business.budgetUsd !== undefined && business.estimatedCostUsd !== undefined && business.estimatedCostUsd > business.budgetUsd) blockers.push('Estimated cost exceeds the supplied budget.');
    // This optimistic lower bound can reject an impossible deadline; it cannot prove a schedule is achievable.
    const maxParallel = Math.max(1, steps.length);
    const scheduled=new Map(),workerAvailable=new Map();
    const schedule=s=>{if(scheduled.has(s.id))return scheduled.get(s.id);const dependencyEnd=Math.max(0,...s.dependencies.map(id=>schedule(steps.find(x=>x.id===id)).end));const start=Math.max(dependencyEnd,s.recommendedAgent?workerAvailable.get(s.recommendedAgent)||0:0),duration=s.estimatedHours??0;const item={step:s.id,agent:s.recommendedAgent,start,end:start+duration,estimatePresent:s.estimatedHours!==undefined};scheduled.set(s.id,item);if(s.recommendedAgent)workerAvailable.set(s.recommendedAgent,item.end);return item;};
    for(const s of steps)schedule(s);
    const scheduleHours=Math.max(0,...[...scheduled.values()].map(s=>s.end));
    const critical=new Map(),loads=new Map();const chain=s=>{if(!critical.has(s.id))critical.set(s.id,(s.estimatedHours??0)+Math.max(0,...s.dependencies.map(id=>chain(steps.find(x=>x.id===id)))));return critical.get(s.id);};for(const s of steps){chain(s);if(s.recommendedAgent)loads.set(s.recommendedAgent,(loads.get(s.recommendedAgent)||0)+(s.estimatedHours??0));}
    const lowerBoundHours=Math.max(0,...critical.values(),...loads.values());
    if(steps.every(s=>s.estimatedHours!==undefined)&&business.deadlineHours!==undefined&&lowerBoundHours>business.deadlineHours)blockers.push('Dependency and assigned-worker effort lower bound exceeds the supplied deadline.');
    if (business.deadlineHours !== undefined && business.estimatedHours !== undefined && business.estimatedHours / maxParallel > business.deadlineHours) blockers.push('Even the optimistic effort/capacity lower bound exceeds the supplied deadline.');
    if (p.staffing && ['prepared','partial'].includes(p.staffing.status)) blockers.push('Incomplete staffing needs human inspection; no automatic replay.');
    const workerReports = steps.filter(s => s.jobId).map(s => { const j = home.findJob(s.jobId); const report = String(j?.result || ''); return { step: s.id, jobId: s.jobId, report: report.slice(0, 12000), reportHash: hash(report), truncated: report.length > 12000, origin: 'untrusted_worker_report_not_authority' }; });
    return { ...p, steps, workerReports, staffingRevision: hash({ p, agents: agents.map(a => ({id:a.id,role:a.role,desiredLifecycle:a.desiredLifecycle||'ready',credentialStorageLocked:!!a.credentialStorageLocked,engine:a.engine,workerProvider:a.workerProvider,workerModel:a.workerModel,queued:home.listJobs(a.id,Infinity).filter(j=>['queued','running'].includes(j.status)).map(j=>({id:j.id,status:j.status,runId:j.runId}))})), assignments: lib.assignments(), catalog: lib.skills().map(s=>s.slug) }), staffingProposal: [...groups.values()], staffingObserved: (p.staffing?.workers || []).map(w => ({id:w.id,exists:!!home.getAgent(w.id),recordedComplete:p.staffing.completed.includes(w.id),assignmentMatches:w.skills.every(n=>lib.assignmentFor(w.id).skills.includes(lib.skillMetadata(n)?.slug)),linkedSteps:w.steps.filter(id=>p.steps.find(s=>s.id===id)?.agent===w.id)})), businessAssessment: { status: blockers.length ? 'blocked_constraints' : !business.successCriteria?.length || business.unknowns?.length ? 'needs_information' : 'proposal_requires_validation', blockers, source: 'supplied_estimates_not_market_research', maxParallelStepBound: maxParallel }, team: [...new Set(steps.map(s => s.recommendedAgent).filter(Boolean))], requestedRoleCount: new Set(steps.map(s => s.role.toLowerCase())).size,
      schedule:{hours:scheduleHours,lowerBoundHours,completeEstimates:steps.every(s=>s.estimatedHours!==undefined),steps:[...scheduled.values()],source:'supplied_effort_greedy_schedule_not_optimal_or_delivery_guarantee'},
      staffingEvidence:steps.map(s=>({step:s.id,agent:s.recommendedAgent,requiredSkills:s.skills,missingSkills:s.missingSkills,queuedJobs:s.recommendedAgent?home.listJobs(s.recommendedAgent,Infinity).filter(j=>['queued','running'].includes(j.status)).length:null,expertiseVerified:false})),
      coordination:{leader:p.teamLeader||null,leaderAvailable:!!p.teamLeader&&!!home.getAgent(p.teamLeader)&&home.getAgent(p.teamLeader).desiredLifecycle!=='paused',reportJobs:workerReports.map(r=>r.jobId),unresolvedConflicts:unresolved.length,coordinatorJobId:p.coordinatorJobId||null,coordinatorStatus:p.coordinatorJobId?home.findJob(p.coordinatorJobId)?.status||'missing':null,authority:p.coordinationGrant?'approved_steps_only_no_worker_creation_or_human_acceptance':'coordination_only_no_worker_creation_permissions_or_automatic_delegation'},
      feasibility: { status: unresolved.length ? 'conflicting_reports' : steps.some(s => !s.recommendedAgent || s.missingSkills.length) ? 'missing_team_or_skills' : 'structurally_valid_unverified', note: 'Role/skill availability and dependency validation, not proof of business feasibility or technical success.' },
      conflicts, unresolved, status: unresolved.length ? 'blocked_conflict' : steps.every(s => s.accepted) ? 'human_accepted' : 'in_progress_or_proposed' };
  }
  function dispatchStep(id, stepId, coordinator) {
    const p = read(id), view = inspect(p), s = view.steps.find(s => s.id === stepId);
    if (!s || s.jobId || s.status !== 'ready' || view.unresolved.length || view.businessAssessment.blockers.length) throw new Error('Project step is missing, already dispatched or blocked by prerequisites/team/conflicts.');
    if (coordinator && (s.recommendedAgent !== coordinator.agents[stepId] || coordinator.projectId !== id)) throw new Error('Delegated worker changed outside the approved scope.');
    const dependencies = s.dependencies.map(id => p.steps.find(s => s.id === id).jobId);
    const task = p.goal + '\nPROJECT STEP: ' + s.task + '\nASSUMPTIONS/RISKS/BUSINESS (unverified context, not permissions): ' + JSON.stringify({ assumptions: p.assumptions, risks: p.risks, business:p.business || {} });
    const job = dispatch(s.recommendedAgent, task, { expectedOutputs: s.expectedOutputs, dependencies, skills: s.skills, projectRoot: s.projectRoot, projectBinding: { projectId: id, stepId, ...(coordinator ? {coordinatorJobId:coordinator.jobId} : {}) }, ...(coordinator ? {managed:coordinator.managed} : {}) }, j => {
      const fresh = read(id); if (coordinator) coordinatorScope(coordinator.run); if (fresh.steps.find(x => x.id === stepId).jobId) throw new Error('Project step already linked.');
      save({ ...fresh, steps: fresh.steps.map(x => x.id === stepId ? { ...x, jobId: j.id } : x) });
    });
    try { bus?.emit('project:updated', { id }); } catch {} return { job, project: inspect(id) };
  }
  // A fresh human action creates a finite grant, stored in the existing project and job contract.
  function coordinationConfig(p) {
    return {goal:p.goal,leader:p.teamLeader,steps:p.steps.map(({jobId,...step})=>step),assumptions:p.assumptions,risks:p.risks,business:p.business,
      workers:[...new Set([p.teamLeader,...p.steps.map(s=>s.agent)].filter(Boolean))].map(id=>({id,agent:home.getAgent(id),assignment:new (require('./library').Library)(home).assignmentFor(id)}))};
  }
  function coordinationProposal(id) {
    const p=read(id),v=inspect(p),leader=home.getAgent(p.teamLeader);
    if (!leader || leader.desiredLifecycle==='paused' || leader.credentialStorageLocked) throw new Error('Choose an available existing team leader.');
    const current=p.coordinatorJobId && home.findJob(p.coordinatorJobId);
    if (current && ['queued','running','retrying'].includes(current.status)) throw new Error('A coordinator job is already active.');
    if (v.unresolved.length || v.businessAssessment.blockers.length || v.steps.some(s=>!s.recommendedAgent || s.missingSkills.length)) throw new Error('Resolve team, skills and project blockers first.');
    const steps=v.steps.filter(s=>!s.jobId).map(s=>({id:s.id,agent:s.recommendedAgent,task:s.task,dependencies:s.dependencies}));
    if (!steps.length || steps.some(s=>s.agent===p.teamLeader)) throw new Error('Coordinator must be separate from the workers on undispatched steps.');
    return {projectId:id,leader:p.teamLeader,steps,revision:hash({p,staffingRevision:v.staffingRevision,steps}),authority:'finite_existing_steps_only_no_worker_creation_or_approval',managed:leader.managed===true};
  }
  function startCoordinator(id, revision) {
    const proposal=coordinationProposal(id);
    if (proposal.revision!==revision) throw new Error('Coordination scope changed; inspect and approve again.');
    const p=read(id),originalHash=hash(p),agents=Object.fromEntries(proposal.steps.map(s=>[s.id,s.agent]));
    // Pin the approved recommendations so later queue-load changes cannot silently choose another worker.
    p.steps=p.steps.map(s=>agents[s.id]?{...s,agent:agents[s.id]}:s);
    const binding={projectId:id,configHash:hash(coordinationConfig(p)),agents,revision,origin:'human_permission',managed:proposal.managed};
    const task='Coordinate this finite project scope. Use get_team_plan and delegate_team_step; poll agent_messages. Do not create workers, accept results or resolve conflicts. Dependency handoffs still require human acceptance. If blocked, report the exact blocker instead of inventing approval.\n'+JSON.stringify({projectId:id,goal:p.goal,steps:proposal.steps});
    const job=dispatch(p.teamLeader,task,{coordinationBinding:binding,managed:proposal.managed},j=>{
      const fresh=read(id); if(hash(fresh)!==originalHash || hash(coordinationConfig(p))!==binding.configHash)throw new Error('Coordination approval expired before dispatch.');
      save({...p,coordinatorJobId:j.id,coordinationGrant:{...binding,jobId:j.id,createdAt:new Date().toISOString()}});
    });
    return {job,proposal,project:inspect(id)};
  }
  function coordinatorScope(run) {
    const job=run && home.findJob(run.jobId),b=job?.coordinationBinding;
    if (!b || job.agent!==run.actor || job.status!=='running' || job.runId!==run.runId) throw new Error('Only the active approved coordinator job can delegate.');
    const p=read(b.projectId),g=p.coordinationGrant;
    if (p.teamLeader!==run.actor || p.coordinatorJobId!==job.id || g?.jobId!==job.id || g.configHash!==b.configHash || hash(coordinationConfig(p))!==b.configHash || hash(g.agents)!==hash(b.agents)) throw new Error('Coordinator scope changed or was revoked. Fresh human approval required.');
    return {...b,jobId:job.id,run};
  }
  function teamPlan(run) { const b=coordinatorScope(run); return inspect(b.projectId); }
  function delegate(run,stepId) {
    const b=coordinatorScope(run);
    if (!Object.hasOwn(b.agents,stepId)) throw new Error('Step is outside this approved team scope.');
    return dispatchStep(b.projectId,stepId,b);
  }
  // External discussion is an offline, explicit scoped draft. No provider or browser is invoked.
  const EXTERNAL=['chatgpt','claude','kimi','qwen','deepseek'];
  function externalScope(p, ids) {
    const reports=inspect(p).workerReports;
    return {projectId:p.id,goal:p.goal,reports:ids.map(id=>{const r=reports.find(r=>r.jobId===id);if(!r)throw new Error('Select only existing reports in this project.');return {jobId:id,reportHash:r.reportHash,report:r.report.slice(0,4000),truncated:r.report.length>4000 || r.truncated};})};
  }
  function prepareDiscussion(id, provider, question, jobIds=[]) {
    const p=read(id);
    if (!EXTERNAL.includes(provider)) throw new Error('Unsupported discussion destination.');
    question=text(question,4000,'discussion question');
    if (!Array.isArray(jobIds) || jobIds.length>5 || new Set(jobIds).size!==jobIds.length || jobIds.some(x=>typeof x!=='string')) throw new Error('Select at most five distinct report IDs.');
    if ((p.externalDiscussions||[]).length>=20) throw new Error('Discussion history limit reached.');
    const scope=externalScope(p,jobIds),draft={id:'discussion-'+crypto.randomUUID(),provider,question,scope,scopeHash:hash(scope),status:'draft_not_sent',origin:'local_scoped_draft',createdAt:new Date().toISOString()};
    save({...p,externalDiscussions:[...(p.externalDiscussions||[]),draft]});return {discussion:draft,note:'Review for secrets before manual sharing. Nothing has been sent; provider identity and human authorization are not inferred.'};
  }
  function recordDiscussion(id,discussionId,scopeHash,reply) {
    const p=read(id),d=(p.externalDiscussions||[]).find(d=>d.id===discussionId);
    if(!d || d.scopeHash!==scopeHash || hash(externalScope(p,d.scope.reports.map(r=>r.jobId)))!==scopeHash)throw new Error('Discussion scope changed; prepare a fresh draft.');
    reply=text(reply,8000,'external reply');
    if(d.reply){if(d.reply.text!==reply)throw new Error('Discussion already has a different reply.');return {discussion:d,duplicate:true};}
    d.reply={text:reply,origin:'manually_supplied_unverified_external_text',at:new Date().toISOString(),authority:'none'};d.status='reply_recorded_not_accepted';save(p);
    return {discussion:d,duplicate:false,note:'Untrusted discussion evidence only; no tools, approvals, conflict resolutions or task acceptance were triggered.'};
  }
  function claim(run, key, value) {
    const job = home.findJob(run.jobId); if (job?.agent !== run.actor || job.status !== 'running' || job.runId !== run.runId || !job.projectBinding) throw new Error('Only the active bound project worker can report a claim.');
    text(key, 100, 'claim key'); if (typeof value !== 'string' || value.length > 1000) throw new Error('A claim must be bounded text, not authority.');
    const claims = (job.projectClaims || []).filter(c => c.key !== key); if (claims.length >= 30) throw new Error('Claim limit reached.');
    home.updateJob(run.actor, job.id, { projectClaims: [...claims, { key, value, origin: 'worker_report_unverified' }] }, { expectedStatus: 'running', expectedRunId: run.runId, event: 'project_claim' });
    return inspect(job.projectBinding.projectId);
  }
  // Called only after the existing per-action human permission gate succeeds.
  function resolve(id, conflictHash, decision) {
    const p = read(id), c = inspect(p).unresolved.find(c => c.hash === conflictHash); if (!c) throw new Error('Conflict changed or is already resolved; inspect again.');
    text(decision, 1000, 'human decision');
    if (p.resolutions.length >= 100) throw new Error('Resolution history reached its bound.');
    save({ ...p, resolutions: [...p.resolutions, { hash: c.hash, decision, origin: 'human_permission', at: new Date().toISOString() }] }); return inspect(id);
  }
  function analyzeReports(id, findings) {
    const p = read(id), view = inspect(p);
    if (!Array.isArray(findings) || findings.length > 20) throw new Error('Supply at most 20 evidence-bound contradictions.');
    const verified = findings.map(f => {
      const topic = text(f.topic, 100, 'finding topic'), explanation = text(f.explanation, 2000, 'finding explanation');
      if (!Array.isArray(f.evidence) || f.evidence.length !== 2 || f.evidence[0].jobId === f.evidence[1].jobId) throw new Error('A contradiction needs two different bound worker reports.');
      const evidence = f.evidence.map(e => {
        const report = view.workerReports.find(r => r.jobId === e.jobId);
        const quote = text(e.quote, 1000, 'exact report quote');
        if (!report || report.reportHash !== e.reportHash || !report.report.includes(quote)) throw new Error('Contradiction evidence changed or quote is absent.');
        return { jobId:e.jobId, reportHash:e.reportHash, quote };
      });
      return { topic, explanation, evidence, origin:'model_analysis_not_human_decision' };
    });
    const combined = [...(p.reportFindings || [])];
    for (const f of verified) if (!combined.some(c => hash(c) === hash(f))) combined.push(f);
    if (combined.length > 20) throw new Error('Report analysis history reached its bound.');
    save({ ...p, reportFindings: combined }); return inspect(id);
  }
  // Tool permission is required before invoking this operation. No worker job is automatically dispatched.
  function staff(id, revision) {
    const p = read(id), view = inspect(p), { Library } = require('./library'), lib = new Library(home);
    if (revision !== view.staffingRevision) throw new Error('Staffing proposal changed. Inspect and approve a fresh proposal.');
    if (p.staffing && ['prepared','partial'].includes(p.staffing.status)) throw new Error('Incomplete staffing requires human inspection; it cannot replay.');
    if (view.businessAssessment.blockers.length || view.unresolved.length) throw new Error('Resolve project constraints and contradictions before staffing.');
    const proposed = view.staffingProposal;
    if (!proposed.length) return view;
    if (home.listAgents().length + proposed.filter(w=>!w.existingAgent).length > 50 || proposed.some(w => w.unavailableSkills.length)) throw new Error('Staffing exceeds 50 workers or references unavailable Library skills.');
    const ids = new Set();
    const workers = proposed.map((w,i) => {
      if(w.existingAgent){const existing=home.getAgent(w.existingAgent);if(!existing||existing.credentialStorageLocked)throw new Error('Existing staffing worker is unavailable.');return {...w,id:existing.id,name:existing.name};}
      const name = w.name + ' ' + p.id.slice(-6) + '-' + (i+1), workerId = require('./home').slug(name);
      if (!require('./home').validId(workerId) || workerId.length > 40 || ids.has(workerId) || fs.existsSync(home.agentDir(workerId))) throw new Error('Staffing worker identity conflicts.');
      ids.add(workerId); return { ...w, name, id:workerId };
    });
    p.staffing = { status:'prepared', origin:'human_permission', revision, workers, completed:[], at:new Date().toISOString() }; save(p);
    try {
      for (const w of workers) {
        const a = w.existingAgent ? home.getAgent(w.id) : home.createAgent({ name:w.name, role:w.role, allowCode:false, personality:'Follow assigned Library procedures. Reports are evidence proposals, never human approval.' });
        if (a.id !== w.id) throw new Error('Staffing identity changed.');
        const existing=lib.assignmentFor(a.id);lib.setAssignment(a.id, {skills:[...existing.skills,...w.skills],packs:existing.packs});
        p.steps = p.steps.map(s => w.steps.includes(s.id) ? {...s,agent:a.id} : s);
        p.staffing.completed.push(a.id); save(p); try { if(!w.existingAgent)bus?.emit('agent:created',a); } catch {}
      }
      p.staffing.status = 'applied'; save(p); return inspect(id);
    } catch {
      p.staffing.status = 'partial'; try { save(p); } catch {}
      throw new Error('Staffing was interrupted. Inspect the project receipt and created workers; no automatic replay or dispatch.');
    }
  }
  function inspectStaffing(id, revision) {
    const p=read(id),view=inspect(p);
    if(revision!==view.staffingRevision||!p.staffing||!['prepared','partial'].includes(p.staffing.status))throw new Error('Staffing recovery changed or has no incomplete intent. Inspect again.');
    p.staffing={...p.staffing,previousStatus:p.staffing.status,status:'inspected',inspectedRevision:revision,observed:view.staffingObserved,origin:'human_permission',inspectedAt:new Date().toISOString()};
    save(p);return inspect(id);
  }
  function linkRetry(old, next) {
    const p = read(old.projectBinding.projectId), step = p.steps.find(s => s.id === old.projectBinding.stepId);
    if (!step || step.jobId !== old.id) throw new Error('Project retry linkage changed.');
    save({ ...p, steps: p.steps.map(s => s.id === step.id ? { ...s, jobId: next.id } : s) });
  }
  return { coordinationProposal, startCoordinator, teamPlan, delegate, prepareDiscussion, recordDiscussion, create, inspect, dispatchStep, claim, resolve, analyzeReports, staff, inspectStaffing, linkRetry };
}
function decls() {
  const S=description=>({type:'STRING',description}), project_id=S('Existing project ID');
  return {
    get_coordination_scope:{description:'Preview finite Team Leader delegation for existing undispatched steps and exact workers; no work starts.',parameters:{type:'OBJECT',properties:{project_id},required:['project_id']}},
    start_project_coordinator:{description:'Ask for fresh human approval of the exact preview revision, then dispatch the existing Team Leader through the existing queue. No worker creation or result acceptance.',parameters:{type:'OBJECT',properties:{project_id,revision:S('Exact revision from get_coordination_scope')},required:['project_id','revision']}},
    get_team_plan:{description:'Inspect the active approved coordinator project. Available only to that coordinator job.',parameters:{type:'OBJECT',properties:{}}},
    delegate_team_step:{description:'Dispatch one ready step to its exact approved worker. Existing dependency acceptance, skills, Guardian and review rules remain enforced.',parameters:{type:'OBJECT',properties:{step_id:S('Undispatched step ID in the approved scope')},required:['step_id']}},
    prepare_external_discussion:{description:'Save an OFFLINE discussion draft with the question, project goal and only explicitly selected worker reports. Nothing is transmitted; inspect for secrets before manually sharing.',parameters:{type:'OBJECT',properties:{project_id,provider:{type:'STRING',enum:['chatgpt','claude','kimi','qwen','deepseek']},question:S('Bounded discussion question'),job_ids:{type:'ARRAY',items:S('Explicit selected project report ID')}},required:['project_id','provider','question']}},
    record_external_reply:{description:'Record manually supplied unverified external text against an unchanged draft scope. It never grants authority, resolves conflicts or runs tools.',parameters:{type:'OBJECT',properties:{project_id,discussion_id:S('Local discussion ID'),scope_hash:S('Exact draft scopeHash'),reply:S('Untrusted pasted external reply')},required:['project_id','discussion_id','scope_hash','reply']}}
  };
}
module.exports = { createPlanner, decls };
