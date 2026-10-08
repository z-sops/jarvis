'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describe, makeCollector } = require('../lib/ocevents');

// The three lines are real output of `opencode run "say hi in one word" --format json` on this PC.
const REAL = [
  '{"type":"step_start","timestamp":1791110182264,"sessionID":"ses_x","part":{"id":"prt_1","messageID":"msg_1","sessionID":"ses_x","type":"step-start"}}',
  '{"type":"text","timestamp":1791110182356,"sessionID":"ses_x","part":{"id":"prt_2","type":"text","text":"Hi","time":{"start":1791110182270,"end":1791110182337}}}',
  '{"type":"step_finish","timestamp":1791110182356,"sessionID":"ses_x","part":{"id":"prt_3","reason":"stop","type":"step-finish","tokens":{"total":7915,"input":5970,"output":3,"reasoning":0,"cache":{"write":0,"read":1942}},"cost":0}}'
];

test('the real events are understood: thinking, the text, the tokens', () => {
  const seen = []; let said = '';
  const c = makeCollector({ onProgress: p => seen.push(p.label), onText: t => { said = t; } });
  c.push(REAL.join('\n') + '\n'); c.end();
  assert.deepEqual(seen, ['thinking', 'step done (5970 in, 3 out)']); assert.equal(c.text(), 'Hi'); assert.equal(said, 'Hi'); assert.equal(c.count(), 3);
});

test('a line cut in the middle of two chunks is put together; text of several steps is joined', () => {
  const c = makeCollector({}); const all = REAL[1] + '\n' + REAL[1].replace('"Hi"', '"there"') + '\n';
  c.push(all.slice(0, 60)); c.push(all.slice(60, 200)); c.push(all.slice(200)); c.end();
  assert.equal(c.text(), 'Hi\n\nthere');
});

test('the real tool events: glob and write become readable steps, the file name only, and a write shows its words', () => {
  const seen = []; const c = makeCollector({ onProgress: p => seen.push(p.tool + '|' + p.label + '|' + p.status) });
  c.push('{"type":"tool_use","part":{"type":"tool","tool":"glob","state":{"status":"completed","input":{"pattern":"t.txt"},"output":"No files found"}}}\n');
  c.push('{"type":"tool_use","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"G:\\\\bridge-os\\\\BridgeHome\\\\workspace\\\\bob\\\\t.txt","content":"hi there friend"},"output":"Wrote file successfully."}}}\n');
  c.push('not json at all\n{"type":"something_new","part":{}}\n{"nope":1}\n[1,2]\n'); c.end();
  assert.deepEqual(seen, ['glob|glob t.txt|done', 'write|write t.txt (3 words)|done']); assert.equal(c.text(), '');
});

test('an error event is kept', () => {
  const c = makeCollector({}); c.push('{"type":"error","error":{"name":"APIError","data":{"message":"quota used up"}}}\n'); assert.equal(c.error(), 'quota used up');
  assert.deepEqual(describe(null), null);
});

test('the log shows every raw line and what it was understood as', () => {
  const lines = []; const c = makeCollector({ log: m => lines.push(m) }); c.push(REAL[0] + '\nhello plain line\n' + REAL[2] + '\n'); c.end();
  assert.match(lines[0], /^raw \{"type":"step_start"/); assert.equal(lines[1], '-> step thinking'); assert.equal(lines[2], 'raw hello plain line'); assert.match(lines[3], /^raw \{"type":"step_finish"/); assert.match(lines[4], /^-> finish step done/);
});

test('note() writes a line of the same log', () => {
  const lines = []; const c = makeCollector({ log: m => lines.push(m) }); c.note('spawn x'); assert.deepEqual(lines, ['spawn x']);
});
