'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../lib/connectors');

const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-')); return { root, c: new C.Connectors({ home: { p: (...a) => path.join(root, ...a) } }) }; };

test('read or write: a tool is read-only only when its name says reading and nothing says writing', () => {
  for (const n of ['get_issue', 'list_issues', 'search_code', 'retrieve_balance', 'fetch_stripe_resources', 'stripe_api_read', 'get_file_contents', 'search_docs', 'list_tables', 'get_logs']) assert.equal(C.isReadTool(n), true, n);
  for (const n of ['create_issue', 'update_issue', 'delete_repo', 'merge_pull_request', 'stripe_api_write', 'execute_sql', 'apply_migration', 'get_or_create_customer', 'create_refund', 'push_files', 'deploy_edge_function', 'unknown_thing', 'issue_write', '']) assert.equal(C.isReadTool(n), false, n + ' counts as writing');
});

test('the services: verified addresses, a read-only address where the service has one, and required options', () => {
  const s = id => C.CATALOG.find(c => c.id === id);
  assert.equal(s('github').url({}), 'https://api.githubcopilot.com/mcp/'); assert.equal(s('stripe').url({}), 'https://mcp.stripe.com');
  assert.equal(s('linear').url({ mode: 'read-only' }), 'https://mcp.linear.app/mcp/readonly'); assert.equal(s('linear').url({ mode: 'read-write' }), 'https://mcp.linear.app/mcp');
  assert.equal(s('supabase').url({ mode: 'read-only', projectRef: 'abcdefghij' }), 'https://mcp.supabase.com/mcp?project_ref=abcdefghij&read_only=true'); assert.equal(s('supabase').url({ mode: 'read-write', projectRef: 'abcdefghij' }), 'https://mcp.supabase.com/mcp?project_ref=abcdefghij');
  const pub = JSON.stringify(C.publicCatalog()); assert.ok(!/"(pattern|refuse|tokenLooksLike|url)":/.test(pub), 'nothing internal leaks to the page'); assert.equal(C.publicCatalog().length, 6); assert.ok(C.publicCatalog().some(c => c.id === 'neuralops'), 'NeuralOps is in the list'); assert.equal(C.publicCatalog().find(c => c.id === 'files').native, true, 'Orbit\'s own Files tools are in the list, with folders instead of a token');
});

test('adding: mistakes are explained, secrets are cleaned, and unsafe things are refused', () => {
  const ok = C.checkSpec({ catalogId: 'github', token: 'Bearer ghp_abcdefghijklmnop' }); assert.equal(ok.ok, true); assert.equal(ok.token, 'ghp_abcdefghijklmnop', 'a pasted "Bearer " is removed'); assert.equal(ok.mode, 'read-only', 'read-only unless asked'); assert.equal(ok.auth, 'bearer');
  assert.match(C.checkSpec({ catalogId: 'github', token: '' }).error, /needed/); assert.match(C.checkSpec({ catalogId: 'github', token: 'ab cd' }).error, /never has/); assert.match(C.checkSpec({ catalogId: 'nope', token: 'x' }).error, /not in the list/);
  assert.match(C.checkSpec({ catalogId: 'stripe', token: 'sk_live_abcdefghijklmnop' }).error, /restricted key/); assert.equal(C.checkSpec({ catalogId: 'stripe', token: 'rk_test_abcdefghijklmnop' }).ok, true);
  assert.match(C.checkSpec({ catalogId: 'supabase', token: 'sbp_abcdefghij' }).error, /Project ID is needed/); assert.match(C.checkSpec({ catalogId: 'supabase', token: 'sbp_abcdefghij', options: { projectRef: 'has spaces!' } }).error, /does not look right/);
  const sup = C.checkSpec({ catalogId: 'supabase', token: 'sbp_abcdefghij', options: { projectRef: 'abcdefghij' } }); assert.equal(sup.ok, true); assert.match(sup.url, /read_only=true/); assert.match(sup.warn, /development and testing/);
  for (const bad of ['http://example.com/mcp', 'https://localhost/mcp', 'https://192.168.1.5/mcp', 'file:///etc/passwd', 'https://user:pw@example.com/mcp', 'javascript:alert(1)', '']) assert.equal(C.checkSpec({ name: 'mine', url: bad, token: 'abcdefgh1234' }).ok, false, bad);
  const custom = C.checkSpec({ name: 'My Tools!', url: 'https://mcp.example.com/mcp', token: 'abcdefgh1234' }); assert.equal(custom.ok, true); assert.equal(custom.id, 'my_tools'); assert.equal(C.checkSpec({ name: 'open', url: 'https://mcp.example.com/mcp' }).auth, 'none', 'no token = no header');
  assert.match(C.checkSpec({ name: 'orbit', url: 'https://mcp.example.com/mcp' }).error, /reserved/); assert.match(C.checkSpec({ name: '1', url: 'https://mcp.example.com/mcp' }).error, /short name/);
});

