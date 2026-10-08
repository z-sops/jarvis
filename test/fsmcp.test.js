'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { FilesProvider, checkRoots, dangerousRoot, isInside } = require('../lib/fsmcp');

const mk = () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'))), root = path.join(base, 'work'), outside = path.join(base, 'outside'), backups = path.join(base, 'backups');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true }); fs.mkdirSync(outside); fs.mkdirSync(path.join(base, 'workX'));
  fs.writeFileSync(path.join(root, 'readme.md'), 'hello orbit\nsecond line\nthird line\n'); fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const a = 1;\nconst b = 2;\n'); fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'skip me');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=secret'); fs.writeFileSync(path.join(outside, 'private.txt'), 'private'); fs.writeFileSync(path.join(base, 'workX', 'sibling.txt'), 'sibling');
  const p = new FilesProvider({ roots: [root], backupDir: backups, forbid: [path.join(base, 'work', 'orbit-data')], trash: async f => { fs.rmSync(f, { recursive: true }); } });
  const call = async (n, a) => { const r = await p.callTool(n, a); return { err: r.isError, text: r.content[0].text }; };
  return { base, root, outside, backups, p, call };
};

test('paths: inside means inside (case-insensitive on Windows, slashes either way, and a folder that only starts with the same letters is NOT inside)', () => {
  const W = path.win32; assert.equal(isInside('C:\\Work\\src\\a.js', 'C:\\Work', W), true); assert.equal(isInside('c:/work/SRC/a.js', 'C:\\WORK', W), true); assert.equal(isInside('C:\\Work', 'C:\\Work', W), true);
  assert.equal(isInside('C:\\WorkX\\a.js', 'C:\\Work', W), false); assert.equal(isInside('C:\\Work\\..\\Other\\a.js', 'C:\\Work', W), false); assert.equal(isInside('D:\\Work\\a.js', 'C:\\Work', W), false);
  assert.equal(isInside('/tmp/workX/a', '/tmp/work'), false); assert.equal(isInside('/tmp/work/a', '/tmp/work'), true);
});

test('roots the user may choose: not a drive, not the system, not the user folder itself, not AppData, not keys, not Orbit\'s own data', () => {
  const W = path.win32, home = { root: 'G:\\bridge-os\\BridgeHome', p: (...a) => W.join('G:\\bridge-os\\BridgeHome', ...a) }, o = { P: W, home, userData: 'C:\\Users\\zee\\AppData\\Roaming\\Orbit', userProfile: 'C:\\Users\\zee' };
  for (const bad of ['C:\\', 'D:\\', 'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files\\App', 'C:\\ProgramData', 'C:\\Users\\zee', 'C:\\Users\\zee\\AppData\\Local\\x', 'C:\\Users\\zee\\.ssh', 'C:\\Users\\zee\\Documents\\.aws\\x', 'G:\\bridge-os', 'G:\\bridge-os\\BridgeHome', 'G:\\bridge-os\\BridgeHome\\connectors', 'G:\\bridge-os\\BridgeHome\\browser'])
    assert.ok(dangerousRoot(bad, o), bad + ' must be refused');
  for (const good of ['C:\\Users\\zee\\Documents', 'G:\\jarvis-claude', 'D:\\Projects\\tin-tin', 'G:\\bridge-os\\BridgeHome\\workspace', 'G:\\bridge-os\\BridgeHome\\workspace\\reports']) assert.equal(dangerousRoot(good, o), '', good + ' is fine');
  assert.ok(dangerousRoot('/', { P: path.posix }) && dangerousRoot('/etc', { P: path.posix }));
  assert.ok(dangerousRoot('C:\\Users\\zee\\AppData\\Local\\Temp\\x', { P: W }), 'AppData is refused'); assert.equal(dangerousRoot('C:\\Users\\zee\\AppData\\Local\\Temp\\x', { P: W, allowUnder: ['C:\\Users\\zee\\AppData\\Local\\Temp'] }), '', 'unless it is the test folder'); assert.ok(dangerousRoot('C:\\Users\\zee\\AppData\\Roaming\\Orbit', { P: W, allowUnder: ['C:\\Users\\zee\\AppData\\Local\\Temp'] }), 'and only that one');
  const r = checkRoots(['relative\\folder'], { skipExists: true }); assert.equal(r.ok, false); assert.match(r.error, /not a full path/);
  assert.match(checkRoots(['\\\\server\\share\\x'], { P: path.win32, skipExists: true }).error, /Network paths/); assert.match(checkRoots([], {}).error, /at least one folder/); assert.match(checkRoots(['/definitely/not/here'], {}).error, /does not exist/);
  const { root } = mk(), tmpOk = { allowUnder: [os.tmpdir()] }; const ok = checkRoots([root, root + path.sep], tmpOk); assert.equal(ok.ok, true, ok.error); assert.equal(ok.roots.length, 1, 'the same folder twice counts once'); assert.match(checkRoots([path.join(root, 'readme.md')], tmpOk).error, /is a file, not a folder/);
});

