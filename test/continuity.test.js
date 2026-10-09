'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cp = require('../lib/checkpoint'), jr = require('../lib/jobreport');
test('compaction and pause preserve a requirement beyond the old goal limit', () => {
  const goal = 'A'.repeat(1800) + '\nCRITICAL: preserve all original records.';
  assert.match(cp.resumeText(cp.createCard(goal)), /CRITICAL: preserve all original records/);
  const saved = jr.checkpoint({ jobId: 'job-test', task: goal, steps: [], text: '' }); assert.equal(saved.task, goal);
  assert.match(jr.resumeTask(saved), /CRITICAL: preserve all original records/);
});
test('reordered tool replies preserve failures and unresolved outcomes', () => {
  const card = cp.createCard('Check outputs');
  cp.fromConvo(card, [{ role: 'model', parts: [{ functionCall: { name: 'write_file', args: { path: 'a' } } }, { functionCall: { name: 'run_shell', args: {} } }, { functionCall: { name: 'remote', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'run_shell', response: { result: { exitCode: 2 } } } }, { functionResponse: { name: 'write_file', response: { result: { ok: true } } } }] }]);
  assert.deepEqual(card.steps.map(s => s.ok), [true, false, null]); assert.match(cp.resumeText(card), /Unknown\/pending/); assert.match(cp.resumeText(card), /Never transfer approvals/);
});
test('explicit tool error envelopes cannot become successful checkpoint steps', () => {
  for (const result of [{ ok: false }, { isError: true }, { error: 'denied' }]) {
    const card = cp.createCard('Task'); cp.fromConvo(card, [{ role: 'model', parts: [{ functionCall: { name: 'tool', args: {} } }] }, { role: 'user', parts: [{ functionResponse: { name: 'tool', response: { result } } }] }]);
    assert.equal(card.steps[0].ok, false);
  }
});

