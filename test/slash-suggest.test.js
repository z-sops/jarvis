'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'chat-ui.js'), 'utf8');
const a = src.indexOf('/*slash-suggest-start*/'), b = src.indexOf('/*slash-suggest-end*/');
assert.ok(a > 0 && b > a, 'the slash list is not in chat-ui.js');
const slashSuggest = new Function(src.slice(a, b) + '\nreturn slashSuggest;')();
const crew = [{ id: 'alex', name: 'Alex', role: 'Researcher' }, { id: 'bob', name: 'Bob', role: 'Coder' }];
const L = (v) => slashSuggest(v, crew, 'Laila').map(x => x.label);

test('a bare slash lists Laila, every crew member and /stop', () => {
  assert.deepEqual(L('/'), ['/laila', '/alex', '/bob', '/stop']);
});
test('typing narrows the list; Tab text keeps a space after the name', () => {
  assert.deepEqual(L('/b'), ['/bob']); assert.equal(slashSuggest('/b', crew, 'Laila')[0].text, '/bob ');
  assert.deepEqual(L('/x'), []);
});
test('after a crew name the list offers report and continue (not once typed in full)', () => {
  assert.deepEqual(L('/alex '), ['health', 'report', 'continue']);
  assert.deepEqual(L('/alex re'), ['report']); assert.deepEqual(L('/alex h'), ['health']); assert.deepEqual(L('/alex report'), []);
  assert.deepEqual(L('/alex do the job'), []);
});
test('/stop offers the crew; ordinary text and paths offer nothing', () => {
  assert.deepEqual(L('/stop '), ['alex', 'bob']); assert.deepEqual(L('/stop b'), ['bob']); assert.deepEqual(L('/stop bob'), []);
  assert.deepEqual(L('hello'), []); assert.deepEqual(L(''), []); assert.deepEqual(L('/nobody '), []);
});
