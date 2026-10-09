'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../lib/sandbox');
const { Home } = require('../lib/home');
const { HermesEngine } = require('../lib/hermes');

const tmpOk = { allowUnder: [os.tmpdir()] };
const mk = () => { const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'))); const app = path.join(base, 'orbit-app'), proj = path.join(base, 'tin-tin'), proj2 = path.join(base, 'other', 'tin-tin'); for (const d of [app, path.join(app, 'lib'), proj, proj2]) fs.mkdirSync(d, { recursive: true }); return { base, app, proj, proj2 }; };

test('settings: only sensible values are kept, and memory can never be more than Docker owns', () => {
  assert.deepEqual(S.normalize({}), { enabled: false, folders: [], network: true, memoryMB: 3072, cpu: 2 });
  const n = S.normalize({ enabled: 1, memoryMB: 999999, cpu: 99, network: false, folders: ['a', 5] }); assert.deepEqual(n, { enabled: true, folders: ['a', '5'], network: false, memoryMB: 3072, cpu: 2 }, 'a wrong memory or cpu value falls back');
  assert.equal(S.normalize({ memoryMB: 4096 }, { memoryMB: 2048, enabled: true }).memoryMB, 4096); assert.equal(S.normalize({}, { memoryMB: 2048, enabled: true }).memoryMB, 2048, 'what is not sent stays as it was'); assert.equal(S.normalize({}, { enabled: true }).enabled, true);
  assert.equal(S.clampMemory(3072, 8000), 3072); assert.equal(S.clampMemory(6144, 4000), 2464, 'leaves 1.5 GB for Docker itself'); assert.equal(S.clampMemory(3072, 2000), 1024, 'never below 1 GB'); assert.equal(S.clampMemory(3072, 0), 3072, 'Docker size unknown: as asked');
});

test('folders: the same rules as Files, and never Orbit\'s own program, above it or inside it', () => {
  const { base, app, proj, proj2 } = mk(), o = { ...tmpOk, appDir: app };
  const ok = S.checkFolders([proj, proj2], o); assert.equal(ok.ok, true, ok.error); assert.equal(ok.roots.length, 2);
  const above = S.checkFolders([base], o); assert.equal(above.ok, false); assert.match(above.error, /contains Orbit's own program/); assert.match(above.error, /Choose the project folder itself/);
  const inside = S.checkFolders([path.join(app, 'lib')], o); assert.equal(inside.ok, false); assert.match(inside.error, /inside Orbit's own program folder/);
  assert.match(S.checkFolders(['/etc'], o).error, /system folder|does not exist/); assert.match(S.checkFolders([], o).error, /at least one folder/); assert.match(S.checkFolders([path.join(base, 'missing')], o).error, /does not exist/);
  assert.equal(S.checkFolders([proj], { ...tmpOk }).ok, true, 'without an app folder given only the general rules apply');
  const W = path.win32; const winHome = { root: 'G:\\bridge-os\\BridgeHome', p: (...a) => W.join('G:\\bridge-os\\BridgeHome', ...a) };
  assert.match(S.checkFolders(['G:\\jarvis-claude'], { P: W, skipExists: true, appDir: 'G:\\jarvis-claude\\bridge-os', home: winHome }).error, /contains Orbit's own program/, 'the folder above the app on Zee\'s PC is refused');
  assert.equal(S.checkFolders(['G:\\projects\\tin-tin'], { P: W, skipExists: true, appDir: 'G:\\jarvis-claude\\bridge-os', home: winHome }).ok, true); assert.match(S.checkFolders(['G:\\bridge-os\\BridgeHome'], { P: W, skipExists: true, appDir: 'G:\\jarvis-claude\\bridge-os', home: winHome }).error, /Orbit's own/);
});

test('the Hermes config: nothing for a normal member; a locked-down Docker container for a sandboxed one', () => {
  assert.equal(S.terminalLines({}), ''); assert.equal(S.terminalLines({ sandbox: { enabled: false, folders: ['/x'] } }), '', 'off means off, whatever is saved');
  const agent = { sandbox: { enabled: true, folders: ['G:\\projects\\tin-tin', 'D:\\work\\Tin Tin', 'G:\\other\\tin-tin'], network: false, memoryMB: 4096, cpu: 3 } };
  const t = S.terminalLines(agent, { ws: 'G:\\bridge-os\\BridgeHome\\workspace\\alex', dockerMemMB: 8000 }); const L = t.split('\n');
  assert.ok(L.every(l => l === '' || /^ {2}\S/.test(l) || /^ {4}- "/.test(l)), 'indented under terminal:');
  for (const must of ['  backend: docker', '  docker_mount_cwd_to_workspace: false', '  docker_forward_env: []', '  docker_network: false', '  container_cpu: 3', '  container_memory: 4096', '  container_persistent: true']) assert.ok(L.includes(must), must);
  assert.match(t, /docker_image: "nikolaik\/python-nodejs:python3\.11-nodejs20"/);
  const vols = L.filter(l => /^ {4}- /.test(l)).map(l => JSON.parse(l.slice(6))); assert.deepEqual(vols, ['G:\\projects\\tin-tin:/workspace/tin-tin', 'D:\\work\\Tin Tin:/workspace/tin-tin-2', 'G:\\other\\tin-tin:/workspace/tin-tin-3', 'G:\\bridge-os\\BridgeHome\\workspace\\alex:/output'], 'same folder names get numbers; the member\'s own workspace is /output');
  assert.ok(!/BridgeHome\\connectors|secrets|\.token/.test(t), 'no secret places are mounted');
  assert.match(S.terminalLines(agent, { ws: 'w', dockerMemMB: 4000 }), /container_memory: 2464/); assert.match(S.terminalLines({ sandbox: { enabled: true, folders: [] } }, { ws: 'w' }), /docker_network: true/);
  assert.match(S.terminalLines({ sandbox: { enabled: true, folders: ['/a"b'] } }, { ws: 'w' }), /- "\/a\\"b:\/workspace\/a-b"/, 'quotes in a path cannot break the file');
});

test('a Hermes profile for a sandboxed member really contains the Docker block, and a normal one does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-h-')), home = new Home(path.join(root, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: '', lang: 'mix', engine: 'hermes', hermesPath: 'hermes', workerProvider: 'custom', workerModel: 'm', workerApiKey: 'k'.repeat(24), workerBaseUrl: 'http://127.0.0.1:9/v1' };
  const eng = new HermesEngine({ home, getCfg: () => cfg }); eng.extraYaml = a => ({ agent: '', top: '', env: [], terminal: S.terminalLines(a, { ws: home.p('workspace', a.id), dockerMemMB: 8000 }) });
  const alex = home.createAgent({ name: 'Alex', role: 'Developer' }), bob = home.createAgent({ name: 'Bob', role: 'Researcher' }); for (const a of [alex, bob]) fs.mkdirSync(eng.profileDir(a.id), { recursive: true });   // (normally made by hermes profile create)
  const h1 = eng.writeProfile(bob, 1111), y1 = fs.readFileSync(path.join(eng.profileDir(bob.id), 'config.yaml'), 'utf8'); assert.ok(!/backend: docker/.test(y1)); assert.match(y1, /terminal:\n  cwd: /);
  const box = { ...alex, sandbox: { enabled: true, folders: [path.join(root, 'proj')], network: true, memoryMB: 3072, cpu: 2 } }; const h2 = eng.writeProfile(box, 1112), y2 = fs.readFileSync(path.join(eng.profileDir(alex.id), 'config.yaml'), 'utf8');
  assert.match(y2, /terminal:\n  cwd: .*\n  backend: docker\n/); assert.match(y2, /docker_volumes:\n    - ".*:\/workspace\/proj"\n    - ".*:\/output"\napprovals:/, 'the block ends before the next section'); assert.ok(y2.indexOf('compression:') > y2.indexOf('docker_volumes'));
  const h3 = eng.writeProfile({ ...box, sandbox: { ...box.sandbox, network: false } }, 1112); assert.notEqual(h2, h3, 'a change gives a new fingerprint, so the running member restarts with the new sandbox'); assert.equal(eng.writeProfile(box, 9999), h2, 'the port does not change it');
  const env = fs.readFileSync(path.join(eng.profileDir(alex.id), '.env'), 'utf8'); assert.ok(!/BridgeHome|secrets/.test(env));
});

test('Hermes does not inherit secrets from the Windows environment', () => {
  const src = { PATH: 'C:\\x', SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', GITHUB_TOKEN: 't', NPM_TOKEN: 'n', AWS_SECRET_ACCESS_KEY: 's', AWS_ACCESS_KEY_ID: 'a', DB_PASSWORD: 'p', MY_CREDENTIALS: 'c', SSH_AUTH_SOCK: '/s', SESSIONNAME: 'Console', KEYBOARD_LAYOUT: 'us', TOKENIZERS_PARALLELISM: 'false', APPDATA: 'C:\\a', HTTP_PROXY: 'http://p' };
  const out = S.scrubEnv(src); assert.deepEqual(Object.keys(out).sort(), ['APPDATA', 'HTTP_PROXY', 'KEYBOARD_LAYOUT', 'PATH', 'SESSIONNAME', 'SSH_AUTH_SOCK', 'SystemRoot', 'TEMP', 'TOKENIZERS_PARALLELISM'].sort(), 'what Windows and the tools need stays, what looks like a secret goes');
  assert.deepEqual(S.scrubEnv(null), {}); const eng = new HermesEngine({ home: { root: '/h' }, getCfg: () => ({}) }); process.env.ORBIT_TEST_API_KEY = 'leak'; process.env.ORBIT_TEST_KEEP = 'ok'; const e = eng.env(); assert.equal(e.ORBIT_TEST_API_KEY, undefined); assert.equal(e.ORBIT_TEST_KEEP, 'ok'); assert.ok(e.HERMES_HOME.endsWith('hermes')); delete process.env.ORBIT_TEST_API_KEY; delete process.env.ORBIT_TEST_KEEP;
});

// A pretend Docker: answers like the real one for the calls the sandbox makes.
const fake = (over = {}) => { const calls = []; const run = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); const a = args.join(' '); if (over.any) { const r = over.any(a); if (r) return r; }
  if (a.startsWith('info')) return over.info || { code: 0, stdout: 'linux|29.5.3|8284889088\n', stderr: '' }; if (a.startsWith('image inspect')) return over.image || { code: 0, stdout: 'sha256:abc\n', stderr: '' }; if (a.startsWith('pull')) return over.pull || { code: 0, stdout: '', stderr: '' };
  if (a.includes('DIR:')) return over.mount || { code: 0, stdout: 'DIR:/workspace/tin-tin:12\nDIR:/workspace/other:3\nSECRETS:\nMNT:\nUSER:0\n', stderr: '' };
  if (a.includes('ls /workspace 2>/dev/null')) return over.iso || { code: 0, stdout: '0\n0\n0\n0\n', stderr: '' }; return { code: 1, stdout: '', stderr: 'unexpected: ' + a }; }; return { run, calls }; };

test('Docker check: not installed, not running, wrong mode, and fine, each with words you can act on', async () => {
  const bad = async r => S.probeDocker(fake({ info: r }).run);
  assert.match((await bad({ code: -1, stderr: '', error: 'spawn docker ENOENT', notFound: true })).error, /not installed/); assert.match((await bad({ code: 1, stderr: 'failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; ... The system cannot find the file specified.' })).error, /Docker Desktop is not running/);
  const win = await bad({ code: 0, stdout: 'windows|29|8000000000' }); assert.equal(win.ok, false); assert.match(win.error, /Linux containers/); const good = await S.probeDocker(fake().run); assert.deepEqual([good.ok, good.os, good.version, good.memMB], [true, 'linux', '29.5.3', 7901]); assert.equal(S.lastDockerMB, 7901);
});

test('the sandbox test: it must really start, see your folders, and see nothing else', async () => {
  const agent = { sandbox: { enabled: true, folders: ['G:\\p\\tin-tin', 'G:\\p\\other'], memoryMB: 3072 } };
  const f = fake(); const r = await S.testSandbox(f.run, agent, {}); assert.equal(r.ok, true, JSON.stringify(r.steps)); assert.deepEqual(r.steps.map(s => s.name), ['Docker is running (Linux)', 'The sandbox image', 'A container starts with your folders', 'Folder tin-tin', 'Folder other', 'No key files inside the shared folders', 'Without a mount it sees nothing of your computer']);
  const run = f.calls.find(c => c.includes('DIR:')); assert.ok(run.includes('--network none') && run.includes('--memory 3072m'), 'the test itself has no network and the memory limit'); assert.ok(run.includes('-v G:\\p\\tin-tin:/workspace/tin-tin:ro') && run.includes('-v G:\\p\\other:/workspace/other:ro'), 'the folders are mounted read-only for the test'); assert.ok(!f.calls.some(c => c.startsWith('docker pull')), 'no download when the image is there');
  const pulled = fake({ image: { code: 1, stdout: '', stderr: 'no such image' } }); const rp = await S.testSandbox(pulled.run, agent, {}); assert.equal(rp.ok, true); assert.ok(pulled.calls.some(c => c.startsWith('docker pull nikolaik/')), 'it downloads the image when needed'); assert.match(rp.steps[1].detail, /downloaded now/);
  const nodocker = await S.testSandbox(fake({ info: { code: 1, stderr: 'daemon is not running' } }).run, agent, {}); assert.equal(nodocker.ok, false); assert.equal(nodocker.steps.length, 1, 'it stops at the first problem');
  const missing = await S.testSandbox(fake({ mount: { code: 0, stdout: 'DIR:/workspace/tin-tin:12\nSECRETS:\n' } }).run, agent, {}); assert.equal(missing.ok, false); assert.match(missing.steps.find(s => s.name === 'Folder other').detail, /not visible inside the container/);
  const keys = await S.testSandbox(fake({ mount: { code: 0, stdout: 'DIR:/workspace/tin-tin:12\nDIR:/workspace/other:3\nSECRETS:/workspace/tin-tin/.env /workspace/other/secrets.json \n' } }).run, agent, {}); assert.equal(keys.ok, false); assert.match(keys.steps.at(-2).detail, /\.env/); assert.match(keys.steps.at(-2).detail, /Move them out/);
  const leak = await S.testSandbox(fake({ iso: { code: 0, stdout: '0\n0\n4\n0\n' } }).run, agent, {}); assert.equal(leak.ok, false); assert.match(leak.steps.at(-1).detail, /it saw 0\/0\/4\/0 items/);
  const boot = await S.testSandbox(fake({ mount: { code: 125, stdout: '', stderr: 'Error response from daemon: Drive has not been shared' } }).run, agent, {}); assert.equal(boot.ok, false); assert.match(boot.steps.at(-1).detail, /Drive has not been shared/);
});
