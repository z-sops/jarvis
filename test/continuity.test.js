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
