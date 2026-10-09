'use strict';
// One app-wide origin guard for invoke handlers, including settings and approvals.
function isMainFrame(window, event) {
  try { return !!window && !window.isDestroyed?.() && !window.webContents.isDestroyed?.() && event?.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame; }
  catch { return false; }
}
function installMainFrameGuard(ipcMain, getWindow) {
  const original = ipcMain.handle;
  ipcMain.handle = function(channel, handler) {
    return original.call(this, channel, (event, ...args) => {
      if (!isMainFrame(getWindow(), event)) throw new Error('This action is available only in the main application frame.');
      return handler(event, ...args);
    });
  };
}
module.exports = { isMainFrame, installMainFrameGuard };
