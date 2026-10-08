'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { createTools } = require('../lib/tools');
const screen = require('../lib/screen');

const JPEG = Buffer.from('FAKE-JPEG-BYTES');
function fakeWindow(log, name = 'main') { let on = false; return { isDestroyed: () => false, isContentProtected: () => on, setContentProtection: v => { on = !!v; log.push(name + ':' + (v ? 'hidden' : 'shown')); } }; }
function fakeElectron({ empty = false, focused = false, bitmap = 10, windows = null, onCapture = null } = {}) {
  const thumb = { isEmpty: () => empty, toJPEG: () => JPEG, resize: () => ({ toJPEG: () => Buffer.from('tiny'), toBitmap: () => Buffer.alloc(2304, bitmap) }) };
  const display = { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  return { desktopCapturer: { getSources: async o => { fakeElectron.lastSize = o.thumbnailSize; if (onCapture) onCapture(); return [{ display_id: '1', thumbnail: thumb }]; } },
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display }, BrowserWindow: { getFocusedWindow: () => (focused ? {} : null), ...(windows ? { getAllWindows: () => windows } : {}) } };
}
const geminiSaying = (text, seen = []) => ({ generate: async (cfg, body) => { seen.push(body); return { candidates: [{ content: { parts: [{ text }] } }] }; } });

test('diffScore: identical is 0, different is large, different sizes count as changed', () => {
  assert.equal(screen.diffScore(Buffer.alloc(64, 5), Buffer.alloc(64, 5)), 0);
  assert.ok(screen.diffScore(Buffer.alloc(64, 5), Buffer.alloc(64, 200)) > 100);
  assert.equal(screen.diffScore(Buffer.alloc(8), Buffer.alloc(9)), 255);
});

test('describe: sends the picture with safety rules, returns text marked untrusted, never touches disk', async () => {
  const seen = [], bus = new EventEmitter(); let previews = 0; bus.on('screen:frame', p => { if (p.jpeg) previews++; });
  // A private temp folder: if describe() wrote anything to disk it would land here (the shared Windows temp folder changes all the time by itself).
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-screen-test-')), saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = priv;
  const out = await screen.describe({ question: 'What is the error?' }, { getCfg: () => ({ apiKey: 'k', textModel: 'm' }), gemini: geminiSaying('A red error dialog says: file not found.', seen), bus, electron: fakeElectron() });
  assert.equal(out.description, 'A red error dialog says: file not found.'); assert.equal(out.untrusted, true); assert.equal(out.screen, '1280x720');
  const parts = seen[0].contents[0].parts; assert.match(parts[0].text, /untrusted DATA/); assert.match(parts[0].text, /passwords/); assert.match(parts[0].text, /What is the error\?/);
  assert.equal(parts[1].inlineData.mimeType, 'image/jpeg'); assert.equal(Buffer.from(parts[1].inlineData.data, 'base64').toString(), 'FAKE-JPEG-BYTES');
  assert.equal(previews, 1, 'a preview is published for the UI'); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } assert.deepEqual(fs.readdirSync(priv), [], 'no file was written'); fs.rmSync(priv, { recursive: true, force: true });
  assert.equal(fakeElectron.lastSize.width, 1280, 'large screens are scaled down before sending');
});

test('describe: clear errors and the Orbit-in-front note', async () => {
  const deps = extra => ({ getCfg: () => ({ apiKey: 'k' }), gemini: geminiSaying('ok'), electron: fakeElectron(extra) });
  await assert.rejects(screen.describe({}, { ...deps(), getCfg: () => ({ apiKey: '' }) }), /Gemini key/);
  await assert.rejects(screen.describe({}, deps({ empty: true })), /capture the screen/);
  await assert.rejects(screen.describe({}, { ...deps(), gemini: geminiSaying('') }), /did not describe/);
  const out = await screen.describe({}, deps({ focused: true })); assert.match(out.note, /Orbit window itself is in front/);
  const dflt = []; await screen.describe({}, { ...deps(), gemini: geminiSaying('x', dflt) }); assert.match(dflt[0].contents[0].parts[0].text, /Describe what is on the screen/);
});

test('frame (Watch): sends a change once, skips duplicates, skips Orbit itself, force overrides', async () => {
  const a = await screen.frame({ force: true }, fakeElectron({ bitmap: 10 }));
  assert.equal(a.changed, true); assert.equal(Buffer.from(a.base64, 'base64').toString(), 'FAKE-JPEG-BYTES'); assert.ok(a.preview);
  assert.equal((await screen.frame({}, fakeElectron({ bitmap: 10 }))).changed, false, 'same picture is not sent again');
  const c = await screen.frame({}, fakeElectron({ bitmap: 200 })); assert.equal(c.changed, true, 'a different picture is sent');
  const f = await screen.frame({}, fakeElectron({ focused: true, bitmap: 90 })); assert.deepEqual(f, { changed: false, focused: true });
  assert.equal((await screen.frame({ force: true }, fakeElectron({ focused: true, bitmap: 90 }))).changed, true, 'force works even when Orbit is in front');
});