test('recovery keeps old failures, unknown calls and all paths beyond rolling anomaly window', () => {
  const card = cp.createCard('FULL_GOAL'); const convo = [];
  for (let i = 0; i < 20; i++) {
    convo.push({ role: 'model', parts: [{ functionCall: { id: 'c'+i, name: 'write_file', args: { path: 'file-'+i } } }] });
    if (i !== 0) convo.push({ role: 'user', parts: [{ functionResponse: { id: 'c'+i, name: 'write_file', response: { result: i === 1 ? { error: 'denied' } : { ok: true } } } }] });
  }
  cp.fromConvo(card, convo); assert.equal(card.steps.length, 12); assert.equal(card.outcomes.length, 20); assert.equal(card.files.length, 20);
  assert.equal(cp.canResume(card), false);
  const text = cp.resumeText(card); assert.match(text, /"id":"c0".*UNKNOWN_INSPECT_BEFORE_REPEAT/); assert.match(text, /"id":"c1".*FAILED/); assert.match(text, /file-0/);
});
test('same-name replies bind exact call IDs, never infer ambiguous or mismatched outcomes', () => {
  const calls = { role: 'model', parts: ['a', 'b'].map(id => ({ functionCall: { id, name: 'effect', args: { value: id } } })) };
  const card = cp.createCard('Task');
  cp.fromConvo(card, [calls, { role: 'user', parts: [{ functionResponse: { id: 'b', name: 'effect', response: { result: { error: 'bad' } } } }, { functionResponse: { id: 'a', name: 'effect', response: { result: { ok: true } } } }] }]);
  assert.deepEqual(card.outcomes.map(s => s.ok), [true, false]); assert.equal(cp.canResume(card), true);
  cp.fromConvo(card, [calls, { role: 'user', parts: [{ functionResponse: { id: 'wrong', name: 'effect', response: { result: { ok: true } } } }] }]);
  assert.deepEqual(card.outcomes.map(s => s.ok), [null, null]); assert.equal(card.unmatchedResponses, 1); assert.equal(cp.canResume(card), false);
  cp.fromConvo(card, [{ role: 'model', parts: [1, 2].map(() => ({ functionCall: { name: 'effect', args: {} } })) }, { role: 'user', parts: [{ functionResponse: { name: 'effect', response: { result: 'ok' } } }] }]);
  assert.deepEqual(card.outcomes.map(s => s.ok), [null, null]); assert.equal(cp.canResume(card), false);
});
test('missing results, legacy omissions and failed persistence cannot authorize automatic recovery', () => {
  const card = cp.createCard('Task');
  cp.fromConvo(card, [{ role: 'model', parts: [{ functionCall: { name: 'effect', args: {} } }] }, { role: 'user', parts: [{ functionResponse: { name: 'effect', response: {} } }] }]);
  assert.equal(card.outcomes[0].ok, null); assert.equal(cp.canResume(card), false);
  const legacy = { ...cp.createCard('Task'), steps: [{ tool: 'effect', args: {}, ok: true }], stepCount: 15 };
  assert.match(cp.resumeText(legacy), /INCOMPLETE LEGACY HISTORY/); assert.equal(cp.canResume(legacy), false);
  cp.update({ p() { throw new Error('storage unavailable'); } }, 'alex', 'job', card, { convo: [] });
  assert.equal(card.recoveryReady, false); assert.equal(cp.canResume(card), false);
});
test('continuation retains prior outcomes and fingerprints exact unshortened data', () => {
  const card = cp.createCard('Task'), args = { content: 'x'.repeat(500), path: 'old' };
  cp.fromConvo(card, [{ role: 'model', parts: [{ functionCall: { name: 'write_file', args } }] }, { role: 'user', parts: [{ functionResponse: { name: 'write_file', response: { result: { error: 'denied' } } } }] }]);
  const priorOutcomes = card.outcomes.slice(), priorFiles = card.files.slice();
  const expected = require('crypto').createHash('sha256').update(JSON.stringify(args)).digest('hex'); assert.equal(priorOutcomes[0].argsHash, expected);
  cp.fromConvo(card, [{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'new' } } }] }], { priorOutcomes, priorFiles });
  assert.equal(card.outcomes.length, 2); assert.equal(card.outcomes[0].ok, false); assert.equal(card.outcomes[1].ok, null); assert.deepEqual(card.files, ['old', 'new']);
  assert.equal(cp.canResume(card), false);
  card.goal = 'x'.repeat(140000); assert.throws(() => cp.resumeText(card), e => e.contextBudget === true);
});
test('builtin loop checkpoints pending and partial batches without replaying a failed effect', async t => {
  const old = global.fetch; t.after(() => { global.fetch = old; }); let submits = 0, effects = 0; const snapshots = [];
  global.fetch = async () => { submits++; return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: ['a', 'b'].map(id => ({ functionCall: { id, name: 'effect', args: { id } } })) } }] }), { status: 200 }); };
  await assert.rejects(require('../lib/gemini').runLoop({ cfg: { apiKey: 'synthetic', textModel: 'fixture' }, system: 'Safety', contents: [{ role: 'user', parts: [{ text: 'Goal' }] }],
    onCheckpoint: ({ convo }) => { const card = cp.fromConvo(cp.createCard('Goal'), convo); snapshots.push(JSON.parse(JSON.stringify(card))); },
    exec: async () => { effects++; if (effects === 2) throw new Error('fetch failed; outcome unknown'); return { ok: true }; } }), /outcome unknown/);
  assert.equal(submits, 1); assert.equal(effects, 2); assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0].outcomes.map(s => s.ok), [null, null]); assert.deepEqual(snapshots[1].outcomes.map(s => s.ok), [true, null]); assert.equal(cp.canResume(snapshots[1]), false);
});
test('stop between tools preserves remaining pending call and does not execute it', async t => {
  const old = global.fetch; t.after(() => { global.fetch = old; }); let stopped = false, effects = 0; const card = cp.createCard('Goal');
  global.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: ['a', 'b'].map(id => ({ functionCall: { id, name: 'effect', args: {} } })) } }] }), { status: 200 });
  const out = await require('../lib/gemini').runLoop({ cfg: { apiKey: 'synthetic', textModel: 'fixture' }, system: 'Safety', contents: [], shouldStop: () => stopped,
    onCheckpoint: ({ convo }) => cp.fromConvo(card, convo), exec: async () => { effects++; stopped = true; return { ok: true }; } });
  assert.equal(out.text, 'Cancelled.'); assert.equal(effects, 1); assert.deepEqual(card.outcomes.map(s => s.ok), [true, null]);
});
test('worker refuses transient recovery after an uncertain tool effect and persists pending evidence', async t => {
  const fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events'), { Home } = require('../lib/home');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(); home.createAgent({ name: 'Alex' }); const bus = new EventEmitter(); let calls = 0;
  const workers = require('../lib/workers').createWorkers({ home, bus, getCfg: () => ({ engine: 'builtin' }), tools: { declarationsFor: () => [] }, gemini: { runLoop: async o => {
    calls++; o.onCheckpoint({ convo: [{ role: 'model', parts: [{ functionCall: { id: 'effect-1', name: 'effect', args: {} } }] }] }); throw new Error('fetch failed; action may have happened');
  } } }); t.after(() => workers.cancelAll());
  const done = new Promise(resolve => bus.once('job:done', resolve)), job = workers.dispatch('alex', 'Inspect only'); await done;
  assert.equal(calls, 1); assert.equal(home.findJob(job.id).status, 'failed');
  const card = cp.load(home, job.id); assert.equal(card.outcomes[0].ok, null); assert.equal(card.recoveryReady, true); assert.equal(cp.canResume(card), false);
});