test('the list on disk: the secret is kept apart, and every tool has a level (reading is free, changing is blocked or asks)', () => {
  const { root, c } = mk(); const spec = C.checkSpec({ catalogId: 'github', token: 'ghp_abcdefghijklmnop' }); const rec = c.add(spec);
  const json = fs.readFileSync(path.join(root, 'connectors', 'connectors.json'), 'utf8'); assert.ok(!json.includes('ghp_'), 'no secret in the list file'); assert.ok(fs.readFileSync(path.join(root, 'connectors', 'secrets.json'), 'utf8').includes('ghp_abcdefghijklmnop'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, 'connectors', 'secrets.json')).mode & 0o077, 0, 'only the owner can read the secrets');
  assert.throws(() => c.add(spec), /already exists/); assert.equal(rec.enabled, false);
  const after = c.applyTools('github', [{ name: 'list_issues', description: 'List issues' }, { name: 'get_issue' }, { name: 'create_issue' }, { name: 'delete_repo' }, { name: 'odd_tool', annotations: { readOnlyHint: true } }, { name: 'delete_thing', annotations: { readOnlyHint: true } }]);
  assert.deepEqual(after.levels, { list_issues: 'free', get_issue: 'free', create_issue: 'blocked', delete_repo: 'blocked', odd_tool: 'free', delete_thing: 'blocked' }, 'read only: reading is free, changing is blocked; the server\'s own read-only hint helps, but never for a name that says delete');
  assert.equal(after.desc.list_issues, 'List issues'); assert.equal(c.levelOf('github', 'create_issue'), 'blocked'); assert.equal(c.levelOf('github', 'nothing'), 'blocked', 'an unknown tool is blocked');
  c.setMode('github', 'read-write'); assert.deepEqual([c.levelOf('github', 'create_issue'), c.levelOf('github', 'delete_repo'), c.levelOf('github', 'get_issue')], ['ask', 'ask', 'free'], 'read and ask: changes ask every time');
  c.setLevel('github', 'create_issue', 'free'); c.setMode('github', 'read-only'); assert.equal(c.levelOf('github', 'create_issue'), 'blocked', 'back to read only blocks changes again'); c.setMode('github', 'read-write'); assert.equal(c.levelOf('github', 'create_issue'), 'ask', 'and a level set to free is not silently remembered');
  c.setLevel('github', 'delete_repo', 'blocked'); c.applyTools('github', [{ name: 'list_issues' }, { name: 'delete_repo' }, { name: 'brand_new_write' }]); assert.equal(c.levelOf('github', 'delete_repo'), 'blocked', 'a choice of the user is kept after a new test'); assert.equal(c.levelOf('github', 'brand_new_write'), 'ask'); assert.equal(c.levelOf('github', 'get_issue'), 'blocked', 'a tool that disappeared is gone');
  assert.throws(() => c.setLevel('github', 'list_issues', 'maybe'), /free, ask or blocked/); assert.throws(() => c.setLevel('github', 'nope', 'free'), /No such tool/);
  c.remove('github'); assert.equal(c.list().length, 0); assert.ok(!fs.readFileSync(path.join(root, 'connectors', 'secrets.json'), 'utf8').includes('ghp_'), 'removing forgets the secret');
});

