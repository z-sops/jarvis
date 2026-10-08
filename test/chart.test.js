'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../lib/chart');

// A very small XML check: every tag opens and closes in order (the charts must always be well-formed).
function wellFormed(svg) { const stack = []; const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g; let m; while ((m = re.exec(svg))) { if (m[4]) continue; if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]); } return stack.length === 0; }
const nums = (svg, tag, attr) => [...svg.matchAll(new RegExp(`<${tag}[^>]*?${attr}="([-\\d.]+)"`, 'g'))].map(m => +m[1]);

test('scale: nice tops and ticks, also for negatives, one value, and rubbish', () => {
  assert.deepEqual(C.niceScale(0, 97).ticks, [0, 20, 40, 60, 80, 100]); assert.deepEqual(C.niceScale(0, 1).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]); assert.deepEqual(C.niceScale(-30, 70).ticks, [-40, -20, 0, 20, 40, 60, 80]);
  const one = C.niceScale(5, 5); assert.ok(one.min <= 0 && one.max >= 5); assert.equal(C.niceScale(0, 0).max, 1); assert.equal(C.niceScale(NaN, 3).max, 1);
  assert.equal(C.fmt(1234567), '1.23M'); assert.equal(C.fmt(2500000000), '2.5B'); assert.equal(C.fmt(12345), '12,345'); assert.equal(C.fmt(3.14159), '3.14'); assert.equal(C.fmt(12.34), '12.3'); assert.equal(C.fmt(45, '%'), '45%'); assert.equal(C.fmt(9.5, '$'), '$9.5'); assert.equal(C.fmt(7, 'kg'), '7 kg');
});

test('input is checked hard: what the model sends is never trusted', () => {
  const bad = (i, re) => assert.throws(() => C.render(i), re);
  bad({}, /needs labels/); bad({ labels: ['a'] }, /needs numbers/); bad({ labels: ['a', 'b'], values: [1] }, /has 1 numbers but there are 2 labels/); bad({ labels: ['a'], values: ['x'] }, /not a number/); bad({ labels: ['a'], values: [Infinity] }, /not a number/); bad({ labels: ['a'], values: [null] }, /not a number/);
  bad({ labels: Array(41).fill('x'), values: Array(41).fill(1) }, /At most 40/); bad({ labels: ['a'], series: Array(7).fill({ values: [1] }) }, /At most 6/); bad({ type: 'pie', labels: ['a', 'b'], series: [{ values: [1, 1] }, { values: [1, 1] }] }, /one series/); bad({ type: 'pie', labels: ['a', 'b'], values: [3, -1] }, /negative/); bad({ type: 'pie', labels: ['a'], values: [0] }, /above zero/);
  const ok = C.check({ type: 'nonsense', labels: ['a', 'b'], values: ['1,200', ' 3 '] }); assert.equal(ok.type, 'bar', 'an unknown type becomes a bar chart'); assert.deepEqual(ok.series[0].values, [1200, 3], 'numbers written as text are read');
});

