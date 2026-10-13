'use strict';
// User acceptance is deliberately not exposed through Laila's or a worker's tools.
function registerJobControls({ ipcMain, workers, isTrusted, qa, home }) {
  const handle = fn => (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error('Job controls are available only in the main application window.');
      return { ok: true, job: fn(...args) };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  if(home){
    ipcMain.handle('crew:health',handle(()=>require('./crew-health').snapshot(home,workers)));
    ipcMain.handle('crew:lifecycle',handle((id,desired)=>require('./crew-health').setDesired(home,workers,String(id),desired)));
  }
  ipcMain.handle('jobs:dispatch', handle((actor, task, expectedOutputs, options = {}) => workers.dispatch(String(actor), task, { managed: options.managed, expectedOutputs, dependencies: options.dependencies, skills: options.skills, projectRoot: options.projectRoot })));
  if (home) ipcMain.handle('jobs:native-inspect', handle((id, outcomes) => require('./native-broker').resolveUnknown(home, String(id), outcomes)));
  if (home) {
    const recovery = require('./native-request-recovery').createRequestRecovery({home});
    for(const method of ['preview','apply','cancel'])ipcMain.handle('jobs:native-request-'+method,(event,...args)=>{if(!isTrusted(event))return {ok:false,error:'Request recovery requires the main application window.'};try{return {ok:true,...recovery[method](...args)};}catch(e){return {ok:false,error:e.code?'Protected recovery storage is unavailable.':e.message};}});
    const conversion = require('./native-conversion').createConversion({home});
    for (const [channel, method] of [['native-conversion-preview','preview'],['native-conversion-apply','apply'],['native-conversion-cancel','cancel']]) {
      ipcMain.handle('jobs:' + channel, (event,...args) => {
        if (!isTrusted(event)) return {ok:false,error:'Native conversion requires the main application window.'};
        try { return {ok:true,...conversion[method](...args)}; } catch(e) { return {ok:false,error:e.code?'Native conversion storage is unavailable.':e.message}; }
      });
    }
  }
  ipcMain.handle('jobs:retry', handle(id => workers.retryJob(String(id))));
  ipcMain.handle('jobs:review', handle((id, decision) => workers.decideReview(String(id), decision)));
  if (qa) {
    ipcMain.handle('jobs:qa-configure', handle((id, files, runner) => qa.configure(String(id), files, runner)));
    ipcMain.handle('jobs:qa-review', handle((id, actor) => qa.queueReview(String(id), String(actor))));
    ipcMain.handle('jobs:qa-tests', async (event, id) => {
      try { if (!isTrusted(event)) throw new Error('QA controls require the main application window.'); return { ok: true, job: await qa.runTests(String(id)) }; }
      catch { return { ok: false, error: 'QA tests were not completed. Inspect the job and selected tests before retrying.' }; }
    });
  }
  ipcMain.handle('jobs:sync-outcome', async (event, id) => {
    try {
      if (!isTrusted(event)) throw new Error('Job controls are available only in the main application window.');
      return { ok: true, job: await workers.syncOutcome(String(id)) };
    } catch { return { ok: false, error: 'NeuralOps outcome was not confirmed. Inspect the connector and remote task, then explicitly Sync again.' }; }
  });
}
module.exports = { registerJobControls };
