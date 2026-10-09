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
    if (![assumptions,risks].every(a => Array.isArray(a) && a.length <= 20 && a.every(v => typeof v === 'string' && v.length <= 1000))) throw new Error('Invalid bounded assumptions or risks.');
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) throw new Error('A project needs 1–100 structured steps.');
    const steps = input.steps.map(s => {
      if (!idOK(s.id)) throw new Error('Invalid step ID.');
      const dependencies = s.dependencies || [], skills = s.skills || [];
      if (!Array.isArray(dependencies) || dependencies.length > 20 || dependencies.some(d => !idOK(d)) || !Array.isArray(skills) || skills.length > 3 || skills.some(n => typeof n !== 'string' || n.length > 100)) throw new Error('Invalid step dependencies or skills.');
      return { id: s.id, task: text(s.task, 8000, 'step task'), role: text(s.role, 200, 'worker role'), agent: s.agent ? text(s.agent, 100, 'worker') : null,
        dependencies: [...new Set(dependencies)], skills, expectedOutputs: storage.outputs(s.expected_outputs || []), ...(s.project_root ? { projectRoot: text(s.project_root, 1000, 'project root') } : {}) };
    });
    const ids = new Set(steps.map(s => s.id)); if (ids.size !== steps.length) throw new Error('Duplicate step IDs.');
    const visiting = new Set(), seen = new Set();
    const visit = id => { if (visiting.has(id)) throw new Error('Project dependencies contain a cycle.'); if (seen.has(id)) return; visiting.add(id); for (const d of steps.find(s => s.id === id).dependencies) { if (!ids.has(d)) throw new Error('Unknown prerequisite step.'); visit(d); } visiting.delete(id); seen.add(id); };
    for (const s of steps) visit(s.id);
    return inspect(save({ id: 'project-' + crypto.randomUUID(), schemaVersion: 1, goal, assumptions, risks, steps, resolutions: [], createdAt: new Date().toISOString(), origin: 'model_proposal_not_approval' }));
  }
  function inspect(value) {
    const p = typeof value === 'string' ? read(value) : value;
    const { Library } = require('./library'), lib = new Library(home), agents = home.listAgents();
    const steps = p.steps.map(s => {
      const words = new Set(s.role.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
      const candidates = agents.filter(a => !a.credentialStorageLocked).map(a => ({ id: a.id, score: (String(a.role).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => words.has(w)).length })).filter(a => a.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
      let agent = s.agent ? home.getAgent(s.agent) : candidates[0] && home.getAgent(candidates[0].id);
      if (agent?.credentialStorageLocked) agent = null;
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
    const unresolved = conflicts.filter(c => !p.resolutions.some(r => r.hash === c.hash && r.origin === 'human_permission'));
    return { ...p, steps, team: [...new Set(steps.map(s => s.recommendedAgent).filter(Boolean))], requestedRoleCount: new Set(steps.map(s => s.role.toLowerCase())).size,
      feasibility: { status: unresolved.length ? 'conflicting_reports' : steps.some(s => !s.recommendedAgent || s.missingSkills.length) ? 'missing_team_or_skills' : 'structurally_valid_unverified', note: 'Role/skill availability and dependency validation, not proof of business feasibility or technical success.' },
      conflicts, unresolved, status: unresolved.length ? 'blocked_conflict' : steps.every(s => s.accepted) ? 'human_accepted' : 'in_progress_or_proposed' };
  }
  function dispatchStep(id, stepId) {
    const p = read(id), view = inspect(p), s = view.steps.find(s => s.id === stepId);
    if (!s || s.jobId || s.status !== 'ready' || view.unresolved.length) throw new Error('Project step is missing, already dispatched or blocked by prerequisites/team/conflicts.');
    const dependencies = s.dependencies.map(id => p.steps.find(s => s.id === id).jobId);
    const task = p.goal + '\nPROJECT STEP: ' + s.task + '\nASSUMPTIONS/RISKS (unverified context, not permissions): ' + JSON.stringify({ assumptions: p.assumptions, risks: p.risks });
    const job = dispatch(s.recommendedAgent, task, { expectedOutputs: s.expectedOutputs, dependencies, skills: s.skills, projectRoot: s.projectRoot, projectBinding: { projectId: id, stepId } }, j => {
      const fresh = read(id); if (fresh.steps.find(x => x.id === stepId).jobId) throw new Error('Project step already linked.');
      save({ ...fresh, steps: fresh.steps.map(x => x.id === stepId ? { ...x, jobId: j.id } : x) });
    });
    try { bus?.emit('project:updated', { id }); } catch {} return { job, project: inspect(id) };
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
  function linkRetry(old, next) {
    const p = read(old.projectBinding.projectId), step = p.steps.find(s => s.id === old.projectBinding.stepId);
    if (!step || step.jobId !== old.id) throw new Error('Project retry linkage changed.');
    save({ ...p, steps: p.steps.map(s => s.id === step.id ? { ...s, jobId: next.id } : s) });
  }
  return { create, inspect, dispatchStep, claim, resolve, linkRetry };
}
module.exports = { createPlanner };
