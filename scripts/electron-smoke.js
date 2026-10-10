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
  home.updateJob('alex',interrupted.id,{containment:{status:'stopped'},nativeCheckpoint:{at:'2026-10-10T00:00:00.000Z'}});
  fs.writeFileSync(home.p('workspace', 'alex', 'proof.txt'), 'Fixture artifact');
  for (const j of [accepted, missing, report, rejected]) home.updateJob('alex', j.id, { verification: review.evidence(home, 'alex', j) });
  const projectRoot = path.join(temp, 'project'); fs.mkdirSync(projectRoot);
  const git = args => require('child_process').execFileSync('git', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); fs.writeFileSync(path.join(projectRoot, 'code.txt'), 'Fixture code');
  fs.writeFileSync(path.join(projectRoot, 'check.test.cjs'), "const {test}=require('node:test');test('fixture',()=>{});\n"); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']);
  const projectJob = make('Project fingerprint fixture', 'review', ['code.txt']);
  const isolated = await require('../lib/job-contract').prepareWorkspace(home, 'alex', { ...projectJob, projectRoot });
  const projectReady = home.updateJob('alex', projectJob.id, isolated);
  home.updateJob('alex', projectJob.id, { verification: review.evidence(home, 'alex', projectReady) });
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
    await check('saved native checkpoint and cleanup state are visible through real Office IPC',async()=>{
      await page.locator('nav[aria-label="Screens"]').getByRole('button',{name:'Office',exact:true}).click();await page.evaluate(()=>window.__office.select('alex'));
      const card=page.locator('[data-job-id="'+interrupted.id+'"]');await card.locator('summary').click();await card.getByText(/Native container: stopped/).waitFor();await card.getByText(/Saved file checkpoint:/).waitFor();
    });
    await check('missing output cannot be accepted through real IPC', async () => {
      const result = await page.evaluate(id => bridge.jobs.review(id, 'accept'), missing.id); assert.equal(result.ok, false); assert.match(result.error, /missing/); assert.equal(home.findJob(missing.id).status, 'review');
    });
    await check('file acceptance and report-only acceptance retain distinct evidence', async () => {
      for (const j of [accepted, report]) assert.equal((await page.evaluate(id => bridge.jobs.review(id, 'accept'), j.id)).ok, true);
      assert.equal(home.findJob(accepted.id).completionKind, 'human_accepted_files'); assert.equal(home.findJob(report.id).verification.status, 'unverified');
    });
    await check('project fingerprint is visible and blocks unlisted changes through real IPC', async () => {
      await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: 'Office', exact: true }).click();
      await page.evaluate(() => window.__office.select('alex'));
      const card = page.locator('[data-job-id="' + projectJob.id + '"]'); await card.locator('summary').click();
      await card.getByText(/Project content fingerprint:/).waitFor();
      await page.screenshot({ path: path.join(out, 'project-fingerprint.png'), fullPage: true });
      fs.writeFileSync(path.join(isolated.workspaceDir, 'unlisted.txt'), 'Changed after report');
      const result = await page.evaluate(id => bridge.jobs.review(id, 'accept'), projectJob.id);
      assert.equal(result.ok, false); assert.match(result.error, /project revision changed/); assert.equal(home.findJob(projectJob.id).status, 'review');
    });
    await check('QA host tests require real UI permission and bind passing evidence to candidate contents', async () => {
      assert.equal((await page.evaluate(id => bridge.jobs.configureQA(id, ['check.test.cjs']), projectJob.id)).ok, true);
      await page.evaluate(id => { window.__qaRun = bridge.jobs.runQATests(id); }, projectJob.id);
      await page.getByRole('alertdialog').waitFor();
      await page.screenshot({ path: path.join(out, 'qa-test-approval.png'), fullPage: true });
      await page.getByRole('button', { name: 'Deny', exact: true }).click();
      assert.equal((await page.evaluate(() => window.__qaRun)).job.qa.test.status, 'denied');
      await page.evaluate(id => { window.__qaRun = bridge.jobs.runQATests(id); }, projectJob.id);
      await page.getByRole('alertdialog').waitFor();
      assert.ok((await page.evaluate(() => bridge.stop.busy())).crew > 0);
      await page.getByRole('button', { name: 'Allow once', exact: true }).click();
      const result = await page.evaluate(() => window.__qaRun); assert.equal(result.ok, true); assert.equal(result.job.qa.test.status, 'passed'); assert.equal(result.job.qa.test.tests, 1);
      const blocked = await page.evaluate(id => bridge.jobs.review(id, 'accept'), projectJob.id); assert.equal(blocked.ok, false); assert.match(blocked.error, /independently executed/);
      const card = page.locator('[data-job-id="' + projectJob.id + '"]');
      if (!(await card.evaluate(el => el.open))) await card.locator('summary').click();
      await card.getByText(/Host tests: passed/).waitFor();
      await page.screenshot({ path: path.join(out, 'qa-evidence.png'), fullPage: true });
    });
    await check('human rejection and invalid dispatch use real main-process handlers', async () => {
      assert.equal((await page.evaluate(id => bridge.jobs.review(id, 'reject'), rejected.id)).ok, true);
      assert.equal(home.findJob(rejected.id).status, 'rejected');
      const count = home.listJobs('alex', 99).length;
      assert.equal((await page.evaluate(() => bridge.jobs.dispatch('alex', 'Unsafe', ['../outside']))).ok, false); assert.equal(home.listJobs('alex', 99).length, count);
    });
    await check('request, model and token budget settings save through real UI and reject invalid IPC input', async () => {
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerMaxRequests: 0 })), /integer/);
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerTimeoutSeconds: 0 })), /integer/);
      await assert.rejects(page.evaluate(() => bridge.config.save({ nativeContainerImage: 'latest' })), /immutable/);
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerTokenBudget: -1 })), /budget|tokens/i);
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerModelRates: { fixture: { input: -1, output: 1 } } })), /price|rate/i);
      await page.evaluate(() => window.__ui.openSettings());
      const continuity = page.getByRole('checkbox', { name: /Preserve native model history/ });
      await continuity.check();
      await page.getByRole('textbox', { name: 'Native runtime image ID' }).fill('sha256:' + 'a'.repeat(64));
      const input = page.getByRole('spinbutton', { name: 'Worker model requests per job' }); await input.fill('2');
      await page.getByRole('spinbutton', { name: 'Worker deadline (seconds)' }).fill('30');
      await page.getByRole('spinbutton', { name: 'Worker token budget per job' }).fill('12000');
      await page.getByRole('spinbutton', { name: 'Worker token cost budget (USD)' }).fill('1');
      await page.getByRole('spinbutton', { name: 'Reserved output tokens per request' }).fill('512');
      await page.getByRole('textbox', { name: 'Model token prices (USD per million)' }).fill('{"fixture":{"input":1,"output":2}}');
      await page.screenshot({ path: path.join(out, 'request-cap-settings.png'), fullPage: true });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.settings') || !!document.querySelector('.settings .ob-err')?.textContent);
      if (await page.locator('.settings').count()) throw new Error('Settings save: ' + await page.locator('.settings .ob-err').innerText());
      assert.equal((await page.evaluate(() => bridge.config.get())).workerMaxRequests, 2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'settings.json'), 'utf8')).workerMaxRequests, 2);
      const saved = await page.evaluate(() => bridge.config.get());
      assert.equal(saved.nativeContinuity, true);
      assert.equal(saved.nativeContainerImage, 'sha256:' + 'a'.repeat(64));
      assert.equal(saved.workerTimeoutSeconds, 30); assert.equal(saved.workerTokenBudget, 12000); assert.equal(saved.workerCostBudgetUsd, 1); assert.equal(saved.workerMaxOutputTokens, 512); assert.deepEqual(saved.workerModelRates, {fixture:{input:1,output:2}});
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
