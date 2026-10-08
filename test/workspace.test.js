'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createWorkspace } = require('../lib/workspace');

function rig() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ws-')), 'workspace');
  fs.mkdirSync(path.join(root, 'bob', 'sub'), { recursive: true }); fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes.md'), '# hi'); fs.writeFileSync(path.join(root, 'bob', 'report.md'), '# Report\nall good');
  fs.writeFileSync(path.join(root, 'bob', 'old.txt'), 'old'); fs.utimesSync(path.join(root, 'bob', 'old.txt'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.writeFileSync(path.join(root, 'bob', 'sub', 'data.csv'), 'a,b\n1,2'); fs.writeFileSync(path.join(root, 'node_modules', 'x', 'skip.js'), '1');
  fs.writeFileSync(path.join(root, 'bob', 'pic.png'), Buffer.from('89504e470d0a1a0a', 'hex')); fs.writeFileSync(path.join(root, 'bob', 'tool.exe'), Buffer.from([0x4d, 0x5a, 0, 0]));
  return { root, ws: createWorkspace({ root: () => root, agents: () => [{ id: 'bob', name: 'Bob', role: 'Tester' }] }) };
}

test('tree: agent folders are labelled, newest files first, junk folders skipped', () => {
  const { ws } = rig(); const t = ws.tree(); const names = t.entries.map(e => e.name);
  assert.ok(!names.includes('node_modules'), 'node_modules is skipped'); assert.equal(t.entries[0].dir, true, 'folders come first');
  const bob = t.entries.find(e => e.name === 'bob'); assert.deepEqual(bob.agent, { id: 'bob', name: 'Bob', role: 'Tester' });
  const files = bob.children.filter(c => !c.dir).map(c => c.name); assert.equal(files.indexOf('old.txt'), files.length - 1, 'oldest file is last: ' + files);
  assert.ok(bob.children.find(c => c.name === 'sub').children.some(c => c.name === 'data.csv'));
});

test('read: text, image, binary and folders', () => {
  const { ws } = rig();
  const md = ws.read('bob/report.md'); assert.equal(md.kind, 'text'); assert.match(md.text, /all good/); assert.equal(md.editable, true);
  const img = ws.read('bob/pic.png'); assert.equal(img.kind, 'image'); assert.match(img.dataUrl, /^data:image\/png;base64,/);
  const exe = ws.read('bob/tool.exe'); assert.equal(exe.kind, 'binary'); assert.equal(exe.dataUrl, undefined); assert.ok(!('text' in exe));
  assert.equal(ws.read('bob').kind, 'dir');
});

test('read: a big text file is cut at 1 MB and is not editable', () => {
  const { root, ws } = rig(); fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(1024 * 1024 + 500));
  const r = ws.read('big.txt'); assert.equal(r.truncated, true); assert.equal(r.text.length, 1024 * 1024); assert.equal(r.editable, false);
});

test('nothing outside the workspace can be reached', () => {
  const { root, ws } = rig(); const secret = path.join(path.dirname(root), 'secret.txt'); fs.writeFileSync(secret, 'top secret');
  for (const bad of ['../secret.txt', 'bob/../../secret.txt', '..\\secret.txt', 'C:/Windows/win.ini', 'c:\\x', '/etc/passwd', 'bob/\0x']) assert.throws(() => ws.read(bad), /outside the workspace|ENOENT/, 'blocked: ' + JSON.stringify(bad));
  assert.throws(() => ws.write('../secret.txt', 'x'), /outside the workspace/); assert.throws(() => ws.reveal('../secret.txt'), /outside the workspace/);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'top secret');
  if (process.platform !== 'win32') { fs.symlinkSync(path.dirname(root), path.join(root, 'link')); assert.throws(() => ws.read('link/secret.txt'), /outside the workspace/, 'a link out of the folder is refused'); }
});

test('write: only existing text files, and only in the workspace', () => {
  const { root, ws } = rig();
  const w = ws.write('bob/report.md', '# Edited'); assert.equal(fs.readFileSync(path.join(root, 'bob', 'report.md'), 'utf8'), '# Edited'); assert.equal(w.size, 8);
  assert.throws(() => ws.write('bob/tool.exe', 'x'), /Only text files/); assert.throws(() => ws.write('bob/new.md', 'x'), /does not exist/);
  assert.throws(() => ws.write('bob/report.md', 'x'.repeat(1024 * 1024 + 1)), /more than 1 MB/); assert.equal(ws.reveal('bob/report.md'), path.join(root, 'bob', 'report.md'));
});

test('watch: a new file is noticed, and stopping really stops', async () => {
  const { root, ws } = rig(); let n = 0; const stop = ws.watch(() => n++, 50);
  await new Promise(r => setTimeout(r, 100)); fs.writeFileSync(path.join(root, 'bob', 'fresh.md'), 'new'); await new Promise(r => setTimeout(r, 500));
  assert.ok(n >= 1, 'the change was reported'); stop(); const before = n; fs.writeFileSync(path.join(root, 'bob', 'later.md'), 'x'); await new Promise(r => setTimeout(r, 300)); assert.equal(n, before, 'no reports after stop');
});
