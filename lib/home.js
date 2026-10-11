'use strict';
// The "home" folder: every agent (and the commander AI itself) is a folder with brain / jobs / skills.
const fs = require('fs');
const path = require('path');

const COMMANDER = 'jarvis'; // folder name for the main AI, whatever the user calls it
const COLORS = ['#6FE3E0', '#FFB23E', '#B69CFF', '#7BD88F', '#FF8FA3', '#8CB8FF', '#FFD86B', '#F59E6B'];
const STATION_COUNT = 6;

const slug = s => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
const validId = id => /^[a-z0-9][a-z0-9-]{0,40}$/.test(id || '');

const TEMPLATE_RULES = `# Standing rules
- Do the task with the tools you have. Never say something is done unless a tool result confirms it.
- Save every file you produce inside your workspace folder and say where it is.
- If you are blocked, say exactly what is missing instead of guessing.
- Keep your final report short: what you did, where the output is, anything that needs a decision.
`;

class Home {
  constructor(root, { secretStorage = null } = {}) { this.root = root; this.recoveryFaults = new Map(); this.secretStorage = secretStorage; }
  p(...a) { return path.join(this.root, ...a); }

  ensure() {
    const dirs = [
      'jarvis/brain/memory', 'jarvis/jobs', 'jarvis/skills', 'agents',
      'templates/agent-template/brain', 'templates/agent-template/jobs', 'templates/agent-template/skills',
      'workspace'
    ];
    for (const d of dirs) fs.mkdirSync(this.p(d), { recursive: true });
    const tpl = (f, txt) => { const fp = this.p('templates/agent-template', f); if (!fs.existsSync(fp)) require('./managed-write').writeFileSync(fp, txt); };
    tpl('brain/rules.md', TEMPLATE_RULES);
    tpl('brain/soul.md', '# Soul\n(Filled in when the agent is created.)\n');
    tpl('skills/README.md', 'Each file in this folder is one skill: a short set of instructions the agent follows when relevant.\n');
    tpl('jobs/README.md', 'Each job is a JSON file: task, status, result.\n');
    const cr = this.p('jarvis/brain/rules.md');
    if (!fs.existsSync(cr)) require('./managed-write').writeFileSync(cr, TEMPLATE_RULES);
    return this;
  }

  writeCommanderSoul(cfg, force = false) {
    const fp = this.p('jarvis/brain/soul.md');
    if (fs.existsSync(fp) && !force) return;
    require('./managed-write').writeFileSync(fp, `# ${cfg.aiName}\n\nYou are ${cfg.aiName}, the ship's chief of staff.\n\n` +
`## Character\n- Warm, quick, a little dry. Confident without being stiff.\n- Genuinely reacts: pleased when things go well, concerned when the plan is risky, playful when the mood is light.\n- Loyal to ${cfg.userName}'s goals, but says so plainly when an idea has a problem.\n\n` +
`## Edit this file to change how ${cfg.aiName} behaves. It is read at the start of every session.\n`);
  }

