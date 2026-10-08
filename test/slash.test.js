'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../lib/slash');

const agents = [{ id: 'alex', name: 'Alex' }, { id: 'bob', name: 'Bob' }, { id: 'ag-77', name: 'Sara Khan' }];
const P = (t, o) => parse(t, { aiName: 'Laila', agents, ...(o || {}) });

test('/bob <job> is an order for Bob, the words are kept exactly', () => {
  const r = P('/bob workspace mein bob-test.txt banao jis mein "hello" likha ho\nphir parho');
  assert.equal(r.kind, 'crew'); assert.equal(r.agent.id, 'bob');
  assert.equal(r.task, 'workspace mein bob-test.txt banao jis mein "hello" likha ho\nphir parho');
});

test('case, the id and the first name all find the crew member', () => {
  assert.equal(P('/ALEX do it').agent.id, 'alex');
  assert.equal(P('/ag-77 do it').agent.id, 'ag-77');
  assert.equal(P('/sara do it').agent.id, 'ag-77');
});

test('/laila and the AI name go to Laila alone', () => {
  assert.deepEqual(P('/laila  kya haal hai '), { kind: 'laila', rest: 'kya haal hai' });
  assert.equal(P('/zara hi', { aiName: 'Zara' }).kind, 'laila');
  assert.equal(P('/laila', {}).kind, 'hint');
});

test('/stop bob stops Bob; a missing or wrong name gets a hint', () => {
  const r = P('/stop bob'); assert.equal(r.kind, 'stop'); assert.equal(r.agent.id, 'bob');
  assert.equal(P('/cancel Alex').agent.id, 'alex');
  assert.equal(P('/stop').kind, 'hint');
  const h = P('/stop nobody'); assert.equal(h.kind, 'hint'); assert.match(h.text, /Alex, Bob, Sara Khan/);
});

test('a wrong word gets a hint, a path or normal text is not touched', () => {
  const h = P('/bobb do it'); assert.equal(h.kind, 'hint'); assert.match(h.text, /not a crew member/);
  assert.equal(P('/home/me/file.txt'), null);
  assert.equal(P('hello /bob'), null);
  assert.equal(P('please tell bob to work'), null);
  assert.equal(P(''), null); assert.equal(P(null), null);
});

test('a job with no words, or with an attached file, is not sent', () => {
  assert.equal(P('/bob').kind, 'hint'); assert.equal(P('/bob   ').kind, 'hint');
  const a = P('/bob read this [Attached file: C:\\x\\a.png]'); assert.equal(a.kind, 'hint'); assert.match(a.text, /file goes to the crew through Laila/);
});

test('an empty crew still answers sensibly', () => {
  const r = parse('/bob x', { aiName: 'Laila', agents: [] }); assert.equal(r.kind, 'hint'); assert.match(r.text, /Crew: none/);
});

test('/bob report and /bob continue are their own commands', () => {
  const r = P('/Alex report'); assert.equal(r.kind, 'report'); assert.equal(r.agent.id, 'alex');
  const c = P('/bob continue'); assert.equal(c.kind, 'resume'); assert.equal(c.note, '');
  const n = P('/bob resume use the blue theme'); assert.equal(n.kind, 'resume'); assert.equal(n.note, 'use the blue theme');
  assert.equal(P('/bob reporting is the job').kind, 'crew');
  assert.equal(P('/bob continue the job').kind, 'resume');
});

test('/bob stop is the same as /stop bob', () => {
  const r = P('/bob stop'); assert.equal(r.kind, 'stop'); assert.equal(r.agent.id, 'bob');
  assert.equal(P('/bob stopping the server is the job').kind, 'crew');
});

test('/bob health (or status, check) asks for the connection check', () => {
  for (const w of ['health', 'status', 'check']) { const r = P('/bob ' + w); assert.equal(r.kind, 'health'); assert.equal(r.agent.id, 'bob'); }
  assert.equal(P('/bob health report for the shop').kind, 'crew');
});