test('reading: list, tree, read, head/tail, binary and big files, search by name and by text, file info', async () => {
  const { root, p, call } = mk(); assert.equal((await p.listTools()).length, 13, 'the 12 file tools and the Recycle Bin one');
  let r = await call('list_allowed_directories', {}); assert.match(r.text, new RegExp(root.replace(/[\\/]/g, '.')));
  r = await call('list_directory', { path: root }); assert.equal(r.err, false); assert.match(r.text, /\[DIR\] src/); assert.match(r.text, /\[FILE\] readme\.md \(\d+ B\)/); assert.ok(!/\.env/.test(r.text), 'a secret file is not even listed'); assert.match(r.text, /1 secret item not shown/);
  assert.ok(r.text.indexOf('[DIR] node_modules') < r.text.indexOf('[FILE]'), 'folders first');
  r = await call('directory_tree', { path: root }); assert.match(r.text, /src\/\n {2}app\.js/); assert.ok(!/i\.js/.test(r.text), 'node_modules is not walked'); assert.ok(!/\.env/.test(r.text));
  r = await call('read_text_file', { path: path.join(root, 'readme.md') }); assert.equal(r.text, 'hello orbit\nsecond line\nthird line\n'); r = await call('read_text_file', { path: 'src/app.js' }); assert.match(r.text, /const a = 1/, 'a relative path means inside the first folder');
  r = await call('read_text_file', { path: path.join(root, 'readme.md'), head: 2 }); assert.equal(r.text, 'hello orbit\nsecond line'); r = await call('read_text_file', { path: path.join(root, 'readme.md'), tail: 1 }); assert.equal(r.text, '');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3])); r = await call('read_text_file', { path: path.join(root, 'bin.dat') }); assert.equal(r.err, true); assert.match(r.text, /binary/);
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(1100000)); r = await call('read_text_file', { path: path.join(root, 'big.txt') }); assert.equal(r.err, true); assert.match(r.text, /limit is 1 MB/); r = await call('read_text_file', { path: path.join(root, 'big.txt'), head: 1 }); assert.equal(r.err, false);
  r = await call('read_multiple_files', { paths: [path.join(root, 'readme.md'), path.join(root, 'nope.txt'), path.join(root, '.env')] }); assert.match(r.text, /hello orbit/); assert.match(r.text, /Not found/); assert.match(r.text, /secret files/, 'one bad path does not spoil the others');
  r = await call('search_files', { path: root, pattern: '*.js' }); assert.match(r.text, /app\.js/); assert.ok(!/i\.js/.test(r.text)); r = await call('search_files', { path: root, pattern: 'README*' }); assert.match(r.text, /readme\.md/, 'not case sensitive'); r = await call('search_files', { path: root, pattern: '*.zip' }); assert.equal(r.text, 'No matches.');
  r = await call('search_text', { path: root, query: 'SECOND' }); assert.match(r.text, /readme\.md:2: second line/); r = await call('search_text', { path: root, query: 'api_key' }); assert.equal(r.text, 'No matches.', 'secret files are not searched'); r = await call('search_text', { path: root, query: 'const', filePattern: '*.js' }); assert.match(r.text, /app\.js:1:/);
  r = await call('get_file_info', { path: path.join(root, 'readme.md') }); assert.match(r.text, /type: file/); assert.match(r.text, /size: 35 B/);
});

