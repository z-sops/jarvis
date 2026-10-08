'use strict';
// The computer's numbers for the home screen: sent only while somebody is looking.
const { SysMon } = require('./sysmon');
function register({ ipcMain, app, send, win, driveOf }) {
  const mon = new SysMon({ app, driveOf }), fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  ipcMain.handle('sys:once', async e => (fromApp(e) ? { ok: true, sample: await mon.sample() } : { ok: false }));
  ipcMain.handle('sys:watch', (e, on) => { if (!fromApp(e)) return { ok: false }; if (on) mon.watch(s => send('sys:stats', s), 2000); else mon.unwatch(); return { ok: true }; });
  return { stop: () => mon.unwatch() };
}
module.exports = { register };
