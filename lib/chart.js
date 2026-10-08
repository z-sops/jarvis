'use strict';
// Charts drawn by Orbit itself (not by the model): bar, line and pie as clean SVG in the Orbit colours. The model only supplies real numbers.
const fs = require('fs');
const path = require('path');

const COLORS = ['#68d0ff', '#ffbe5c', '#968cff', '#6ee6aa', '#ff8296', '#78beff', '#f2d16b', '#c38bff'];
const W = 800, H = 460, INK = '#e6ecf5', DIM = '#8f9fb5', GRID = 'rgba(150,200,255,.14)', BG = '#0b121c';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };

// A pleasant top for the scale (1, 2, 5 x 10^n) and the tick values.
function niceScale(min, max, want = 5) {
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (min === max) { if (min === 0) max = 1; else if (min > 0) { min = 0; } else max = 0; }
  const span = max - min, raw = span / want, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { min: lo, max: hi, step, ticks };
}
function fmt(v, unit = '') {
  const a = Math.abs(v); let s;
  if (a >= 1e9) s = +(v / 1e9).toFixed(2) + 'B'; else if (a >= 1e6) s = +(v / 1e6).toFixed(2) + 'M'; else if (a >= 1e4) s = Math.round(v).toLocaleString('en-US'); else s = String(+v.toFixed(a < 10 ? 2 : 1));
  return unit ? (/^[$\u20ac\u00a3]/.test(unit) ? unit + s : s + (unit === '%' ? '%' : ' ' + unit)) : s;
}

// input: { title, type: 'bar'|'line'|'pie', labels: [text], series: [{ name, values: [number] }], unit, source }
function check(input) {
  const i = input || {}, type = ['bar', 'line', 'pie'].includes(i.type) ? i.type : 'bar', labels = Array.isArray(i.labels) ? i.labels.map(x => cut(String(x), 24)) : [];
  let series = Array.isArray(i.series) ? i.series : []; if (!series.length && Array.isArray(i.values)) series = [{ name: i.name || '', values: i.values }];
  if (!labels.length) throw new Error('A chart needs labels (the names under the bars, or the dates).');
  if (labels.length > 40) throw new Error('At most 40 points: group the data first.');
  if (!series.length) throw new Error('A chart needs numbers (values).'); if (series.length > 6) throw new Error('At most 6 series.');
  const clean = series.map((s, k) => {
    const vals = (Array.isArray(s.values) ? s.values : []).map(v => (typeof v === 'string' ? parseFloat(v.replace(/[, ]/g, '')) : v));
    if (vals.length !== labels.length) throw new Error(`Series ${k + 1} has ${vals.length} numbers but there are ${labels.length} labels.`);
    if (vals.some(v => typeof v !== 'number' || !isFinite(v))) throw new Error(`Series ${k + 1} has a value that is not a number.`);
    return { name: cut(s.name || `Series ${k + 1}`, 28), values: vals };
  });
  if (type === 'pie') { if (clean.length > 1) throw new Error('A pie chart shows one series.'); if (clean[0].values.some(v => v < 0)) throw new Error('A pie chart cannot have negative values.'); if (!clean[0].values.some(v => v > 0)) throw new Error('A pie chart needs at least one value above zero.'); }
  return { type, title: cut(i.title || 'Chart', 90), labels, series: clean, unit: cut(i.unit || '', 12), source: cut(i.source || '', 120) };
}

function frame(title, body, legend, source) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" font-family="'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif">` +
    `<rect width="${W}" height="${H}" rx="18" fill="${BG}"/><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="rgba(150,200,255,.2)"/>` +
    `<text x="28" y="40" fill="${INK}" font-size="19" font-weight="600">${esc(title)}</text>${legend}${body}` + (source ? `<text x="28" y="${H - 14}" fill="${DIM}" font-size="11">Source: ${esc(source)}</text>` : '') + `</svg>`;
}
const legendOf = series => (series.length < 2 ? '' : series.map((s, k) => { const x = 28 + series.slice(0, k).reduce((a, t) => a + 30 + t.name.length * 7, 0); return `<rect x="${x}" y="52" width="11" height="11" rx="3" fill="${COLORS[k % COLORS.length]}"/><text x="${x + 16}" y="62" fill="${DIM}" font-size="12">${esc(s.name)}</text>`; }).join(''));

