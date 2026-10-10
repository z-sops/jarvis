'use strict';
// The main-process side of the Workspace screen, the usage meter, the Logs tab and the Stop button.
const { createWorkspace } = require('./workspace');
const { createUsage } = require('./usage');
const { createAudit } = require('./audit');

const makeUsage = ({ home }) => createUsage({ file: () => home.p('logs', 'usage.json') });

// What Orbit did, as a list: every finished tool call, every job assigned and finished.
function makeAudit({ home, bus }) {
  const audit = createAudit({ file: () => home.p('logs', 'actions.jsonl') });
  bus.on('tool', e => { if (e.status === 'start' || /^browser_/.test(e.name)) return; audit.add({ kind: 'tool', actor: e.actorName || e.actor, name: e.name, status: e.status, ms: e.ms, detail: e.args ? JSON.stringify(e.args) : undefined, reason: e.reason }); });
  bus.on('browser:action', e => audit.add({ kind: 'browser', actor: e.actorName || e.actor, action: e.action, status: e.status, detail: e.target, reason: e.detail }));
  bus.on('connector:action', e => audit.add({ kind: 'connector', action: e.action, status: e.status, detail: `${e.id}${e.detail ? ': ' + e.detail : ''}` }));
  bus.on('job:created', ({ agent, job }) => audit.add({ kind: 'job', event: 'assigned', agent: agent.name, task: job.task }));
  bus.on('job:done', ({ agent, job }) => audit.add({ kind: 'job', event: job.status, agent: agent.name, task: job.task, error: job.error }));
  bus.on('job:reviewed', ({ agent, job }) => audit.add({ kind: 'job', event: job.status, agent: agent.name, task: job.task, detail: job.completionKind || (job.status === 'rejected' ? 'human_rejected' : job.history?.at(-1)?.event || 'review_updated') }));
  bus.on('job:step', ({ agent, n, what, sinceLastMs, totalMs }) => audit.add({ kind: 'tool', actor: agent.name, name: 'step', status: 'done', ms: sinceLastMs, detail: `#${n} ${what || 'step'} (${(totalMs / 1000).toFixed(1)}s into the job)` }));
  bus.on('crew-config:applied', e => audit.add({ kind: 'configuration', event: 'crew_import', status: 'applied', detail: `${e.changed} field change(s); receipt ${e.receiptId}` }));
  return audit;
}

// Lets the Stop button end a typed chat turn: the turn checks stopped() between its steps.
function chatGuard(bus) {
  let active = 0, flag = false;
  return {
    begin() { active++; flag = false; bus.emit('busy'); },
    end() { active = Math.max(0, active - 1); if (!active) flag = false; bus.emit('busy'); },
    stop() { if (!active) return false; flag = true; return true; },
    stopped: () => flag, active: () => active > 0
  };
}

function register({ ipcMain, shell, home, bus, send, workers, usage, audit, chat, getCfg }) {
  const ws = createWorkspace({ root: () => home.p('workspace'), agents: () => home.listAgents().map(a => ({ id: a.id, name: a.name, role: a.role })) });
  const guard = fn => (...a) => { try { return { ok: true, ...fn(...a) }; } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'That file is gone.' : e.message }; } };

  ipcMain.handle('ws:tree', guard(() => ws.tree()));
  ipcMain.handle('ws:read', guard((_e, rel) => ({ file: ws.read(rel) })));
  ipcMain.handle('ws:write', guard((_e, rel, text) => ({ saved: ws.write(rel, text) })));
  ipcMain.handle('ws:reveal', guard((_e, rel) => { shell.showItemInFolder(ws.reveal(rel)); return {}; }));
  ipcMain.handle('ws:openRoot', guard(() => { shell.openPath(ws.reveal('')); return {}; }));
  let stopWatch = null;
  ipcMain.handle('ws:watch', (_e, on) => { if (stopWatch) { stopWatch(); stopWatch = null; } if (on) stopWatch = ws.watch(() => send('ws:changed', {})); return true; });

  const Quota = require('./quota'), snap = () => { const s = usage.snapshot(); try { const c = getCfg ? getCfg() : {}; s.quota = Quota.view(s, Quota.loadLimits(home.p('usage-limits.json')), { focus: [c.textModel] }); } catch { /* the plain numbers still show */ } return s; };
  ipcMain.handle('usage:get', () => snap());
  let last = 0, pending = null;
  usage.onChange(() => {
    const push = () => { pending = null; last = Date.now(); send('usage', snap()); };
    if (Date.now() - last > 1000) push(); else if (!pending) pending = setTimeout(push, 1000);
  });

  ipcMain.handle('logs:tail', (_e, n) => audit.tail(Math.min(500, Math.max(1, +n || 200))));
  ipcMain.handle('logs:reveal', () => { shell.showItemInFolder(home.p('logs', 'actions.jsonl')); return true; });
  audit.on(e => send('audit', e));

  const busyNow = () => ({ crew: [...workers.states.values()].filter(s => s.state === 'working').length + (workers.qaPending?.() ? 1 : 0), chat: chat.active() });
  ipcMain.handle('busy:get', () => busyNow());
  ipcMain.handle('stop:all', () => { const crew = workers.cancelAll(), stopped = chat.stop(); bus.emit('stop:pressed', {}); audit.add({ kind: 'stop', detail: `Stop pressed: ${crew} crew job(s) stopped, typed chat ${stopped ? 'stopped' : 'was idle'}` }); return { crew, chat: stopped }; });
  ipcMain.handle('stop:agent', (_e, id) => { const n = workers.cancel(String(id)); bus.emit('stop:pressed', { agent: String(id) }); audit.add({ kind: 'stop', detail: `Stop pressed for one crew member (${id}): ${n} job(s) stopped` }); return { cancelled: n }; });
  let bt = null; const pushBusy = () => { clearTimeout(bt); bt = setTimeout(() => send('busy', busyNow()), 80); };
  bus.on('agent:state', pushBusy); bus.on('busy', pushBusy);

  return { ws, busyNow };
}

module.exports = { register, makeUsage, makeAudit, chatGuard };