  // ---------- agents ----------
  agentDir(id) {
    if (id === COMMANDER) return this.p('jarvis');
    if (!validId(id)) throw new Error(`Invalid agent id "${id}"`);
    return this.p('agents', id);
  }
  hasAgent(id) { try { return id === COMMANDER || fs.existsSync(path.join(this.agentDir(id), 'agent.json')); } catch { return false; } }
  decodeAgent(saved, strict = false) {
    const agent = { ...saved }; delete agent._orbitSecrets;
    if (Object.hasOwn(saved, '_orbitSecrets') || (this.secretStorage && saved.workerApiKey && !this.secretStorage.available())) {
      try {
        if (!this.secretStorage) throw new Error('locked');
        if (saved._orbitSecrets) agent.workerApiKey = this.secretStorage.open(saved._orbitSecrets).workerApiKey;
        else throw new Error('locked');
      } catch {
        if (strict) throw new Error('Worker credential storage is locked. Existing agent file preserved.');
        delete agent.workerApiKey; agent.credentialStorageLocked = true;
      }
    }
    return agent;
  }
  saveAgent(file, agent) {
    const saved = { ...agent }; delete saved.credentialStorageLocked;
    if (this.secretStorage && saved.workerApiKey) { saved._orbitSecrets = this.secretStorage.seal({ workerApiKey: saved.workerApiKey }); delete saved.workerApiKey; }
    require('./job-storage').atomicWrite(file, saved); return agent;
  }
  protectAgents() {
    if (!this.secretStorage) return;
    for (const agent of this.listAgents()) {
      if (agent.credentialStorageLocked) throw new Error('Worker credential storage is locked.');
      if (agent.workerApiKey) this.saveAgent(path.join(this.agentDir(agent.id), 'agent.json'), agent);
    }
  }
  listAgents() {
    const dir = this.p('agents');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
      .map(d => { try { return this.decodeAgent(JSON.parse(fs.readFileSync(path.join(dir, d.name, 'agent.json'), 'utf8').replace(/^\uFEFF/, ''))); } catch { return null; } })
      .filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  getAgent(idOrName) {
    const key = String(idOrName || '').trim().toLowerCase();
    if (!key) return null;
    const all = this.listAgents();
    return all.find(a => a.id === key) || all.find(a => a.name.toLowerCase() === key) || all.find(a => slug(a.name) === slug(key)) || null;
  }
  createAgent({ name, role = 'General assistant', personality = '', skills = [], allowCode }) {
    name = String(name || '').trim();
    if (!name) throw new Error('Agent needs a name');
    let base = slug(name) || 'agent'; let id = base; let n = 2;
    while (fs.existsSync(this.p('agents', id))) id = `${base}-${n++}`;
    const dir = this.p('agents', id);
    fs.cpSync(this.p('templates/agent-template'), dir, { recursive: true });
    const count = this.listAgents().length;
    const agent = { id, name, role, color: COLORS[count % COLORS.length], station: count % STATION_COUNT, createdAt: new Date().toISOString(), ...(allowCode === false ? { allowCode: false } : {}) };
    require('./managed-write').writeFileSync(path.join(dir, 'agent.json'), JSON.stringify(agent, null, 2));
    require('./managed-write').writeFileSync(path.join(dir, 'brain/soul.md'),
      `# ${name}\n\nRole: ${role}\n\n${personality || `${name} is focused, reliable and to the point.`}\n`);
    for (const s of skills) if (String(s).trim()) this.addSkill(id, String(s).trim(), `Be proficient in: ${String(s).trim()}. Apply it whenever a task calls for it.`);
    fs.mkdirSync(this.p('workspace', id), { recursive: true });
    return agent;
  }
  // Per-agent overrides of the crew-wide engine/model (Settings > Crew engine is the default every
  // agent falls back to). A blank/omitted field means "inherit the crew default" -- it is deleted
  // from agent.json, never stored as ''. Only these fields are editable this way.
  updateAgent(id, patch = {}) {
    const ALLOWED = ['engine', 'workerProvider', 'workerModel', 'workerApiKey', 'workerBaseUrl', 'workerContext', 'allowCode', 'desiredLifecycle'];
    if ('desiredLifecycle' in patch&&!['ready','paused'].includes(patch.desiredLifecycle))throw new Error('Invalid desired worker lifecycle.');
    const fp = path.join(this.agentDir(id), 'agent.json');
    if (!fs.existsSync(fp)) throw new Error(`Unknown agent ${id}`);
    const agent = this.decodeAgent(JSON.parse(fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '')), true);
    const previousLifecycle=agent.desiredLifecycle||'ready';
    for (const k of ALLOWED) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v === '' || v == null) delete agent[k]; else agent[k] = v;
    }
    if('desiredLifecycle' in patch)agent.lifecycleHistory=[...(Array.isArray(agent.lifecycleHistory)?agent.lifecycleHistory:[]).slice(-49),{previous:previousLifecycle,desired:patch.desiredLifecycle,at:new Date().toISOString(),source:'local_configuration_update_not_permission_grant'}];
    return this.saveAgent(fp, agent);
  }

  // ---------- skills / memory / brain ----------
  addSkill(agentId, name, instructions) {
    const dir = path.join(this.agentDir(agentId), 'skills');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slug(name) || 'skill'}.md`);
    require('./managed-write').writeFileSync(file, `# ${name}\n\n${instructions}\n`);
    return file;
  }
  readSkills(agentId) {
    const dir = path.join(this.agentDir(agentId), 'skills');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
      .map(f => ({ name: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  }
  appendMemory(agentId, note) {
    const dir = path.join(this.agentDir(agentId), 'brain/memory'), { Notes } = require('./memory');
    fs.mkdirSync(dir, { recursive: true }); new Notes(path.join(dir, 'notes.md')).add(note, { origin: 'model' });   // model/runtime notes never become user rules
  }
  readMemory(agentId, maxChars = 6000) {
    const fp = path.join(this.agentDir(agentId), 'brain/memory/notes.md');
    if (!fs.existsSync(fp)) return '';
    const M = require('./memory'); return M.promptText(M.parseNotes(fs.readFileSync(fp, 'utf8')), { max: maxChars });   // pinned rules first, then the newest notes
  }
  readBrain(agentId) {
    const d = path.join(this.agentDir(agentId), 'brain');
    const r = f => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { return ''; } };
    return `${r('soul.md')}\n${r('rules.md')}`.trim();
  }
  topics() { const { Topics } = require('./topics'); return new Topics(path.join(this.agentDir('jarvis'), 'topics'), { legacyFile: this.p('jarvis/brain/memory/conversation.json') }); }
  readConversation() { try { return this.topics().history(40); } catch { return []; } }
  saveConversation(list) { if (!list.length) { try { this.topics().clearCurrent(); } catch { /* nothing to clear */ } } }   // the messages themselves are kept by the chat screen (voice and text alike), in the current topic

  // ---------- jobs ----------
  createJob(agentId, task, options) { return require('./job-storage').createJob(this, agentId, task, options); }
  updateJob(agentId, jobId, patch, options) { return require('./job-storage').updateJob(this, agentId, jobId, patch, options); }
  listJobs(agentId, limit = 10) {
    const dir = path.join(this.agentDir(agentId), 'jobs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      .map(f => { try { return require('./job-storage').readJob(this, agentId, f.slice(0, -5)); } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  findJob(jobId) {
    for (const id of [COMMANDER, ...this.listAgents().map(a => a.id)]) {
      try { return require('./job-storage').readJob(this, id, jobId); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return null;
  }
  recoverJobs() {
    const recovered = [];
    this.recoveryFaults.clear();
    for (const actor of [COMMANDER, ...this.listAgents().map(a => a.id)]) {
      const dir = path.join(this.agentDir(actor), 'jobs'), jobs = [];
      if (!fs.existsSync(dir)) continue;
      let names;
      try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')); }
      catch { this.recoveryFaults.set(actor, 'Job storage could not be read. Repair it and restart Orbit before running this worker.'); continue; }
      for (const name of names) {
        try { jobs.push(require('./job-storage').readJob(this, actor, name.slice(0, -5))); }
        catch { this.recoveryFaults.set(actor, 'An unreadable or invalid job record was found. This worker is blocked until its job storage is repaired and Orbit restarts.'); }
      }
      for (const job of jobs) {
        try {
        if (job.containment && job.containment.status !== 'stopped') this.recoveryFaults.set(actor, 'Native container cleanup is unknown. Restore Docker and reconcile before retrying this worker.');
        if (job.status === 'review' && ['awaiting_approval', 'running'].includes(job.qa?.test?.status)) recovered.push(this.updateJob(actor, job.id, { qa: { ...job.qa, test: { ...job.qa.test, status: 'unknown', error: 'Orbit restarted during QA. Inspect prior test effects before approving another run.' } } }, { expectedStatus: 'review', event: 'qa_restart_unknown' }));
        if (job.status === 'retrying') {
          const children = jobs.filter(j => j.retryOf === job.id);
          if (children.length === 1 && job.retryIntent?.version === 1) { require('./job-retry').complete(this, job, children[0]); recovered.push(this.updateJob(actor, job.id, { status: 'retried', retryJobId: children[0].id }, { expectedStatus: 'retrying', event: 'retry_reconciled' })); }
          else if (children.length === 1 && ['queued','interrupted'].includes(children[0].status) && !job.retryIntent && !children[0].nativeBridge && !job.nativeBridge && !job.projectBinding && !job.tokenBudget) recovered.push(this.updateJob(actor, job.id, { status: 'retried', retryJobId: children[0].id }, { expectedStatus: 'retrying', event: 'legacy_retry_reconciled' }));
          else recovered.push(this.updateJob(actor, job.id, { status: 'interrupted', recoveryNeeded: true, error: 'Retry setup was interrupted. Inspect the job records before retrying.' }, { expectedStatus: 'retrying', event: 'retry_interrupted' }));
        }
        if (job.status === 'running') recovered.push(this.updateJob(actor, job.id, require('./job-outcomes').outcomePatch(job, {
          status: 'interrupted', interruptedAt: new Date().toISOString(), recoveryNeeded: true,
          error: 'Orbit restarted before this job settled. Inspect its files before retrying; an action may already have happened.'
        }), { expectedStatus: 'running', event: 'restart_interrupted' }));
        else if (job.status === 'queued' && !job.recoveryNeeded) recovered.push(this.updateJob(actor, job.id, {
          recoveryNeeded: true, error: 'This job was waiting when Orbit stopped. Retry explicitly to put it back in the queue.'
        }, { expectedStatus: 'queued', event: 'restart_queued' }));
        } catch { this.recoveryFaults.set(actor, 'Job recovery could not be saved. Repair storage and restart Orbit before running this worker.'); }
      }
    }
    return recovered;
  }
  assertJobsHealthy(actor) { if (this.recoveryFaults.has(actor)) throw new Error(this.recoveryFaults.get(actor)); }
}

module.exports = { Home, COMMANDER, slug, validId };