function render(input) {
  const c = check(input), { labels, series, unit } = c, x0 = 74, x1 = W - 30, y0 = series.length > 1 ? 84 : 66, y1 = H - 64;
  if (c.type === 'pie') {
    const vals = series[0].values, total = vals.reduce((a, b) => a + b, 0), cx = 250, cy = 250, r = 150; let a0 = -Math.PI / 2, body = '';
    vals.forEach((v, k) => { if (v <= 0) return; const a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, p = (a, rr) => `${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
      body += vals.filter(x => x > 0).length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLORS[k % COLORS.length]}"/>` : `<path d="M ${cx} ${cy} L ${p(a0, r)} A ${r} ${r} 0 ${big} 1 ${p(a1, r)} Z" fill="${COLORS[k % COLORS.length]}" stroke="${BG}" stroke-width="2"/>`; a0 = a1; });
    const rows = labels.slice(0, 14).map((l, k) => `<rect x="480" y="${92 + k * 24}" width="12" height="12" rx="3" fill="${COLORS[k % COLORS.length]}"/><text x="500" y="${102 + k * 24}" fill="${INK}" font-size="13">${esc(l)}</text><text x="${W - 30}" y="${102 + k * 24}" fill="${DIM}" font-size="13" text-anchor="end">${unit === '%' ? '' : esc(fmt(vals[k], unit)) + ' \u00B7 '}${Math.round((vals[k] / total) * 100)}%</text>`).join('');   // values that are already percentages are not shown twice
    return frame(c.title, body + rows, '', c.source);
  }
  const all = series.flatMap(s => s.values), sc = niceScale(Math.min(0, ...all), Math.max(0, ...all)), yOf = v => y1 - ((v - sc.min) / (sc.max - sc.min || 1)) * (y1 - y0), n = labels.length, slot = (x1 - x0) / n;
  let body = sc.ticks.map(t => `<line x1="${x0}" x2="${x1}" y1="${yOf(t).toFixed(1)}" y2="${yOf(t).toFixed(1)}" stroke="${t === 0 ? 'rgba(150,200,255,.4)' : GRID}"/><text x="${x0 - 10}" y="${(yOf(t) + 4).toFixed(1)}" fill="${DIM}" font-size="11" text-anchor="end">${esc(fmt(t))}</text>`).join('');
  const every = Math.ceil(n / 12);
  labels.forEach((l, k) => { if (k % every === 0) body += `<text x="${(x0 + slot * (k + 0.5)).toFixed(1)}" y="${y1 + 20}" fill="${DIM}" font-size="11.5" text-anchor="middle">${esc(cut(l, n > 14 ? 8 : 14))}</text>`; });
  if (c.type === 'bar') {
    const g = series.length, bw = Math.max(3, Math.min(56, (slot * 0.72) / g));
    series.forEach((s, si) => s.values.forEach((v, k) => { const cxk = x0 + slot * (k + 0.5) - (g * bw) / 2 + si * bw, top = Math.min(yOf(v), yOf(0)), h = Math.max(1, Math.abs(yOf(v) - yOf(0)));
      body += `<rect x="${cxk.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${COLORS[si % COLORS.length]}"/>`;
      if (n <= 14 && g <= 2) body += `<text x="${(cxk + (bw - 2) / 2).toFixed(1)}" y="${(v >= 0 ? top - 6 : top + h + 14).toFixed(1)}" fill="${INK}" font-size="11" text-anchor="middle">${esc(fmt(v, unit))}</text>`; }));
  } else {
    series.forEach((s, si) => { const col = COLORS[si % COLORS.length], pts = s.values.map((v, k) => `${(x0 + slot * (k + 0.5)).toFixed(1)},${yOf(v).toFixed(1)}`); body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` + s.values.map((v, k) => `<circle cx="${(x0 + slot * (k + 0.5)).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3.6" fill="${BG}" stroke="${col}" stroke-width="2"/>`).join(''); });
  }
  return frame(c.title, body, legendOf(series) + (unit ? `<text x="${W - 30}" y="40" fill="${DIM}" font-size="12" text-anchor="end">${esc(unit)}</text>` : ''), c.source);
}

// Saves the chart in the workspace (charts/<name>-<time>.svg) and returns where.
function make(input, { home, bus } = {}) {
  const svg = render(input), c = check(input), slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chart', stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const rel = `charts/${slug}-${stamp}.svg`; if (home) { const dir = home.p('workspace', 'charts'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${slug}-${stamp}.svg`), svg); }
  if (bus) { try { bus.emit('chart:made', { title: c.title, path: rel, svg, type: c.type, points: c.labels.length }); } catch { /* the file is what counts */ } }
  return { saved: rel, type: c.type, points: c.labels.length, note: 'The chart is shown in the chat and saved in the workspace.' };
}

module.exports = { render, make, check, niceScale, fmt, COLORS };
