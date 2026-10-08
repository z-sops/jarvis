'use strict';
/*
  Shared test helpers.

  hasHermes() is a file-existence probe, never a Hermes run: on Zee's machine
  `hermes --version` takes ~28 s (it does a GitHub update check on every start)
  and node --test runs the test files in parallel, so three concurrent 30 s
  spawnSync calls blew the timeout and every real-Hermes test skipped itself.

  Two ways to point at the executable:
    HERMES_CMD=<path>   explicit, used by the tests
    falling back to 'hermes' on PATH (so the existing behaviour is unchanged
    when the user has it on PATH and it is fast)
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function hermesCmd() {
  return (process.env.HERMES_CMD || 'hermes').trim();
}

function isExecutable(p) {
  if (!p) return false;
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

// True when the executable exists and is executable. No Hermes process is started.
// An absolute path is checked directly: Windows `where` only searches PATH, so
// `where "G:\Hermes\hermes-agent\hermes"` returns empty and the test would skip.
function hasHermes() {
  const cmd = hermesCmd();
  if (path.isAbsolute(cmd)) return isExecutable(cmd);
  if (process.platform === 'win32') {
    const r = spawnSync('where', [cmd], { timeout: 15000 });
    const out = (r.stdout || '').toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return out.length > 0 && out.some(isExecutable);
  }
  const r = spawnSync('which', [cmd], { timeout: 15000 });
  return isExecutable((r.stdout || '').toString().trim());
}

// Kill a whole process tree. On Windows taskkill /T /F is the only reliable way
// (process.kill sends a Ctrl event that the child ignores); everywhere else SIGKILL.
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 15000, windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {}
}

module.exports = { hermesCmd, hasHermes, killTree };
