'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenCodeEngine } = require('../lib/opencode');

// A stand-in for "opencode run": like the real one it reads piped input to the very end before it answers.
// If Orbit leaves the child's stdin open (a pipe nobody closes) it waits for ever and never writes a word.
test('the OpenCode child never waits for input: its stdin is closed from the start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocstdin-'));
  const fake = path.join(dir, 'fake-opencode.js');
  fs.writeFileSync(fake, "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('pong'));process.stdin.resume();");
  const eng = new OpenCodeEngine({ requireContainment: false, home: { root: dir }, getCfg: () => ({ opencodePath: 'node' }) });
  const out = await new Promise(resolve => {
    const p = eng._spawn([fake], { cwd: dir });
    let so = ''; p.stdout.on('data', d => { so += d; });
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve('TIMEOUT: the child is waiting for input'); }, 6000);
    p.on('close', () => { clearTimeout(t); resolve(so.trim()); });
  });
  assert.equal(out, 'pong');
});
