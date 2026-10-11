'use strict';
// Where the time goes when Orbit starts: a few marks with the seconds since the program began, written to logs/startup.log.
const fs = require('fs');
const path = require('path');

const marks = [];
const mark = (name, at = process.uptime()) => { marks.push({ name: String(name).slice(0, 80), at: +at.toFixed(2) }); return marks[marks.length - 1]; };
// One block per start, newest last; the file keeps the last few starts only.
function render(info = {}) {
  const head = `=== ${new Date().toISOString()}  ${info.electron ? 'Electron ' + info.electron : ''} ${info.platform || ''}`.trimEnd(); let prev = 0;
  const lines = marks.map(m => { const d = m.at - prev; prev = m.at; return `  ${m.at.toFixed(2).padStart(6)}s  (+${d.toFixed(2)})  ${m.name}`; });
  return [head, ...lines].join('\n') + '\n';
}
function flush(dir, info) {
  try {
    fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'startup.log'); let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch { /* first start */ }
    const blocks = old.split(/(?=^=== )/m).filter(b => b.startsWith('=== ')), mine = render(info);
    // this run's block is rewritten each time; earlier runs stay (at most 5)
    const keep = blocks.filter(b => !b.includes(process.__orbitStartId || '@@none@@')).slice(-4);
    process.__orbitStartId = process.__orbitStartId || `run-${Date.now()}`; require('./managed-write').writeFileSync(f, [...keep, mine.replace('\n', `  [${process.__orbitStartId}]\n`)].join(''));
  } catch { /* a log that cannot be written must never stop Orbit */ }
}
const reset = () => { marks.length = 0; delete process.__orbitStartId; };

module.exports = { mark, flush, render, marks, reset };