test('text can never break out of the picture: everything is escaped', () => {
  const evil = '</text><script>alert(1)</script><image href="x" onerror="y">"\'&';
  for (const type of ['bar', 'line', 'pie']) { const svg = C.render({ title: evil, type, labels: [evil, 'b'], series: [{ name: evil, values: [3, 4] }], unit: evil, source: evil }); const tags = [...svg.matchAll(/<([a-zA-Z]+)([^>]*)>/g)]; assert.ok(tags.every(m => ['svg', 'rect', 'text', 'line', 'path', 'circle', 'polyline'].includes(m[1]) && !/\son\w+\s*=\s*["']/i.test(m[2])), type + ': only drawing tags, no event handlers (the words are just escaped text)'); assert.ok(wellFormed(svg), type + ' is well-formed'); assert.match(svg, /&lt;script&gt;/); }
  assert.match(C.render({ title: 'x'.repeat(500), labels: ['a'], values: [1] }), /x{80}\u2026/, 'a long title is cut');
});

test('bar chart: bars are as tall as the numbers say, negatives go down, groups sit side by side', () => {
  const svg = C.render({ title: 'Sales', type: 'bar', labels: ['A', 'B', 'C'], values: [10, 20, 40], unit: '$' }); assert.ok(wellFormed(svg)); const h = nums(svg, 'rect', 'height').slice(2);   // the first two rects are the frame
  assert.equal(h.length, 3); assert.ok(Math.abs(h[1] / h[0] - 2) < 0.02 && Math.abs(h[2] / h[0] - 4) < 0.02, 'heights 1 : 2 : 4 (' + h + ')'); assert.match(svg, />\$40</, 'the value is written above the bar with its unit'); assert.match(svg, /<text[^>]*>Sales<\/text>/);
  const neg = C.render({ type: 'bar', labels: ['up', 'down'], values: [30, -30] }), bars = [...neg.matchAll(/<rect x="[-\d.]+" y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)" rx="3"/g)].map(m => [+m[1], +m[2]]), ys = bars.map(b => b[0]), hs = bars.map(b => b[1]); assert.ok(ys[1] > ys[0], 'the negative bar starts lower'); assert.ok(Math.abs(hs[0] - hs[1]) < 0.5, 'and is as long as the positive one');
  const grp = C.render({ type: 'bar', labels: ['x', 'y'], series: [{ name: 'This year', values: [1, 2] }, { name: 'Last year', values: [2, 1] }] }); assert.match(grp, /This year/); assert.match(grp, /Last year/, 'a legend for two series'); assert.equal(nums(grp, 'rect', 'height').length - 2 - 2, 4, 'four bars (plus two legend squares)');
  const many = C.render({ type: 'bar', labels: Array.from({ length: 30 }, (_, k) => 'label number ' + k), values: Array.from({ length: 30 }, (_, k) => k) }); assert.ok(wellFormed(many)); assert.ok((many.match(/label nu/g) || []).length <= 30 / 3 + 1, 'crowded labels are thinned out');
});

test('line and pie', () => {
  const line = C.render({ type: 'line', title: 'Trend', labels: ['2020', '2021', '2022'], series: [{ name: 'GDP', values: [1, 3, 2] }], source: 'World Bank' }); assert.ok(wellFormed(line)); const pts = /<polyline points="([^"]+)"/.exec(line)[1].split(' ').map(p => p.split(',').map(Number)); assert.equal(pts.length, 3); assert.ok(pts[1][1] < pts[0][1] && pts[1][1] < pts[2][1], 'the highest value is the highest point'); assert.equal((line.match(/<circle/g) || []).length, 3); assert.match(line, /Source: World Bank/);
  const pie = C.render({ type: 'pie', title: 'Share', labels: ['a', 'b', 'c'], values: [50, 30, 20], unit: '%' }); assert.ok(wellFormed(pie)); assert.equal((pie.match(/<path d="M/g) || []).length, 3); const pc = [...pie.matchAll(/(\d+)%<\/text>/g)].map(m => +m[1]); assert.deepEqual(pc.slice(0, 3), [50, 30, 20]); assert.ok(!/50% \u00B7 50%/.test(pie), 'a value that is already a percentage is written once'); const money = C.render({ type: 'pie', labels: ['a', 'b'], values: [30, 10], unit: '$' }); assert.match(money, /\$30 \u00B7 75%/, 'other units are shown with their share');
  const single = C.render({ type: 'pie', labels: ['only', 'zero'], values: [5, 0] }); assert.match(single, /<circle cx="250"/, 'one slice is a full circle'); assert.ok(wellFormed(single));
});

test('make: saves the file in the workspace, tells the screen, and reports where', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-')), home = { p: (...a) => path.join(dir, ...a) }, events = [];
  const r = C.make({ title: 'Cars per city: 2026!', type: 'bar', labels: ['Karachi', 'Lahore'], values: [10, 20] }, { home, bus: { emit: (n, p) => events.push([n, p]) } });
  assert.match(r.saved, /^charts\/cars-per-city-2026-\d{12}\.svg$/); assert.equal(r.points, 2); const file = path.join(dir, 'workspace', ...r.saved.split('/')); assert.ok(fs.existsSync(file)); assert.ok(fs.readFileSync(file, 'utf8').startsWith('<svg'));
  assert.equal(events[0][0], 'chart:made'); assert.equal(events[0][1].path, r.saved); assert.ok(events[0][1].svg.startsWith('<svg')); assert.throws(() => C.make({ labels: [] }, { home }), /needs labels/); assert.ok(C.make({ labels: ['a'], values: [1] }).saved, 'works without a workspace too');
});