test('changing: write keeps the old version, edit needs exactly one match, move never overwrites, trash goes to the bin', async () => {
  const { root, backups, p, call } = mk(); const f = path.join(root, 'notes.txt');
  let r = await call('write_file', { path: f, content: 'one' }); assert.match(r.text, /^Created /); assert.ok(!fs.existsSync(backups), 'a new file has no old version'); r = await call('write_file', { path: f, content: 'two' }); assert.match(r.text, /Replaced .*The old version is kept as .*notes\.txt/); assert.equal(fs.readFileSync(f, 'utf8'), 'two'); assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), 'utf8'), 'one');
  r = await call('write_file', { path: path.join(root, 'new', 'deep.txt'), content: 'x' }); assert.equal(r.err, true, 'a written file needs its folder to exist'); r = await call('create_directory', { path: path.join(root, 'new', 'deep') }); assert.match(r.text, /Created/); r = await call('write_file', { path: path.join(root, 'new', 'deep', 'a.txt'), content: 'ok' }); assert.equal(r.err, false); r = await call('create_directory', { path: path.join(root, '..', 'escape', 'x') }); assert.equal(r.err, true, 'a new folder cannot start outside'); assert.ok(!fs.existsSync(path.join(root, '..', 'escape')));
  r = await call('write_file', { path: f, content: 'x'.repeat(2100000) }); assert.equal(r.err, true); assert.match(r.text, /2 MB/); r = await call('write_file', { path: root, content: 'x' }); assert.equal(r.err, true);
  fs.writeFileSync(f, 'alpha\r\nbeta\r\nbeta\r\n'); r = await call('edit_file', { path: f, edits: [{ oldText: 'beta', newText: 'gamma' }] }); assert.equal(r.err, true); assert.match(r.text, /appears 2 times/); assert.equal(fs.readFileSync(f, 'utf8'), 'alpha\r\nbeta\r\nbeta\r\n', 'nothing changed');
  r = await call('edit_file', { path: f, edits: [{ oldText: 'nothing here', newText: 'x' }] }); assert.match(r.text, /not found. Nothing was changed/); r = await call('edit_file', { path: f, edits: [{ oldText: 'alpha\nbeta\nbeta', newText: 'A\nB' }], dryRun: true }); assert.match(r.text, /Dry run/); assert.equal(fs.readFileSync(f, 'utf8'), 'alpha\r\nbeta\r\nbeta\r\n');
  r = await call('edit_file', { path: f, edits: [{ oldText: 'alpha', newText: 'ALPHA' }, { oldText: 'beta\nbeta', newText: 'B' }] }); assert.equal(r.err, false); assert.equal(fs.readFileSync(f, 'utf8'), 'ALPHA\r\nB\r\n', 'Windows line endings are kept'); assert.equal(r.text.includes('kept as'), true);
  r = await call('move_file', { source: f, destination: path.join(root, 'moved.txt') }); assert.match(r.text, /^Moved/); assert.ok(fs.existsSync(path.join(root, 'moved.txt'))); fs.writeFileSync(path.join(root, 'other.txt'), 'o'); r = await call('move_file', { source: path.join(root, 'moved.txt'), destination: path.join(root, 'other.txt') }); assert.equal(r.err, true); assert.match(r.text, /never overwrites/); assert.equal(fs.readFileSync(path.join(root, 'other.txt'), 'utf8'), 'o');
  r = await call('move_file', { source: root, destination: path.join(root, '..', 'elsewhere') }); assert.equal(r.err, true); r = await call('trash_file', { path: path.join(root, 'other.txt') }); assert.match(r.text, /Recycle Bin/); assert.ok(!fs.existsSync(path.join(root, 'other.txt'))); r = await call('trash_file', { path: root }); assert.equal(r.err, true); assert.match(r.text, /allowed folder itself/);
  const noBin = new FilesProvider({ roots: [root] }); assert.ok(!(await noBin.listTools()).some(t => t.name === 'trash_file'), 'no trash tool without a Recycle Bin');
});

