'use strict';
/*
  On Windows a child started with shell:true is cmd.exe, and the real program (opencode) is a grandchild. p.kill() ends only cmd.exe: opencode is left running and keeps writing files.
  wrap(p) makes p.kill() end the whole tree first (taskkill /T /F) and only THEN do the plain kill. Killing cmd.exe first would break the tree before taskkill can walk it.
  Every attempt is written to the log (taskkill's exit code and what it said), so a failure can be seen. On other systems nothing changes.
*/
const { spawn } = require('child_process');

function wrap(p, { platform = process.platform, run, log, waitMs = 8000 } = {}) {
  if (!p || platform !== 'win32') return p;
  const say = m => { if (log) { try { log(m); } catch { /* the log must never break a stop */ } } };
  const doRun = run || (pid => new Promise(resolve => {
    let out = '', k;
    try { k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { say('taskkill could not start: ' + e.message); return resolve(); }
    k.stdout.on('data', d => { out += d; }); k.stderr.on('data', d => { out += d; });
    k.on('error', e => { say('taskkill error: ' + e.message); resolve(); });
    k.on('close', code => { say('taskkill /pid ' + pid + ' /T /F exit ' + code + ': ' + out.replace(/\s+/g, ' ').trim().slice(0, 300)); resolve(); });
  }));
  const orig = p.kill.bind(p); let started = false;
  p.kill = (...a) => {
    if (!p.pid) return orig(...a);
    if (!started) {
      started = true; say('stop asked for pid ' + p.pid);
      let t; const guard = new Promise(r => { t = setTimeout(r, waitMs); if (t.unref) t.unref(); });
      Promise.race([Promise.resolve().then(() => doRun(p.pid)), guard]).catch(() => {}).then(() => { clearTimeout(t); try { orig(...a); } catch { /* already gone */ } });
    }
    return true;
  };
  return p;
}
module.exports = { wrap };
