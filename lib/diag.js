'use strict';
// A short "why did Orbit close?" log: <home>/logs/bridge-main.log. It only watches; it never changes how Orbit behaves and never throws.
const fs = require('fs'), path = require('path'), os = require('os');
let file = null;
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function note(msg) { if (!file) return; try { fs.appendFileSync(file, `${stamp()}  ${msg}\n`); } catch {} }

function install({ app, getDir }) {
  try {
    const dir = getDir(); fs.mkdirSync(dir, { recursive: true }); file = path.join(dir, 'bridge-main.log');
    try { if (fs.statSync(file).size > 400000) fs.writeFileSync(file, ''); } catch {}
  } catch { return; }
  note(`START pid ${process.pid} | Electron ${process.versions.electron || '?'} | Windows ${os.release()}`);
  process.on('exit', code => note(`PROCESS EXIT, code ${code}`));
  process.on('uncaughtExceptionMonitor', (e, origin) => note(`ERROR (${origin}): ${(e && e.stack) || e}`));
  app.on('before-quit', () => note('before-quit: Orbit is closing on purpose'));
  app.on('will-quit', () => note('will-quit'));
  app.on('quit', (_e, code) => note(`quit event, exit code ${code}`));
  app.on('second-instance', () => note('another Orbit was started; that one closes itself and this one keeps running'));
  app.on('render-process-gone', (_e, _wc, d) => note(`WINDOW PROCESS GONE: ${d && d.reason} (exit code ${d && d.exitCode})`));
  app.on('child-process-gone', (_e, d) => note(`HELPER PROCESS GONE: ${d && d.type} ${d && d.reason} (exit code ${d && d.exitCode})`));
  app.on('browser-window-created', (_e, w) => {
    w.on('close', () => note('window: close requested'));
    w.on('hide', () => note('window hidden'));
    w.on('unresponsive', () => note('WINDOW NOT RESPONDING'));
    w.on('session-end', () => note('WINDOWS is ending the session (log off, restart or shut down)'));
  });
}

module.exports = { install, note };