test('look_at_screen tool: commander asks first, session grant sticks, deny is respected, workers cannot use it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-s-')); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const asked = []; let answer = 'once', looks = 0;
  const tools = createTools({ home, getCfg: () => ({ aiName: 'Nova' }), gemini: {}, bus: new EventEmitter(), ask: async r => { asked.push(r); return answer; }, runtime: {}, openExternal: async () => {}, shell: () => {},
    screenImpl: { describe: async a => { looks++; return { description: 'a code editor', question: a.question, untrusted: true }; } } });
  assert.equal(tools.decide('look_at_screen', {}, 'commander').level, 'ask'); assert.equal(tools.decide('look_at_screen', {}, 'alice').level, 'deny');
  let r = await tools.exec('look_at_screen', { question: 'what app is this?' }); assert.equal(r.ok, true); assert.equal(r.description, 'a code editor'); assert.equal(asked.length, 1); assert.match(asked[0].title, /Look at your screen/); assert.equal(asked[0].allowSession, true);
  await tools.exec('look_at_screen', {}); assert.equal(asked.length, 2, 'allow once asks again');
  answer = 'session'; await tools.exec('look_at_screen', {}); await tools.exec('look_at_screen', {}); assert.equal(asked.length, 3, 'after "for this session" it does not ask again'); assert.equal(looks, 4);
  const denied = createTools({ home, getCfg: () => ({}), gemini: {}, bus: new EventEmitter(), ask: async () => 'deny', runtime: {}, openExternal: async () => {}, shell: () => {}, screenImpl: { describe: async () => { throw new Error('must not run'); } } });
  r = await denied.exec('look_at_screen', {}); assert.equal(r.ok, false); assert.match(r.error, /declined/);
  r = await tools.exec('look_at_screen', {}, 'alice'); assert.equal(r.ok, false, 'crew agents do not get this tool');
  assert.ok(tools.declarationsFor('commander').some(d => d.name === 'look_at_screen')); assert.ok(!tools.declarationsFor('alice').some(d => d.name === 'look_at_screen'));
});

test('Orbit hides its own windows from the screenshot, then shows them again (even if the capture fails)', async () => {
  const log = [], wins = [fakeWindow(log, 'a'), fakeWindow(log, 'b')]; let during = null;
  const out = await screen.describe({}, { getCfg: () => ({ apiKey: 'k' }), gemini: geminiSaying('the apps behind Orbit'), electron: fakeElectron({ windows: wins, focused: true, onCapture: () => { during = log.slice(); } }) });
  assert.deepEqual(during, ['a:hidden', 'b:hidden'], 'both windows were excluded from capture BEFORE the screenshot');
  assert.deepEqual(log, ['a:hidden', 'b:hidden', 'a:shown', 'b:shown'], 'and restored afterwards');
  assert.equal(out.note, undefined, 'no "Orbit is in front" warning when Orbit was hidden from the capture');
  log.length = 0; await assert.rejects(screen.describe({}, { getCfg: () => ({ apiKey: 'k' }), gemini: geminiSaying('x'), electron: fakeElectron({ windows: wins, empty: true }) }), /capture the screen/);
  assert.deepEqual(log, ['a:hidden', 'b:hidden', 'a:shown', 'b:shown'], 'windows are restored after a failed capture too');
});

test('screenHideBridge: false switches the hiding off and brings the old warning back', async () => {
  const log = [], out = await screen.describe({}, { getCfg: () => ({ apiKey: 'k', screenHideBridge: false }), gemini: geminiSaying('x'), electron: fakeElectron({ windows: [fakeWindow(log)], focused: true }) });
  assert.deepEqual(log, [], 'no window was touched'); assert.match(out.note, /Orbit window itself is in front/);
});

test('Watch: frames keep flowing while Orbit is in front, and Orbit stays hidden until Watch stops', async () => {
  const log = [], wins = [fakeWindow(log)];
  const a = await screen.frame({ reset: true, force: true }, fakeElectron({ windows: wins, focused: true, bitmap: 30 }), {});
  assert.equal(a.changed, true); assert.equal(a.hidden, true); assert.deepEqual(log, ['main:hidden'], 'hidden at the start of Watch and left hidden');
  const b = await screen.frame({}, fakeElectron({ windows: wins, focused: true, bitmap: 220 }), {});
  assert.equal(b.changed, true, 'no "Orbit is focused" skip when it is hidden from the capture'); assert.deepEqual(log, ['main:hidden'], 'no flicker between frames');
  const c = await screen.frame({ stop: true }, fakeElectron({ windows: wins }), {});
  assert.equal(c.stopped, true); assert.deepEqual(log, ['main:hidden', 'main:shown'], 'shown again when Watch stops');
});
