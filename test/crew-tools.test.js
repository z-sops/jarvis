'use strict';
// Needs the tool and prompt edits of update 4 (cancel_job, queue note, Windows shell hint, delegation rules).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { createTools } = require('../lib/tools');
const { createWorkers } = require('../lib/workers');
const { buildCommanderPrompt } = require('../lib/persona');

function rig(answer = 'once') {
  const home = new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ct-')), 'BridgeHome')).ensure(); home.createAgent({ name: 'Bob', role: 'Tester' });
  const cfg = { aiName: 'Laila', gender: 'female', userName: 'Zee', userTitle: 'Commander', lang: 'mix', engine: 'hermes', apiKey: 'k', textModel: 'm' };
  const bus = new EventEmitter(), runtime = {}, hermes = { runTask: (a, t, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(signal.reason))) };
  const tools = createTools({ home, getCfg: () => cfg, gemini: {}, bus, ask: async r => { rig.asked.push(r); return answer; }, runtime, openExternal: async () => {}, shell: (c, o, cb) => cb(null, '', '') });
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: {}, tools, bus, hermes });
  Object.assign(runtime, { dispatch: workers.dispatch, cancel: workers.cancel, stateOf: workers.stateOf });
  return { home, cfg, tools };
}
rig.asked = [];

test('assign_task says when the agent is busy, and cancel_job stops the whole line', async () => {
  const r = rig();
  const a = await r.tools.exec('assign_task', { agent: 'bob', task: 'first' }), b = await r.tools.exec('assign_task', { agent: 'bob', task: 'second' });
  assert.equal(a.queued_behind, 0); assert.match(a.note, /Running in the background/);
  assert.equal(b.queued_behind, 1); assert.match(b.note, /busy.*waits behind 1/); assert.match(b.note, /cancel_job/);
  const c = await r.tools.exec('cancel_job', { agent: 'bob' }); assert.equal(c.ok, true); assert.equal(c.cancelled_jobs, 2);
  assert.equal((await r.tools.exec('cancel_job', { agent: 'bob' })).cancelled_jobs, 0, 'nothing left');
  assert.equal((await r.tools.exec('cancel_job', { agent: 'nobody' })).ok, false);
});

test('cancel_job belongs to the commander only, and the shell tool says it is Windows cmd.exe', () => {
  const r = rig(); const decl = who => r.tools.declarationsFor(who);
  assert.ok(decl('commander').some(d => d.name === 'cancel_job')); assert.ok(!decl('bob').some(d => d.name === 'cancel_job'));
  assert.match(decl('commander').find(d => d.name === 'run_shell').description, /cmd\.exe.*not Unix.*mkdir -p/s);
});

test('the commander is told how to share work: small jobs are offered first (even when an agent is named), unclear phrases never cancel, every tool call gets a spoken result, Windows commands', () => {
  const p = buildCommanderPrompt({ aiName: 'Laila', gender: 'female', userName: 'Zee', userTitle: 'Commander', lang: 'mix' }, rig().home);
  assert.match(p, /SMALL job/); assert.match(p, /Me or Bob\?/); assert.match(p, /This applies even when the user named a crew member/); assert.match(p, /Bob se hi karwao/);
  assert.match(p, /BIG or long jobs: give them to the named crew member/);
  assert.match(p, /use cancel_job only when the user clearly says to stop/); assert.match(p, /half-heard or unclear phrase is NOT an instruction to cancel/); assert.match(p, /walk back to the lounge on their own/);
  assert.match(p, /After EVERY tool call, tell the user the outcome/); assert.match(p, /Always say who did the work/); assert.match(p, /call the tool BEFORE you say it is done/);
  assert.match(p, /shell is Windows cmd\.exe.*never Unix ones \(mkdir -p/s);
});

test('cancel_job asks first (a mis-heard voice command must not stop a job), and does nothing if you say no', async () => {
  rig.asked.length = 0; const yes = rig('once');
  await yes.tools.exec('assign_task', { agent: 'bob', task: 'a' }); const ok = await yes.tools.exec('cancel_job', { agent: 'bob' });
  assert.equal(ok.ok, true); assert.equal(rig.asked.length, 1); assert.match(rig.asked[0].title, /Stop a crew agent/);
  rig.asked.length = 0; const no = rig('deny');
  await no.tools.exec('assign_task', { agent: 'bob', task: 'a' }); const refused = await no.tools.exec('cancel_job', { agent: 'bob' });
  assert.equal(refused.ok, false); assert.match(refused.error, /declined/); assert.equal(no.home.listJobs('bob')[0].status !== 'cancelled', true, 'the job was not cancelled');
  rig.asked.length = 0; const sess = rig('session'); await sess.tools.exec('cancel_job', { agent: 'bob' }); await sess.tools.exec('cancel_job', { agent: 'bob' }); assert.equal(rig.asked.length, 1, 'session grant sticks');
});