test('who sees which connector; Linear/Supabase addresses follow the mode; the crew signature changes with anything they could see', () => {
  const { c } = mk(); c.add(C.checkSpec({ catalogId: 'linear', token: 'lin_api_abcdefghij' })); c.add(C.checkSpec({ name: 'docs', url: 'https://mcp.example.com/mcp' }));
  c.applyTools('linear', [{ name: 'list_issues' }]); c.applyTools('docs', [{ name: 'search_docs' }]); c.update('linear', { enabled: true, agents: ['alex'] }); c.update('docs', { enabled: true });
  assert.equal(c.visibleTo(c.get('linear'), 'alex'), true); assert.equal(c.visibleTo(c.get('linear'), 'bob'), false); assert.equal(c.visibleTo(c.get('docs'), 'bob'), true);
  assert.equal(c.get('docs').auth, 'none'); assert.match(c.get('linear').url, /readonly$/); c.setMode('linear', 'read-write'); assert.ok(!/readonly/.test(c.get('linear').url));
  const s1 = c.signature('bob'), s2 = c.signature('alex'); assert.notEqual(s1, s2, 'Alex sees more than Bob'); c.setLevel('docs', 'search_docs', 'ask'); assert.notEqual(c.signature('bob'), s1, 'a changed level changes what Bob sees, so a running crew member starts again');
  assert.ok(!c.signature('bob').includes('lin_api_'), 'a signature never holds a secret');
});

test('Orbit\'s own tools for the crew: web search is free, looking at the screen asks, and both can be changed', () => {
  const { c } = mk(); assert.deepEqual(c.nativeLevels(), { web_search: 'free', look_at_screen: 'ask' }); c.setNativeLevel('look_at_screen', 'blocked'); assert.equal(c.nativeLevels().look_at_screen, 'blocked'); assert.equal(c.nativeLevels().web_search, 'free');
  assert.throws(() => c.setNativeLevel('run_shell', 'free'), /No such tool/); assert.throws(() => c.setNativeLevel('web_search', 'sometimes'), /No such tool or level/); assert.deepEqual(C.NATIVE_TOOLS.map(t => t.name), ['web_search', 'look_at_screen']);
  assert.equal(C.checkSpec({ name: 'my__tools', url: 'https://mcp.example.com/mcp' }).id, 'my_tools', 'a double underscore separates service and tool in the gateway, so a service name can never contain one');
});

test('reading what "hermes mcp test" says: tools on success, a short reason on failure', () => {
  const good = '\n  Testing \'github\'...\n  Transport: HTTP\n  Connected (115ms)\n  Tools discovered: 3\n\n    list_issues                          List issues in a repo\n    get_issue                            Get one\n    create_issue                         \n';
  const r = C.parseTest(good); assert.equal(r.ok, true); assert.deepEqual(r.tools, ['list_issues', 'get_issue', 'create_issue']); assert.equal(r.count, 3);
  const bad = C.parseTest("  Testing 'github'...\n  Connection failed (7145ms): Client error '401 Unauthorized' for url 'https://api.githubcopilot.com/mcp/'\nFor more information..."); assert.equal(bad.ok, false); assert.match(bad.error, /401 Unauthorized/); assert.ok(!/https?:/.test(bad.error), 'no addresses in the message'); assert.equal(C.parseTest('').ok, false);
  assert.equal(C.envName('my-tools'), 'ORBIT_CONN_MY_TOOLS_TOKEN');
});

test('a connector saved by the first version keeps working: what was allowed is free (reading) or asks (changing), the rest is blocked', () => {
  const { root, c } = mk(); fs.mkdirSync(path.join(root, 'connectors'), { recursive: true });
  fs.writeFileSync(path.join(root, 'connectors', 'connectors.json'), JSON.stringify({ version: 1, servers: [{ id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', auth: 'bearer', mode: 'read-write', enabled: true, agents: 'all', tools: ['list_issues', 'create_issue', 'delete_repo'], allowed: ['list_issues', 'create_issue'] }] }));
  assert.deepEqual(c.get('github').levels, { list_issues: 'free', create_issue: 'ask', delete_repo: 'blocked' }); assert.equal(c.get('github').allowed, undefined); assert.deepEqual(c.get('github').desc, {});
});

test('leads is a second built-in connector, hidden from the "add a connector" list just like library, needing no address or token', () => {
  const C = require('../lib/connectors');
  assert.ok(!C.publicCatalog().some(c => c.id === 'leads')); const spec = C.checkSpec({ catalogId: 'leads' }); assert.equal(spec.ok, true); assert.equal(spec.native, 'leads'); assert.equal(spec.url, 'orbit://leads'); assert.equal(spec.auth, 'none');
});