test('escaping: outside folders, ../, a folder with a similar name, links out, secret files, .git, Orbit\'s own data, odd paths', async () => {
  const { base, root, outside, p, call } = mk();
  for (const bad of [path.join(outside, 'private.txt'), path.join(root, '..', 'outside', 'private.txt'), path.join(base, 'workX', 'sibling.txt'), '../outside/private.txt', '/etc/hostname', path.join(root, '..')]) { const r = await call('read_text_file', { path: bad }); assert.equal(r.err, true, bad); assert.match(r.text, /outside the allowed folders|Not found|folder, not a file/, bad); assert.ok(!/private|sibling/.test(r.text.replace(/outside\/private\.txt|private\.txt|sibling\.txt/g, '')), 'no content leaked'); }
  let links = true; try { fs.symlinkSync(outside, path.join(root, 'link-out'), 'dir'); fs.symlinkSync(path.join(outside, 'private.txt'), path.join(root, 'link-file.txt')); } catch { links = false; }   // Windows only allows links with a privilege
  for (const viaLink of links ? [path.join(root, 'link-out', 'private.txt'), path.join(root, 'link-file.txt')] : []) { const r = await call('read_text_file', { path: viaLink }); assert.equal(r.err, true, 'a link that leads outside is refused: ' + viaLink); assert.match(r.text, /outside the allowed folders/); }
  let r = { text: '' }; if (links) { r = await call('write_file', { path: path.join(root, 'link-out', 'planted.txt'), content: 'x' }); assert.equal(r.err, true); assert.ok(!fs.existsSync(path.join(outside, 'planted.txt')), 'nothing was written outside'); }
  r = await call('search_text', { path: root, query: 'private' }); assert.equal(r.text, 'No matches.', 'searching does not follow links out'); r = await call('directory_tree', { path: root }); assert.ok(!/private/.test(r.text));
  for (const secret of ['.env', 'id_rsa', 'server.pem', 'secrets.json', '.npmrc', 'creds.key']) { fs.writeFileSync(path.join(root, secret), 's'); const rd = await call('read_text_file', { path: path.join(root, secret) }); assert.equal(rd.err, true, secret); assert.match(rd.text, /secret files/); const wr = await call('write_file', { path: path.join(root, secret), content: 'x' }); assert.equal(wr.err, true, 'nor written: ' + secret); }
  fs.mkdirSync(path.join(root, '.git')); fs.writeFileSync(path.join(root, '.git', 'config'), '[core]'); r = await call('read_text_file', { path: path.join(root, '.git', 'config') }); assert.equal(r.err, false, '.git can be read'); r = await call('write_file', { path: path.join(root, '.git', 'config'), content: 'x' }); assert.equal(r.err, true); assert.match(r.text, /inside \.git/);
  fs.mkdirSync(path.join(root, '.ssh')); fs.writeFileSync(path.join(root, '.ssh', 'config'), 'Host x'); r = await call('read_text_file', { path: path.join(root, '.ssh', 'config') }); assert.equal(r.err, true); assert.match(r.text, /holds keys and logins/);
  fs.mkdirSync(path.join(root, 'orbit-data')); fs.writeFileSync(path.join(root, 'orbit-data', 'x.txt'), 'x'); r = await call('read_text_file', { path: path.join(root, 'orbit-data', 'x.txt') }); assert.equal(r.err, true); assert.match(r.text, /Orbit's own data/);
  for (const odd of ['', '   ', 'a\0b']) { r = await call('read_text_file', { path: odd }); assert.equal(r.err, true, JSON.stringify(odd)); }
  r = await call('read_text_file', {}); assert.equal(r.err, true); r = await call('nope_tool', {}); assert.match(r.text, /Unknown tool/);
  const W = new FilesProvider({ roots: [root], P: path.win32 }); for (const winBad of ['\\\\server\\share\\a.txt', '\\\\?\\C:\\Windows\\win.ini', 'C:\\file.txt:hidden', 'C:\\file.txt::$DATA']) { const rr = await W.callTool('read_text_file', { path: winBad }); assert.equal(rr.isError, true, winBad); assert.match(rr.content[0].text, /not allowed|not valid/, winBad); }
});
