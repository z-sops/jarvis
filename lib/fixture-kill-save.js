'use strict';
const cp = require('child_process');

// Only the process spawned by this call can be killed. No caller-supplied PID.
function killAfterSave(binary, args, env, timeout = 45000) {
  return new Promise(resolve => {
    let child, output = '', bytes = 0, saved = false, killed = false, finished = false, diagnostics;
    const finish = ok => { if (finished) return; finished = true; clearTimeout(timer); resolve({ saved: ok, protected: ok, forcedTermination: ok, ...(diagnostics ? { diagnostics } : {}) }); };
    const stop = () => { try { return child?.kill('SIGKILL') === true; } catch { return false; } };
    const timer = setTimeout(() => { stop(); finish(false); }, timeout);
    try { child = cp.spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
    catch { finish(false); return; }
    child.on('error', () => { stop(); finish(false); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { stop(); finish(false); return; }
      output += chunk.toString('utf8');
      let index;
      while ((index = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, index).trimEnd(); output = output.slice(index + 1);
        if (!line.startsWith('ORBIT_KEY_RESULT ')) continue;
        let result; try { result = JSON.parse(line.slice(17)); } catch { stop(); finish(false); return; }
        if (result.saved !== true || result.protected !== true || result.keyPersistent !== true || saved) {
          const d=result.diagnostics;
          if(d)diagnostics={phase:['arguments','electron_ready','storage_available','key_persistence','checkpoint_save'].includes(d.phase)?d.phase:'unknown',issue:['EACCES','EPERM','ENOENT','ENOSPC','EIO','operation_failed'].includes(d.issue)?d.issue:'unknown',...Object.fromEntries(['localStateAtSave','keyRecordAtSave'].filter(k=>typeof d[k]==='boolean').map(k=>[k,d[k]])),electron:/^\d+\.\d+\.\d+$/.test(d.electron||'')?d.electron:null,node:/^\d+\.\d+\.\d+$/.test(d.node||'')?d.node:null};
          stop(); finish(false); return;
        }
        saved = true;
        killed = stop();
        if (!killed) finish(false);
      }
    });
    child.on('close', (code, signal) => {
      // Windows TerminateProcess uses exit code 1; POSIX reports SIGKILL.
      finish(saved && killed && (signal === 'SIGKILL' || (process.platform === 'win32' && code === 1)));
    });
  });
}
module.exports = { killAfterSave };
