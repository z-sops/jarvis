'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createUsage, priceFor, pacificDay, msUntilReset } = require('../lib/usage');
const { createAudit, redact } = require('../lib/audit');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-u-'));
const clock = iso => { let t = new Date(iso).getTime(); return { now: () => new Date(t), set: v => { t = new Date(v).getTime(); }, adv: ms => { t += ms; } }; };

test('usage: requests, tokens and failures add up per model, and the estimate uses the paid price list', () => {
  const c = clock('2026-09-20T12:00:00Z'), u = createUsage({ file: () => path.join(tmp(), 'usage.json'), now: c.now });
  u.add({ model: 'gemini-3.5-flash-lite', inTok: 20000, outTok: 500 }); u.add({ model: 'gemini-3.5-flash-lite', failed: true });
  u.add({ source: 'hermes', model: 'gemini-3.5-flash-lite', inTok: 200000, outTok: 4000, run: true }); u.add({ model: 'gemini-9-pro', inTok: 1000, outTok: 10 });
  const s = u.snapshot(); assert.equal(s.total.req, 3, 'a Hermes run is not a request'); assert.equal(s.total.runs, 1); assert.equal(s.total.fail, 1);
  assert.equal(s.total.inTok, 221000); assert.equal(s.total.outTok, 4510); assert.equal(s.total.unpriced, true, 'the unknown model has no price');
  const lite = s.rows.filter(r => r.model === 'gemini-3.5-flash-lite'); assert.equal(lite.length, 2, 'bridge and hermes are separate rows');
  assert.ok(Math.abs(s.total.cost - ((220000 / 1e6) * 0.30 + (4500 / 1e6) * 2.50)) < 1e-9, 'cost of the priced rows: ' + s.total.cost);
});

test('usage: the day follows Google (midnight Pacific), the file survives a restart, old days are dropped', () => {
  const c = clock('2026-09-21T06:30:00Z'), file = path.join(tmp(), 'usage.json');          // 23:30 on the 20th in Pacific time
  const u = createUsage({ file: () => file, now: c.now, keepDays: 3 }); u.add({ model: 'gemini-3.5-flash-lite', inTok: 5 }); assert.equal(u.snapshot().day, '2026-09-20');
  assert.ok(Math.abs(u.snapshot().resetsInMs - 30 * 60000) < 1000, 'the reset is 30 minutes away: ' + u.snapshot().resetsInMs);
  c.adv(45 * 60000); assert.equal(u.snapshot().day, '2026-09-21', 'a new Google day started'); assert.equal(u.snapshot().total.req, 0);
  u.flush(); const again = createUsage({ file: () => file, now: c.now }); c.set('2026-09-21T05:00:00Z'); assert.equal(again.snapshot().total.inTok, 5, 'numbers came back from disk');
  const u2 = createUsage({ file: () => file, now: c.now, keepDays: 2 }); for (const d of ['2026-09-22', '2026-09-23', '2026-09-24']) { c.set(d + 'T20:00:00Z'); u2.add({ inTok: 1 }); }
  u2.flush(); assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).days).length, 2, 'only the last 2 days are kept');
  assert.equal(pacificDay(new Date('2026-01-15T07:59:00Z')), '2026-01-14', 'in winter Pacific midnight is 08:00 UTC'); assert.ok(msUntilReset(new Date('2026-01-15T07:00:00Z')) === 3600000);
});

test('usage: the last minute counts recent tokens, and spreads a long Hermes run over the time it took', () => {
  const c = clock('2026-09-20T12:00:00Z'), u = createUsage({ file: () => path.join(tmp(), 'u.json'), now: c.now });
  u.add({ model: 'm', inTok: 30000 }); c.adv(50000); assert.equal(u.snapshot().minute.inTok, 30000, 'still inside the minute');
  c.adv(20000); assert.equal(u.snapshot().minute.inTok, 0, 'older than a minute: gone'); assert.equal(u.snapshot().total.inTok, 30000, 'but still in today\'s total');
  const start = c.now().getTime(); c.adv(120000); u.add({ source: 'hermes', model: 'm', inTok: 240000, run: true, startedAt: start });   // a 2 minute run
  const m = u.snapshot().minute.inTok; assert.ok(m > 110000 && m < 130000, 'about half of a 2-minute run falls in the last minute: ' + m);
});

test('prices: flash-lite, the 3.8 price rise in 2027, and unknown models', () => {
  assert.deepEqual(priceFor('gemini-3.5-flash-lite', new Date('2026-09-20')), { in: 0.30, out: 2.50 });
  assert.deepEqual(priceFor('gemini-3.8-flash', new Date('2026-12-31T12:00:00')), { in: 0.75, out: 3.75 }); assert.deepEqual(priceFor('gemini-3.8-flash', new Date('2027-01-02T12:00:00')), { in: 1.50, out: 7.50 });
  assert.equal(priceFor('gemini-9-ultra', new Date()), null); assert.equal(priceFor(undefined, new Date()), null);
});

test('audit: entries are written, read back newest last, secrets are removed, a cut first line is skipped', () => {
  const file = path.join(tmp(), 'logs', 'actions.jsonl'), a = createAudit({ file: () => file }); const seen = []; a.on(e => seen.push(e));
  a.add({ kind: 'tool', actor: 'Laila', name: 'run_shell', status: 'done', ms: 40, detail: 'curl -H "x-goog-api-key: AIzaSyA1234567890123456789012345678901" https://x' });
  a.add({ kind: 'tool', actor: 'Bob', name: 'write_file', status: 'error', reason: 'password=hunter2 was refused' }); a.add({ kind: 'job', event: 'done', agent: 'Bob', task: 'x'.repeat(500) });
  const t = a.tail(10); assert.equal(t.length, 3); assert.equal(t[0].name, 'run_shell'); assert.doesNotMatch(JSON.stringify(t), /AIzaSy|hunter2/); assert.match(t[0].detail, /api-key: \[removed\]/); assert.match(t[1].reason, /password=\[removed\]/);
  assert.ok(t[2].task.length <= 240, 'long text is clipped'); assert.equal(seen.length, 3, 'listeners hear about new entries'); assert.equal(a.tail(2).length, 2);
  fs.appendFileSync(file, '{"broken'); assert.equal(a.tail(10).length, 3, 'a half written line is ignored'); assert.deepEqual(createAudit({ file: () => path.join(tmp(), 'nothing.jsonl') }).tail(), []);
  assert.equal(redact('token: abc123'), 'token: [removed]');
});

test('audit: a bare key with no label is removed too', () => { assert.equal(redact('use AIzaSyA1234567890123456789012345678901 now'), 'use [key removed] now'); });
