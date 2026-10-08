'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { createTools } = require('../lib/tools');
const { createWorkers } = require('../lib/workers');
const { buildCommanderPrompt, buildAgentPrompt } = require('../lib/persona');

function rig(answer) {
  const asked = [], home = new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-js-')), 'BridgeHome')).ensure(); home.createAgent({ name: 'Alex', role: 'Developer' });
  const cfg = { aiName: 'Laila', gender: 'female', userName: 'Zee', userTitle: '', lang: 'mix', engine: 'hermes', apiKey: 'k', textModel: 'm' };
  const bus = new EventEmitter(), runtime = {}, hermes = { runTask: (a, t, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(signal.reason))) };
  const tools = createTools({ home, getCfg: () => cfg, gemini: {}, bus, ask: async r => { asked.push(r); return answer; }, runtime, openExternal: async () => {}, shell: (c, o, cb) => cb(null, '', '') });
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: {}, tools, bus, hermes });
  Object.assign(runtime, { dispatch: workers.dispatch, cancel: workers.cancel, stateOf: workers.stateOf });
  return { home, cfg, tools, asked };
}

test('stopping a crew member\'s work asks first and the question shows WHICH job would stop; a no changes nothing', async () => {
  const r = rig('deny'); await r.tools.exec('assign_task', { agent: 'alex', task: 'Create a folder named vortex inside the folder named faisal' });
  const no = await r.tools.exec('cancel_job', { agent: 'alex' }); assert.equal(no.ok, false); assert.match(no.error, /declined/); assert.equal(r.asked.length, 1);
  assert.match(r.asked[0].title, /^Stop a crew agent's work$/); assert.match(r.asked[0].detail, /^Alex:\nrunning: Create a folder named vortex inside the folder named faisal$/, 'the question says who and which job'); assert.equal(r.home.listJobs('alex', 5)[0].status, 'running', 'still running after a no');
  const y = rig('once'); await y.tools.exec('assign_task', { agent: 'alex', task: 'first' }); await y.tools.exec('assign_task', { agent: 'alex', task: 'second' });
  const yes = await y.tools.exec('cancel_job', { agent: 'alex' }); assert.equal(yes.ok, true); assert.equal(yes.cancelled_jobs, 2); assert.match(y.asked[0].detail, /running: first\nqueued: second/, 'both the running and the waiting job are listed');
  const idle = rig('deny'); const none = await idle.tools.exec('cancel_job', { agent: 'nobody' }); assert.equal(none.ok, false);
});

test('list_jobs says how long each job has run (so she can answer "why so long?" with a number)', async () => {
  const r = rig('once'); await r.tools.exec('assign_task', { agent: 'alex', task: 'a slow one' }); const job = r.home.listJobs('alex', 5)[0];
  r.home.updateJob('alex', job.id, { startedAt: new Date(Date.now() - 100000).toISOString() }); const run = (await r.tools.exec('list_jobs', { agent: 'alex' })).jobs[0]; assert.equal(run.status, 'running'); assert.ok(run.seconds >= 99 && run.seconds <= 103, 'running for ' + run.seconds); assert.match(run.note, /running for this many seconds so far/);
  r.home.updateJob('alex', job.id, { status: 'done', startedAt: '2026-09-21T14:25:05.000Z', finishedAt: '2026-09-21T14:27:38.000Z' }); const done = (await r.tools.exec('list_jobs', { agent: 'alex' })).jobs[0]; assert.equal(done.seconds, 153, 'the 153 seconds of the "faisal" job'); assert.equal(done.note, undefined);
  r.home.updateJob('alex', job.id, { status: 'queued', startedAt: undefined, finishedAt: undefined }); assert.equal((await r.tools.exec('list_jobs', {})).jobs[0].seconds, null, 'not started: no time');
});

test('the prompts say it: a complaint about speed is not "cancel", and crew members do not try execute_code', () => {
  const cfg = { aiName: 'Laila', gender: 'female', userName: 'Zee', userTitle: '', lang: 'mix', style: 'casual', emotion: 'expressive' }, home = new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-jp-')), 'BridgeHome')).ensure(), a = home.createAgent({ name: 'Alex', role: 'Developer' });
  const lp = buildCommanderPrompt(cfg, home); assert.match(lp, /Complaints about speed \("too long", "slow", "itna time kyun"\) are NOT a request to cancel/); assert.match(lp, /list_jobs shows seconds and status/);
  const ap = buildAgentPrompt(cfg, home, a); assert.match(ap, /execute_code is blocked here/); assert.match(ap, /use the terminal tool for commands and the file tools for files/); assert.ok(ap.indexOf('execute_code is blocked') < ap.indexOf('## Your character and rules'), 'it comes before the character file');
});
