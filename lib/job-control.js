'use strict';
// User acceptance is deliberately not exposed through Laila's or a worker's tools.
function registerJobControls({ ipcMain, workers, isTrusted }) {
  const handle = fn => (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error('Job controls are available only in the main application window.');
      return { ok: true, job: fn(...args) };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  ipcMain.handle('jobs:dispatch', handle((actor, task, expectedOutputs) => workers.dispatch(String(actor), task, { expectedOutputs })));
  ipcMain.handle('jobs:retry', handle(id => workers.retryJob(String(id))));
  ipcMain.handle('jobs:review', handle((id, decision) => workers.decideReview(String(id), decision)));
}
module.exports = { registerJobControls };
