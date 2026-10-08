'use strict';
// Offline renderer integration: real UI, preload API, Home, Workers and panel handlers.
// Electron window/process APIs and model engines are fixtures. Never uses the user's home or real keys.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert/strict');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home'), { createWorkers } = require('../lib/workers'), { createStore, VOICES } = require('../lib/store');
const { registerJobControls } = require('../lib/job-control'), review = require('../lib/job-review');
function playwright() {
  try { return require('playwright'); } catch { /* use an existing Work runtime if available */ }
  if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) return require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
  throw new Error('Playwright must already be installed to run this optional UI check. No dependencies are installed by this script.');
}
async function main() {
  const out = path.resolve(process.env.ORBIT_UI_RESULTS || path.join(__dirname, '..', 'test-results', 'playwright'));
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-playwright-'));
  const home = new Home(path.join(temp, 'home')).ensure(), store = createStore(path.join(temp, 'settings.json'));
  store.set({ commissioned: true, aiName: 'Laila', userName: 'Zee', userTitle: '', homeDir: home.root, sfx: false, launchOnStart: false, engine: 'hermes', apiKey: '', autoWake: false });
  home.createAgent({ name: 'Alex', role: 'Developer' }); home.createAgent({ name: 'Bob', role: 'Tester' });
  const bus = new EventEmitter(), pages = new Set(), handlers = new Map(), errors = [], checks = [], engineCalls = [];
  const event = { sender: {} }, windowFixture = { webContents: event.sender };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const send = (type, payload) => { for (const page of pages) page.evaluate(data => window.__orbitPush?.(data), { type, payload }).catch(() => {}); };
  for (const name of ['agent:state', 'job:created', 'job:done', 'job:reviewed', 'profile:changed']) bus.on(name, payload => send(name, payload));
  const workers = createWorkers({ home, bus, getCfg: store.get, gemini: {}, tools: {}, hermes: { runTask: async (agent, task, { signal }) => {
    engineCalls.push({ actor: agent.id, task });
    if (/Wait for cancellation/.test(task)) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    if (/proof\.txt/.test(task)) fs.writeFileSync(home.p('workspace', agent.id, 'proof.txt'), 'Offline fixture artifact.');
    return /Untrusted report/.test(task) ? '<img src=x onerror="window.__injected=true">' : 'Worker report: inspect proof.txt and accept only after review.';
  } } });
  const panels = require('../lib/panels'), usage = panels.makeUsage({ home }), audit = panels.makeAudit({ home, bus }), chat = panels.chatGuard(bus);
  const shell = { showItemInFolder() {}, openPath: async () => '' };
  const panel = panels.register({ ipcMain, shell, home, bus, send, workers, usage, audit, chat, getCfg: store.get });
  const common = { ipcMain, home, store, bus, shell, win: () => windowFixture };
  require('../lib/memory-panel').register(common);
  require('../lib/library-panel').register({ ...common, listAgents: () => home.listAgents(), fetchPageFn: async () => { throw new Error('External network is disabled in this test.'); } });
  require('../lib/topics-panel').register(common);
  registerJobControls({ ipcMain, workers, isTrusted: e => e === event });
  handlers.set('config:get', () => ({ ...store.get(), voices: VOICES }));
  handlers.set('config:save', (_, patch) => ({ ...store.set(patch), voices: VOICES }));
  handlers.set('agents:list', () => home.listAgents().map(a => ({ ...a, ...workers.stateOf(a.id) })));
  handlers.set('agents:inspect', (_, id) => {
    const agent = home.getAgent(id); if (!agent) return null;
    return { agent, folder: home.agentDir(id), soul: home.readBrain(id), skills: [], jobs: home.listJobs(id, 20), jobsError: home.recoveryFaults.get(id) };
  });
  handlers.set('agents:update', (_, id, patch) => ({ ok: true, agent: home.updateAgent(id, patch) }));
  handlers.set('sys:once', () => ({ ok: false })); handlers.set('sys:watch', () => ({ ok: true }));
  handlers.set('startup:mark', () => true);
  handlers.set('connectors:list', () => ({ ok: true, connectors: [], catalog: [], native: [], engine: 'hermes', recent: [] }));
  handlers.set('browser:state', () => ({ ok: true, state: { contexts: [] }, activity: [], settings: { browserApproval: 'sensitive', browserIsolation: 'shared' }, mcpPort: 0 }));
  const initial = (task, status, expectedOutputs = []) => {
    const j = home.createJob('alex', task, { expectedOutputs });
    return home.updateJob('alex', j.id, { status, ...(status === 'review' ? { result: 'Claimed output is ready.', verification: review.evidence(home, 'alex', { ...j, result: 'Claimed output is ready.' }) } : {}) });
  };
  const interrupted = initial('Recover proof.txt', 'running', ['proof.txt']);
  const missing = initial('Missing requested artifact', 'review', ['missing.txt']);
  const report = initial('Report only', 'review');
  const rejected = initial('Please reject this report', 'review');
  const legacy = initial('Older legacy report', 'done');
  home.recoverJobs();
  const renderer = path.resolve(__dirname, '..', 'renderer');
  const server = http.createServer((req, res) => {
    let rel; try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.resolve(renderer, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(renderer + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
    });
  });
  let browser, context;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await playwright().chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer'] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    await context.exposeBinding('__orbitInvoke', async (_source, channel, args) => {
      const handler = handlers.get(channel); if (!handler) return { ok: false, error: 'Offline fixture does not implement ' + channel };
      return await handler(event, ...args);
    });
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    await context.addInitScript({ content: `window.process={platform:'linux'};window.require=n=>{if(n!=='electron')throw new Error('Unexpected preload dependency');return {contextBridge:{exposeInMainWorld:(name,value)=>window[name]=value},ipcRenderer:{invoke:(ch,...args)=>window.__orbitInvoke(ch,args),on:(ch,fn)=>{window.__orbitPush=payload=>fn({},payload)}}};};\n${preload}\ndelete window.require;delete window.process;` });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); pages.add(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const check = async (name, fn) => { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
    const card = id => page.locator(`details[data-job-id="${id}"]`);
    const open = async id => { const c = card(id); await c.locator('summary').click(); return c; };
    const waitText = async (locator, text) => {
      await locator.waitFor({ state: 'visible' });
      const selector = await locator.evaluate(e => '[data-job-id="' + e.closest('[data-job-id]').dataset.jobId + '"]');
      await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
    };
    await check('returning-user boot with the real renderer and preload', async () => { await page.goto(origin); await page.waitForFunction(() => document.body.classList.contains('revealed')); assert.equal(await page.locator('.fatal').count(), 0); });
    await check('all seven screen navigation tabs', async () => {
      for (const [label, id] of [['Office', 'office'], ['Workspace', 'workspace'], ['Browser', 'browser'], ['Connectors', 'connectors'], ['Memory', 'memory'], ['Library', 'library'], ['Orbit', 'bridge']]) {
        await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: label, exact: true }).click(); await page.waitForFunction(id => document.body.dataset.view === id, id);
      }
    });
    await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: 'Office', exact: true }).click();
    await page.evaluate(() => window.__office.select('alex'));
    await check('restart recovery is visible without replaying a model', async () => { const c = await open(interrupted.id); await waitText(c, 'Interrupted'); assert.equal(engineCalls.length, 0); });
    await check('legacy completion is labelled unverified', async () => { const c = await open(legacy.id); await waitText(c, 'Legacy completion (unverified)'); });
    await check('missing output blocks acceptance and displays the reason', async () => {
      const c = await open(missing.id); await c.getByRole('button', { name: 'Accept result', exact: true }).click(); await waitText(c, 'Acceptance blocked'); assert.equal(home.findJob(missing.id).status, 'review');
    });
    await check('human acceptance persists without inventing artifact verification', async () => {
      const c = await open(report.id); await c.getByRole('button', { name: 'Accept result', exact: true }).click(); await waitText(card(report.id), 'Accepted by you'); assert.equal(home.findJob(report.id).verification.status, 'unverified');
    });
    await check('human rejection is a distinct persisted state', async () => { const c = await open(rejected.id); await c.getByRole('button', { name: 'Reject result', exact: true }).click(); assert.equal(home.findJob(rejected.id).status, 'rejected'); });
    await check('interrupted job retry preserves linkage and does not dispatch twice', async () => {
      const c = await open(interrupted.id); page.once('dialog', dialog => dialog.accept());
      await c.getByRole('button', { name: 'Retry job', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(() => document.querySelectorAll('[data-job-id]').length >= 6);
      const children = home.listJobs('alex', 100).filter(j => j.retryOf === interrupted.id); assert.equal(children.length, 1); assert.equal(children[0].status, 'review'); assert.deepEqual(children[0].expectedOutputs, ['proof.txt']);
    });
    await check('new job UI dispatches a real worker fixture and checks the requested file', async () => {
      await page.getByLabel('New job task').fill('Produce proof.txt'); await page.getByLabel('Expected output files').fill('proof.txt');
      await page.getByRole('button', { name: 'Queue job', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('#office summary')].some(e => e.textContent.includes('Produce proof.txt')));
      const job = home.listJobs('alex', 100).find(j => j.task === 'Produce proof.txt'); assert.equal(job.status, 'review'); assert.equal(job.verification.status, 'files_checked');
      const c = await open(job.id); await c.getByRole('button', { name: 'Accept result', exact: true }).click(); assert.equal(home.findJob(job.id).completionKind, 'human_accepted_files');
    });
    await check('invalid requested output is rejected before creating a job', async () => {
      const before = home.listJobs('alex', 100).length; await page.getByLabel('New job task').fill('Unsafe path'); await page.getByLabel('Expected output files').fill('../outside');
      await page.getByRole('button', { name: 'Queue job', exact: true }).click(); await page.getByText('An expected output must be a workspace-relative file path.', { exact: true }).waitFor(); assert.equal(home.listJobs('alex', 100).length, before);
    });
    await check('background refresh preserves a typed job draft', async () => {
      await page.getByLabel('New job task').fill('Pending draft'); await page.getByLabel('Expected output files').fill('draft.txt');
      await page.evaluate(() => window.__orbitPush({ type: 'agent:state', payload: { id: 'alex', state: 'idle' } }));
      await page.waitForFunction(() => document.querySelector('[aria-label="New job task"]')?.value === 'Pending draft');
      assert.equal(await page.getByLabel('Expected output files').inputValue(), 'draft.txt');
    });
    await check('untrusted report markup is displayed as text', async () => {
      await page.getByLabel('New job task').fill('Untrusted report'); await page.getByLabel('Expected output files').fill(''); await page.getByRole('button', { name: 'Queue job', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('#office summary')].some(e => e.textContent.includes('Untrusted report')));
      const job = home.listJobs('alex', 100).find(j => j.task === 'Untrusted report'), c = await open(job.id);
      assert.match(await c.textContent(), /<img src=x/); assert.equal(await c.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.__injected), undefined);
    });
    await check('Office stop control cancels a running worker fixture', async () => {
      await page.getByLabel('New job task').fill('Wait for cancellation'); await page.getByLabel('Expected output files').fill(''); await page.getByRole('button', { name: 'Queue job', exact: true }).click();
      await page.getByRole('button', { name: 'Stop this job', exact: true }).waitFor(); await page.getByRole('button', { name: 'Stop this job', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('#office .of-job-state')].some(e => e.textContent === 'cancelled'));
      assert.equal(home.listJobs('alex', 100).find(j => j.task === 'Wait for cancellation').status, 'cancelled');
    });
    await page.screenshot({ path: path.join(out, 'office-job-review.png'), fullPage: true });
    await check('accepted state survives a renderer reload', async () => { await page.reload(); await page.waitForFunction(() => document.body.classList.contains('revealed')); assert.equal(new Home(home.root).findJob(report.id).status, 'done'); });
    await check('no renderer exceptions or console errors', async () => { assert.deepEqual(errors, []); });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', checks, engineCalls: engineCalls.length, coverage: 'Chromium renderer + real preload API and job/panel backend; Electron APIs and provider engines are fixtures; no live services.', errors }, null, 2));
  } catch (error) {
    for (const page of pages) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(out, 'failure-jobs.json'), JSON.stringify(home.listJobs('alex', 100), null, 2));
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'failed', checks, errors, failure: error.stack }, null, 2)); throw error;
  } finally {
    workers.cancelAll();
    if (context) { await context.tracing.stop({ path: path.join(out, 'trace.zip') }).catch(() => {}); await context.close(); }
    if (browser) await browser.close();
    if (panel?.ws) panel.ws.stop?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
