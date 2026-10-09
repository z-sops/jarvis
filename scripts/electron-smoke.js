'use strict';
// Actual Electron main/window/preload/IPC. Only the developer screenshot driver is disabled.
// Uses temporary settings, no provider credentials, no model/worker calls, no user files.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { Home } = require('../lib/home'), review = require('../lib/job-review');
function playwright() { try { return require('playwright'); } catch { if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) return require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')); throw new Error('Install Playwright separately to run this optional check.'); } }
async function main() {
  const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-electron-smoke-'));
  const out = path.resolve(process.env.ORBIT_ELECTRON_RESULTS || path.join(root, 'test-results', 'electron')); fs.mkdirSync(out, { recursive: true });
  const home = new Home(path.join(temp, 'home')).ensure(); home.createAgent({ name: 'Alex' });
  const make = (task, status, expectedOutputs = []) => { const j = home.createJob('alex', task, { expectedOutputs }); return home.updateJob('alex', j.id, { status, runId: 'fixture-prior-run', result: 'Fixture report for review' }); };
  const interrupted = make('Previously running job', 'running'), accepted = make('Review a real file', 'review', ['proof.txt']);
  const missing = make('Missing artifact', 'review', ['missing.txt']), report = make('Report only', 'review'), rejected = make('Reject this report', 'review');
  fs.writeFileSync(home.p('workspace', 'alex', 'proof.txt'), 'Fixture artifact');
  for (const j of [accepted, missing, report, rejected]) home.updateJob('alex', j.id, { verification: review.evidence(home, 'alex', j) });
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ commissioned: true, aiName: 'Laila', userName: 'Fixture', homeDir: home.root, launchOnStart: false, sfx: false, autoWake: false, apiKey: '', workerApiKey: '', engine: 'builtin' }));
  const boot = path.join(temp, 'boot.cjs');
  fs.writeFileSync(boot, `require.cache[require.resolve(${JSON.stringify(path.join(root, 'scripts/shots.js'))})]={exports:()=>{}};require(${JSON.stringify(path.join(root, 'main.js'))});`);
  const checks = [], errors = []; let app;
  const check = async (name, fn) => { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
  try {
    app = await playwright()._electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--ozone-platform=headless', '--headless', '--disable-gpu', boot], env: { ...process.env, BRIDGE_SHOTS: out, BRIDGE_USER_DATA: temp }, timeout: 30000 });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.context().route('**/*', route => /^(file:|data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
    await check('actual Electron boot and isolated preload bridge', async () => {
      await page.waitForFunction(() => document.body.classList.contains('revealed')); assert.equal(await page.title(), 'Orbit');
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined'); assert.equal(await page.evaluate(() => typeof bridge.jobs.review), 'function');
    });
    await check('all seven screens in the real Electron window', async () => {
      for (const [label, id] of [['Office', 'office'], ['Workspace', 'workspace'], ['Browser', 'browser'], ['Connectors', 'connectors'], ['Memory', 'memory'], ['Library', 'library'], ['Orbit', 'bridge']]) {
        await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: label, exact: true }).click(); await page.waitForFunction(id => document.body.dataset.view === id, id);
      }
    });
    await check('startup recovery persisted without a provider call', async () => { assert.equal(home.findJob(interrupted.id).status, 'interrupted'); });
    await check('missing output cannot be accepted through real IPC', async () => {
      const result = await page.evaluate(id => bridge.jobs.review(id, 'accept'), missing.id); assert.equal(result.ok, false); assert.match(result.error, /missing/); assert.equal(home.findJob(missing.id).status, 'review');
    });
    await check('file acceptance and report-only acceptance retain distinct evidence', async () => {
      for (const j of [accepted, report]) assert.equal((await page.evaluate(id => bridge.jobs.review(id, 'accept'), j.id)).ok, true);
      assert.equal(home.findJob(accepted.id).completionKind, 'human_accepted_files'); assert.equal(home.findJob(report.id).verification.status, 'unverified');
    });
    await check('human rejection and invalid dispatch use real main-process handlers', async () => {
      assert.equal((await page.evaluate(id => bridge.jobs.review(id, 'reject'), rejected.id)).ok, true);
      assert.equal(home.findJob(rejected.id).status, 'rejected');
      const count = home.listJobs('alex', 99).length;
      assert.equal((await page.evaluate(() => bridge.jobs.dispatch('alex', 'Unsafe', ['../outside']))).ok, false); assert.equal(home.listJobs('alex', 99).length, count);
    });
    await check('request cap setting saves through actual UI and rejects invalid real IPC input', async () => {
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerMaxRequests: 0 })), /integer/);
      await page.evaluate(() => window.__ui.openSettings());
      const input = page.getByRole('spinbutton'); await input.fill('2');
      await page.screenshot({ path: path.join(out, 'request-cap-settings.png'), fullPage: true });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.settings'));
      assert.equal((await page.evaluate(() => bridge.config.get())).workerMaxRequests, 2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'settings.json'), 'utf8')).workerMaxRequests, 2);
    });
    await check('accepted state survives a real renderer reload without exceptions', async () => {
      await page.reload(); await page.waitForFunction(() => document.body.classList.contains('revealed'));
      assert.equal(home.findJob(accepted.id).acceptedBy, 'human'); assert.deepEqual(errors, []);
    });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', checks, electron: require('electron/package.json').version, errors, coverage: 'Real Linux Electron main/window/preload/IPC and SDK startup; developer screenshot driver disabled; no engines/live providers/Windows test.' }, null, 2));
  } catch (e) { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'failed', checks, errors, error: e.message }, null, 2)); throw e; }
  finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
