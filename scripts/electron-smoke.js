'use strict';
// Actual Electron main/window/preload/IPC. Only the developer screenshot driver is disabled.
// Uses temporary settings, no provider credentials, no model/worker calls, no user files.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { Home } = require('../lib/home'), review = require('../lib/job-review');
function playwright() { try { return require('playwright'); } catch { if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) return require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')); throw new Error('Install Playwright separately to run this optional check.'); } }
async function main() {
  const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-electron-smoke-'));
  const out = path.resolve(process.env.ORBIT_ELECTRON_RESULTS || path.join(root, 'test-results', 'electron')); fs.mkdirSync(out, { recursive: true });
  const home = new Home(path.join(temp, 'home')).ensure(); for (const name of ['Alex', 'Bob', 'Charlie', 'Dave', 'Eve']) home.createAgent({ name });
  const fixtureToken = 'nops_disposable_electron_broker', fixtureCalls = [];
  const fixtureServer = require('node:http').createServer((req,res)=>{
    if(req.method!=='POST'){res.writeHead(405);return res.end();}
    if(req.headers.authorization!=='Bearer '+fixtureToken){res.writeHead(401);return res.end();}
    let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{
      const m=JSON.parse(raw);if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}
      let result;
      if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'disposable-fixture',version:'1'}};
      else if(m.method==='tools/list')result={tools:[{name:'neuralops_whoami',inputSchema:{type:'object'}}]};
      else if(m.method==='tools/call'){
        const actor=req.headers['x-agent-id']||null;fixtureCalls.push(actor);
        const agent={id:actor||'agent.orbit-broker',workspaceId:'fixture',revokedAt:null,...(actor?{delegate:'agent.orbit-broker'}:{access:'broker'})};
        result={content:[{type:'text',text:JSON.stringify({agent})}]};
      }else{res.writeHead(400);return res.end();}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
    });
  });
  await new Promise(r=>fixtureServer.listen(0,'127.0.0.1',r));
  // Synthetic connector with no secret: exercise identity UI and real trusted IPC,
  // including refusal. This cannot imply live NeuralOps registration acceptance.
  fs.mkdirSync(home.p('connectors'), { recursive: true });
  fs.writeFileSync(home.p('connectors', 'connectors.json'), JSON.stringify({ servers: [{ id: 'neuralops', catalogId: 'neuralops', name: 'NeuralOps', url: 'http://127.0.0.1:'+fixtureServer.address().port+'/mcp', enabled: true, agents: 'all', mode: 'read-only', tools: ['neuralops_whoami'], levels: { neuralops_whoami: 'free' }, neuralopsIdentities: {} }] }));
  const make = (task, status, expectedOutputs = []) => { const j = home.createJob('alex', task, { expectedOutputs }); return home.updateJob('alex', j.id, { status, runId: 'fixture-prior-run', result: 'Fixture report for review' }); };
  const interrupted = make('Previously running job', 'running'), accepted = make('Review a real file', 'review', ['proof.txt']);
  const missing = make('Missing artifact', 'review', ['missing.txt']), report = make('Report only', 'review'), rejected = make('Reject this report', 'review');
  home.updateJob('alex',interrupted.id,{containment:{status:'stopped'},nativeContinuity:{provider:'openai',model:'fixture',requests:0},nativeCheckpoint:{at:'2026-10-10T00:00:00.000Z',engineState:{engine:'opencode',sessionPresent:true,pendingEffects:0,retiredQueueRows:1}}});
  fs.writeFileSync(home.p('workspace', 'alex', 'proof.txt'), 'Fixture artifact');
  for (const j of [accepted, missing, report, rejected]) home.updateJob('alex', j.id, { verification: review.evidence(home, 'alex', j) });
  const projectRoot = path.join(temp, 'project'); fs.mkdirSync(projectRoot);
  const git = args => require('child_process').execFileSync('git', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); fs.writeFileSync(path.join(projectRoot, 'code.txt'), 'Fixture code');
  fs.writeFileSync(path.join(projectRoot, 'check.test.cjs'), "const {test}=require('node:test');test('fixture',()=>{});\n"); fs.writeFileSync(path.join(projectRoot, 'check_test.py'), 'import unittest\nclass Fixture(unittest.TestCase):\n def test_declared(self): self.assertEqual(2+2,4)\n'); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']);
  const projectJob = make('Project fingerprint fixture', 'review', ['code.txt']);
  const isolated = await require('../lib/job-contract').prepareWorkspace(home, 'alex', { ...projectJob, projectRoot });
  const projectReady = home.updateJob('alex', projectJob.id, isolated);
  home.updateJob('alex', projectJob.id, { verification: review.evidence(home, 'alex', projectReady) });
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ commissioned: true, aiName: 'Laila', userName: 'Fixture', homeDir: home.root, launchOnStart: false, sfx: false, autoWake: false, apiKey: '', workerApiKey: '', engine: 'builtin' }));
  const boot = path.join(temp, 'boot.cjs');
  fs.writeFileSync(boot, `require('electron').app.disableHardwareAcceleration();require.cache[require.resolve(${JSON.stringify(path.join(root, 'scripts/shots.js'))})]={exports:()=>{}};require(${JSON.stringify(path.join(root, 'main.js'))});`);
  const checks = [], errors = []; let app;
  const check = async (name, fn) => { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
  try {
    app = await playwright()._electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', boot], env: { ...process.env, BRIDGE_SHOTS: out, BRIDGE_USER_DATA: temp }, timeout: 30000 });
    app.process().on('exit',(code,signal)=>console.log('ELECTRON_EXIT',code,signal));
    app.process().stdout.on('data',d=>fs.appendFileSync(path.join(out,'main-stdout.log'),d));app.process().stderr.on('data',d=>fs.appendFileSync(path.join(out,'main-stderr.log'),d));
    const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    await page.context().route('**/*', route => /^(file:|data:|blob:|http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/)/.test(route.request().url()) ? route.continue() : route.abort());
    await check('actual Electron boot and isolated preload bridge', async () => {
      await page.waitForFunction(() => document.body.classList.contains('revealed')); assert.equal(await page.title(), 'Orbit');
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined'); assert.equal(await page.evaluate(() => typeof bridge.jobs.review), 'function');await page.getByRole('heading',{name:'Recorded usage',exact:true}).waitFor();
    });
    await check('static preview uses real localhost approval and native module rendering',async()=>{
      const folder=home.p('workspace','bob','preview-fixture');fs.mkdirSync(folder,{recursive:true});
      fs.writeFileSync(path.join(folder,'index.html'),'<title>Orbit preview fixture</title><body>Waiting<script type="module" src="main.js"></script></body>');
      fs.writeFileSync(path.join(folder,'main.js'),'document.body.append(" MODULE_READY");document.body.style.cssText="margin:0;min-height:100vh;background:rgb(35,107,71);color:white;font-size:36px";');
      await page.evaluate(folder=>{window.__preview=bridge.live.tool('preview_project',{path:folder});},folder);
      await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Deny',exact:true}).click();
      const denied=await page.evaluate(()=>window.__preview);assert.equal(denied.ok,false);
      await page.evaluate(folder=>{window.__preview=bridge.live.tool('preview_project',{path:folder});},folder);
      await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Allow once',exact:true}).click();
      const loaded=await page.evaluate(()=>window.__preview);assert.equal(loaded.ok,true,JSON.stringify(loaded));assert.equal(loaded.pageLoaded,true);assert.match(loaded.url,/^http:\/\/127\.0\.0\.1:/);
      const read=await page.evaluate(()=>bridge.live.tool('browser_read',{}));assert.equal(read.ok,true);assert.match(read.result,/MODULE_READY/);
      // DOM delivery and the displayed offscreen frame are separate acceptance boundaries.
      await page.waitForFunction(()=>{const c=document.querySelector('.bw-canvas');if(!c)return false;const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return Math.abs(p[0]-35)<15&&Math.abs(p[1]-107)<15&&Math.abs(p[2]-71)<15;});
      await page.screenshot({path:path.join(out,'static-project-preview.png'),fullPage:true});
      await page.evaluate(()=>bridge.stop.all());await assert.rejects(fetch(loaded.url));
      await page.locator('nav[aria-label="Screens"]').getByRole('button',{name:'Orbit',exact:true}).click();
    });
    await check('voice and text share project-planning context; a planning-only draft asks details and cannot dispatch',async()=>{
      const context=await page.evaluate(async()=>{const c=await bridge.live.context();return{planning:c.systemPrompt.includes('Project planning behavior (applies to voice and text)'),names:c.tools.map(t=>t.name)};});assert.equal(context.planning,true);assert.ok(context.names.includes('plan_project'));assert.ok(context.names.includes('list_agents'));
      const team=await page.evaluate(()=>bridge.live.tool('list_agents',{}));assert.equal(team.ok,true);assert.equal(team.agents.length,5);assert.equal(team.agents[0].planningEvidence.expertiseVerified,false);
      const jobsBefore=home.listAgents().map(a=>[a.id,home.listJobs(a.id,Infinity).length]);
      const draft=await page.evaluate(()=>bridge.live.tool('plan_project',{goal:'Four-page mobile-friendly software-company website',business:{successCriteria:['Home, Services, About and Contact readable on mobile'],unknowns:['What company name and branding should be used?','Should Contact actually send a message?']},steps:[{id:'site',agent:'bob',role:'General assistant',task:'Build only after requirements are confirmed',expected_outputs:['index.html']}]}));assert.equal(draft.ok,true);assert.equal(draft.nextPlanningAction.kind,'clarify_requirements');assert.equal(draft.executionReadiness.status,'blocked');
      const denied=await page.evaluate(id=>bridge.live.tool('dispatch_project_step',{project_id:id,step_id:'site'}),draft.id);assert.equal(denied.ok,false);assert.match(denied.error,/blocked/);
      assert.deepEqual(home.listAgents().map(a=>[a.id,home.listJobs(a.id,Infinity).length]),jobsBefore);assert.equal(fs.existsSync(home.p('workspace','bob','index.html')),false);
      const saved=await page.evaluate(id=>bridge.live.tool('get_project_plan',{project_id:id}),draft.id);assert.equal(saved.ok,true);assert.equal(saved.business.unknowns.length,2);assert.equal(saved.steps[0].jobId,undefined);
      const revised=await page.evaluate(p=>bridge.live.tool('refine_project_brief',{project_id:p.id,revision:p.briefRevision,goal:'Confirmed static fixture site, no backend',business:{successCriteria:['Mobile-readable site and independent review'],unknowns:[]},deliverable_type:'files',steps:[{id:'build-site',agent:'alex',role:'General assistant',task:'Build the confirmed fixture site',expected_outputs:['index.html']},{id:'qa',agent:'bob',role:'General assistant',task:'Inspect the candidate independently',dependencies:['build-site'],expected_outputs:['review.json']}]}),saved);assert.equal(revised.ok,true);assert.equal(revised.id,draft.id);assert.equal(revised.executionReadiness.status,'ready_for_proposed_execution');assert.equal(revised.steps[1].handoff.kind,'existing_accepted_artifact_handoff');assert.equal(revised.steps[1].status,'waiting_dependencies');assert.deepEqual(revised.steps[1].dependencies,['build-site']);assert.deepEqual(home.listAgents().map(a=>[a.id,home.listJobs(a.id,Infinity).length]),jobsBefore);

    });
    await check('declared Git root stays blocked until fresh UI-approved read-only verification',async()=>{
      const before=home.listAgents().map(a=>[a.id,home.listJobs(a.id,Infinity).length]);
      const p=await page.evaluate(root=>bridge.live.tool('plan_project',{goal:'Fixture scoped website review',business:{successCriteria:['Inspect fixture source independently'],unknowns:[]},deliverable_type:'files',steps:[{id:'build',agent:'alex',role:'General assistant',task:'Implement fixture',project_root:root,expected_outputs:['index.html']},{id:'qa',agent:'bob',role:'General assistant',task:'Independent source review',review_of:'build',expected_outputs:['review.json']}]}),projectRoot);assert.equal(p.ok,true);assert.equal(p.executionReadiness.status,'blocked');
      const args={project_id:p.id,step_id:'build',revision:p.briefRevision};
      await page.evaluate(args=>{window.__rootCheck=bridge.live.tool('verify_project_root',args);},args);
      await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Deny',exact:true}).click();assert.equal((await page.evaluate(()=>window.__rootCheck)).ok,false);assert.equal(JSON.parse(fs.readFileSync(home.p('projects',p.id+'.json'))).rootObservations,undefined);
      await page.evaluate(args=>{window.__rootCheck=bridge.live.tool('verify_project_root',args);},args);
      await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Allow once',exact:true}).click();const checked=await page.evaluate(()=>window.__rootCheck);assert.equal(checked.ok,true,JSON.stringify(checked));assert.equal(checked.executionReadiness.status,'ready_for_proposed_execution');assert.equal(checked.steps[0].rootVerification.status,'recent_clean_git_observation_requires_execution_recheck');assert.deepEqual(home.listAgents().map(a=>[a.id,home.listJobs(a.id,Infinity).length]),before);
    });
    await check('latency IPC observes offline reply and validates renderer metrics without provider calls',async()=>{
      const r=await page.evaluate(()=>bridge.chat.send('/laila Offline fixture'));assert.ok(r.latencyTraceId);
      assert.equal(await page.evaluate(id=>bridge.latency.rendered(id,{feedbackMs:1,replyDomMs:2}),r.latencyTraceId),true);
      assert.equal(await page.evaluate(id=>bridge.latency.rendered(id,{feedbackMs:1,replyDomMs:2}),r.latencyTraceId),false);
      const stats=await page.evaluate(()=>bridge.latency.get());const group=stats.groups['commander/builtin/success/no_provider_span'];assert.ok(group.metrics.elapsedMs.samples>=1);assert.equal(group.metrics.renderer_replyDomMs.p95,2);assert.equal(group.metrics.model_requestUnionMs,undefined);
    });
    await check('all seven screens in the real Electron window', async () => {
      for (const [label, id] of [['Office', 'office'], ['Workspace', 'workspace'], ['Browser', 'browser'], ['Connectors', 'connectors'], ['Memory', 'memory'], ['Library', 'library'], ['Orbit', 'bridge']]) {
        await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: label, exact: true }).click(); await page.waitForFunction(id => document.body.dataset.view === id, id);
      }
    });
    await check('NeuralOps identity inputs are visible and save before trusted read-only verification', async () => {
      await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: 'Connectors', exact: true }).click();
      const card = page.locator('.cn-card').filter({ has: page.locator('input[aria-label="NeuralOps identity for Alex"]') });
      await card.getByRole('button', { name: 'Who can use it', exact: true }).click();
      const input = page.getByRole('textbox', { name: 'NeuralOps identity for Alex', exact: true });
      await input.click(); await input.pressSequentially('agent.alex'); assert.equal(await input.inputValue(), 'agent.alex');
      const colors = await input.evaluate(e => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
      assert.notEqual(colors.fg, colors.bg); assert.notEqual(colors.bg, 'rgb(255, 255, 255)');
      await card.getByRole('button', { name: 'Verify worker identities', exact: true }).click();
      await card.getByRole('status').filter({ hasText: 'Unsaved names are not checked' }).waitFor();
      await card.getByRole('button', { name: 'Save worker identities', exact: true }).click();
      await card.getByRole('status').filter({ hasText: 'Mappings saved' }).waitFor();
      assert.equal((await page.evaluate(() => bridge.connectors.list())).connectors.find(c => c.id === 'neuralops').neuralopsIdentities.alex, 'agent.alex');
      await card.getByRole('button', { name: 'Verify worker identities', exact: true }).click();
      await card.getByRole('status').filter({ hasText: 'token refused or expired' }).waitFor();
      await page.screenshot({ path: path.join(out, 'neuralops-identity-verification.png') });
      await card.getByRole('button',{name:'Change token',exact:true}).click();
      await page.locator('.cn-form input[type="password"]').fill(fixtureToken);
      await page.getByRole('button',{name:'Save and test',exact:true}).click();
      // This Linux harness has no secure OS key store. Exercise actual refusal,
      // never replace safeStorage with a plaintext/insecure success fallback.
      await page.locator('.cn-form').getByText(/Protected credential storage is unavailable or locked/).waitFor();
      assert.equal(await page.locator('.cn-form input[type="password"]').inputValue(),'');
      assert.equal((await page.evaluate(()=>bridge.connectors.list())).connectors.find(c=>c.id==='neuralops').hasToken,false);
      assert.deepEqual(fixtureCalls,[]);
      assert.ok(!await page.locator('body').innerText().then(t=>t.includes(fixtureToken)));
      await page.screenshot({path:path.join(out,'neuralops-token-save-refusal.png')});
      await page.locator('.cn-form').getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('nav[aria-label="Screens"]').getByRole('button', { name: 'Orbit', exact: true }).click();
    });
    await check('startup recovery persisted without a provider call', async () => { assert.equal(home.findJob(interrupted.id).status, 'interrupted'); });
    await check('crew health and durable pause/ready use real trusted preload without automatic replay',async()=>{
      const health=await page.evaluate(()=>bridge.crewHealth.get());assert.equal(health.ok,true);assert.equal(health.job.workers.length,5);
      await page.locator('nav[aria-label="Screens"]').getByRole('button',{name:'Office',exact:true}).click();await page.evaluate(()=>window.__office.select('bob'));
      await page.getByRole('button',{name:'Pause worker and cancel queued work',exact:true}).click();await page.getByRole('button',{name:'Make worker ready (no auto-resume)',exact:true}).waitFor();assert.equal(home.getAgent('bob').desiredLifecycle,'paused');
      assert.equal((await page.evaluate(()=>bridge.jobs.dispatch('bob','Should not start',[]))).ok,false);
      await page.getByRole('button',{name:'Make worker ready (no auto-resume)',exact:true}).click();await page.getByRole('button',{name:'Pause worker and cancel queued work',exact:true}).waitFor();assert.equal(home.getAgent('bob').desiredLifecycle,'ready');assert.equal(home.listJobs('bob',Infinity).length,0);
      await page.evaluate(()=>window.__office.select(null));await page.getByRole('button',{name:'Inspect crew health',exact:true}).click();await page.getByLabel('Crew health overview',{exact:true}).getByText(/Bob: desired ready/).waitFor();
    });
    await check('communication drawer previews, cancels and explicitly releases acknowledged old receipts',async()=>{
      const tags=require('../lib/tags'),a=home.createJob('alex','Communication fixture'),b=home.createJob('bob','Communication fixture');for(const j of [a,b])home.updateJob(j.agent,j.id,{status:'running',runId:'communication-'+j.agent,projectBinding:{projectId:'fixture'}});
      const m=tags.sendMessage(home,null,{}, {actor:'alex',jobId:a.id,runId:'communication-alex'},{to:'bob',target_job:b.id,kind:'finding',text:'Fixture evidence: <script>never execute</script>',idempotency_key:'ui-receipt'}).message;tags.acknowledge(home,'bob',{actor:'bob',jobId:b.id,runId:'communication-bob'},m.id);for(const j of [a,b])home.updateJob(j.agent,j.id,{status:'done',acceptedBy:'human'});const list=tags.readAll(home,'bob');list.find(x=>x.id===m.id).ack.at='2020-01-01T00:00:00.000Z';tags.writeAll(home,'bob',list);
      await page.evaluate(()=>window.__office.select('bob'));await page.getByText('Fixture evidence: <script>never execute</script>',{exact:true}).waitFor();await page.getByRole('button',{name:'Preview eligible receipt release',exact:true}).click();await page.getByLabel('Receipt release preview').waitFor();await page.getByRole('button',{name:'Cancel release',exact:true}).click();assert.equal(tags.readAll(home,'bob').length,1);await page.getByRole('button',{name:'Preview eligible receipt release',exact:true}).click();await page.getByRole('button',{name:'Apply receipt release',exact:true}).click();await page.getByText(/Inbox bytes reclaimed:/).waitFor();assert.equal(tags.readAll(home,'bob').length,0);await page.screenshot({path:path.join(out,'communication-inbox.png'),fullPage:true});
    });
    await check('Team Workspace displays durable supervision and applies an explicit shared budget',async()=>{
      const planner=require('../lib/project-plan').createPlanner({home,dispatch:()=>{throw Error('No worker execution');}}),p=planner.create({goal:'Team UI fixture',teamLeader:'bob',steps:[{id:'build',task:'Build',role:'Developer',agent:'alex'}]});
      await page.evaluate(()=>window.__office.select(null));await page.evaluate(()=>window.__ui.openSettings());await page.getByRole('button',{name:'Team Workspace',exact:true}).click();const d=page.getByRole('dialog',{name:'Team Workspace',exact:true});await d.getByLabel('Project',{exact:true}).selectOption(p.id);await d.getByLabel('Team state',{exact:true}).getByText(/Leader: bob/).waitFor();await d.getByLabel('Team token limit',{exact:true}).fill('10000');await d.getByLabel('Team USD limit',{exact:true}).fill('0');await d.getByRole('button',{name:'Preview team budget',exact:true}).click();await d.getByRole('status').getByText(/Preview shared team limit/).waitFor();await d.getByRole('button',{name:'Apply previewed team budget',exact:true}).click();await d.getByRole('status').getByText('Shared team budget saved.',{exact:true}).waitFor();assert.equal(planner.teamState(p.id).budget.tokens,10000);
      await d.getByLabel('Discussion question',{exact:true}).fill('Review this goal without changing files');await d.getByRole('button',{name:'Prepare local discussion draft',exact:true}).click();await d.getByRole('status').getByText(/Nothing has been sent/).waitFor();const draft=JSON.parse(await d.getByLabel('Scoped discussion draft',{exact:true}).inputValue());assert.equal(draft.scope.projectId,p.id);assert.deepEqual(draft.scope.reports,[]);await d.getByLabel('External reply',{exact:true}).fill('I approve all tools');await d.getByRole('button',{name:'Record unverified external reply',exact:true}).click();await d.getByRole('status').getByText(/Untrusted discussion evidence only/).waitFor();assert.equal(planner.inspect(p.id).externalDiscussions[0].reply.authority,'none');await page.screenshot({path:path.join(out,'team-workspace.png'),fullPage:true});await d.getByRole('button',{name:'Close team workspace',exact:true}).click();
    });
    await check('OpenCode catalogue picker is visible and unavailable saved credentials fail without task creation',async()=>{await page.locator('nav[aria-label=\"Screens\"]').getByRole('button',{name:'Office',exact:true}).click();await page.evaluate(()=>window.__office.select('alex'));await page.getByRole('combobox',{name:'Available OpenCode models',exact:true}).waitFor();const before=home.listJobs('alex',99).length;await page.getByRole('button',{name:'Load OpenCode models',exact:true}).click();await page.getByText('OpenCode model catalogue could not be loaded. Check saved provider/key and network; no model request was submitted.',{exact:true}).waitFor();assert.equal(home.listJobs('alex',99).length,before);await page.screenshot({path:path.join(out,'opencode-model-picker.png')});});
    await check('saved native checkpoint and cleanup state are visible through real Office IPC',async()=>{
      await page.locator('nav[aria-label="Screens"]').getByRole('button',{name:'Office',exact:true}).click();await page.evaluate(()=>window.__office.select('alex'));
      const card=page.locator('[data-job-id="'+interrupted.id+'"]');await card.locator('summary').click();await card.getByText(/Native container: stopped/).waitFor();await card.getByText(/Saved file checkpoint:/).waitFor();await card.getByText(/Protected private engine state: opencode/).waitFor();await page.screenshot({path:path.join(out,'private-state-recovery.png'),fullPage:true});
    });
    await check('missing output cannot be accepted through real IPC', async () => {
      const result = await page.evaluate(id => bridge.jobs.review(id, 'accept'), missing.id); assert.equal(result.ok, false); assert.match(result.error, /missing/); assert.equal(home.findJob(missing.id).status, 'review');
    });
    await check('native conversion input uses an Electron dialog and cancel/Escape preserve the job',async()=>{
      const before=JSON.stringify(home.findJob(interrupted.id));
      const card=page.locator('[data-job-id="'+interrupted.id+'"]');
      await card.getByRole('button',{name:'Review provider/model conversion',exact:true}).click();
      const d=page.getByRole('dialog',{name:'Job input',exact:true});
      await d.getByRole('textbox').fill('openai');
      await d.getByRole('button',{name:'Continue',exact:true}).click();
      await d.getByRole('textbox').fill('fixture');
      const inputColors=await d.getByRole('textbox').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
      assert.notEqual(inputColors.fg,inputColors.bg);assert.notEqual(inputColors.bg,'rgb(255, 255, 255)');
      await page.waitForFunction(()=>[...document.querySelectorAll('.modal-back')].every(e=>Number(getComputedStyle(e).opacity)===1));
      await page.screenshot({path:path.join(out,'native-conversion-input.png')});
      await d.getByRole('button',{name:'Cancel',exact:true}).click();
      await d.waitFor({state:'hidden'});assert.equal(JSON.stringify(home.findJob(interrupted.id)),before);
      if(!await card.getByRole('button',{name:'Review provider/model conversion',exact:true}).isVisible())await card.locator('summary').click();
      await card.getByRole('button',{name:'Review provider/model conversion',exact:true}).click();
      await d.getByRole('textbox').press('Escape');
      await d.waitFor({state:'hidden'});assert.equal(JSON.stringify(home.findJob(interrupted.id)),before);
    });
    await check('unknown provider request recovery is visible and protected storage refusal does not change the job',async()=>{
      home.updateJob('alex',interrupted.id,{nativeContinuity:{provider:'opencode',model:'space-bunny-free',requests:1,requestOutcome:'unknown'}});
      await page.evaluate(()=>window.__office.select('alex'));const card=page.locator('[data-job-id=\"'+interrupted.id+'\"]');await card.locator('summary').click();
      const before=JSON.stringify(home.findJob(interrupted.id));await card.getByText(/Provider request outcome: unknown/).waitFor();await card.getByRole('button',{name:'Review unknown provider request',exact:true}).click();
      await card.getByText('Choose a stopped native job with accessible protected history.',{exact:true}).waitFor();assert.equal(JSON.stringify(home.findJob(interrupted.id)),before);
      assert.equal((await page.evaluate(()=>bridge.jobs.applyNativeRequest('foreign-token'))).ok,false);await page.screenshot({path:path.join(out,'unknown-request-recovery.png')});
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
    await check('Python QA runs declared unittest cases through real preload and fresh human approval', async () => {
      const configured = await page.evaluate(id => bridge.jobs.configureQA(id, ['check_test.py']), projectJob.id);
      assert.equal(configured.ok, true); assert.equal(configured.job.qa.runner, 'python_unittest');
      await page.evaluate(id => { window.__qaPython = bridge.jobs.runQATests(id); }, projectJob.id);
      await page.getByRole('alertdialog').waitFor();
      await page.getByText(/Runner: python_unittest/).waitFor();
      await page.getByRole('button', { name: 'Allow once', exact: true }).click();
      const result = await page.evaluate(() => window.__qaPython);
      assert.equal(result.ok, true); assert.equal(result.job.qa.test.status, 'passed');
      assert.equal(result.job.qa.test.tests, 1); assert.equal(result.job.qa.test.source, 'orbit_host_python_unittest');
      const card = page.locator('[data-job-id="' + projectJob.id + '"]');
      if (!(await card.evaluate(el => el.open))) await card.locator('summary').click();
      await card.getByText(/Host tests: passed/).waitFor();
      await page.screenshot({ path: path.join(out, 'python-qa-evidence.png'), fullPage: true });
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
      await assert.rejects(page.evaluate(() => bridge.config.save({ workerRoutes: [{provider:'openrouter',model:'fixture',contextTokens:1024,capabilities:['text','tools']}] })), /supported count adapters/);
      await page.evaluate(() => window.__ui.openSettings());
      const continuity = page.getByRole('checkbox', { name: /Preserve protected native history/ });
      await continuity.check();
      await page.getByRole('textbox', { name: 'Native runtime image ID' }).fill('sha256:' + 'a'.repeat(64));
      const input = page.getByRole('spinbutton', { name: 'Worker model requests per job' }); await input.fill('2');
      await page.getByRole('spinbutton', { name: 'Worker deadline (seconds)' }).fill('30');
      await page.getByRole('spinbutton', { name: 'Worker token budget per job' }).fill('12000');
      await page.getByRole('spinbutton', { name: 'Worker token cost budget (USD)' }).fill('1');
      await page.getByRole('spinbutton', { name: 'Reserved output tokens per request' }).fill('512');
      await page.getByRole('textbox', { name: 'Model token prices (USD per million)' }).fill('{"fixture":{"input":1,"output":2}}');
      await page.getByRole('textbox', { name: 'Native model routes (JSON)' }).fill(JSON.stringify([{provider:'openai',model:'fixture',contextTokens:32000,capabilities:['text','tools']}]));
      await page.screenshot({ path: path.join(out, 'request-cap-settings.png'), fullPage: true });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.settings') || !!document.querySelector('.settings .ob-err')?.textContent);
      if (await page.locator('.settings').count()) throw new Error('Settings save: ' + await page.locator('.settings .ob-err').innerText());
      assert.equal((await page.evaluate(() => bridge.config.get())).workerMaxRequests, 2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'settings.json'), 'utf8')).workerMaxRequests, 2);
      const saved = await page.evaluate(() => bridge.config.get());
      assert.equal(saved.workerRoutes[0].model, 'fixture'); assert.equal(saved.workerRoutes[0].provider, 'openai');
      assert.equal(saved.nativeContinuity, true);
      assert.equal(saved.nativeContainerImage, 'sha256:' + 'a'.repeat(64));
      assert.equal(saved.workerTimeoutSeconds, 30); assert.equal(saved.workerTokenBudget, 12000); assert.equal(saved.workerCostBudgetUsd, 1); assert.equal(saved.workerMaxOutputTokens, 512); assert.deepEqual(saved.workerModelRates, {fixture:{input:1,output:2}});
    });
    await check('gateway execution mode is explicit in Settings and never disables existing budgets', async () => {
      const before = await page.evaluate(() => bridge.config.get());
      assert.equal(before.workerGatewayMode, 'exact');
      await assert.rejects(page.evaluate(() => bridge.config.save({workerGatewayMode:'auto'})), /request-limited/);
      await page.evaluate(() => window.__ui.openSettings());
      const mode = page.getByRole('combobox', {name:'OpenCode gateway execution'});
      await mode.selectOption('requests'); await mode.scrollIntoViewIfNeeded();
      assert.match(await page.locator('.settings').innerText(), /cannot guarantee a token or USD ceiling/);
      await page.screenshot({path:path.join(out,'gateway-mode-settings.png')});
      await page.getByRole('button', {name:'Save',exact:true}).click();
      await page.waitForFunction(() => !document.querySelector('.settings') || !!document.querySelector('.settings .ob-err')?.textContent);
      if(await page.locator('.settings').count()) throw Error('Settings did not save request mode');
      const saved = await page.evaluate(() => bridge.config.get());
      assert.equal(saved.workerGatewayMode,'requests');
      assert.equal(saved.workerTokenBudget,before.workerTokenBudget); assert.equal(saved.workerCostBudgetUsd,before.workerCostBudgetUsd);
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'settings.json'),'utf8')).workerGatewayMode,'requests');
      await page.evaluate(()=>window.__ui.openSettings());
      await page.getByRole('combobox',{name:'OpenCode gateway execution'}).selectOption('exact');
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.settings'));
    });
    await check('ACP transport requires explicit Settings selection and preserves other policy', async () => {
      const before=await page.evaluate(()=>bridge.config.get());
      assert.equal(before.opencodeTransport,'run');
      await assert.rejects(page.evaluate(()=>bridge.config.save({opencodeTransport:'auto'})),/ACP/);
      await page.evaluate(()=>window.__ui.openSettings());
      const mode=page.getByRole('combobox',{name:'OpenCode transport'});
      await mode.selectOption('acp');await mode.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,'acp-transport-settings.png')});
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.settings'));
      const after=await page.evaluate(()=>bridge.config.get());assert.equal(after.opencodeTransport,'acp');
      assert.equal(after.workerGatewayMode,before.workerGatewayMode);assert.equal(after.workerTokenBudget,before.workerTokenBudget);
      assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'settings.json'),'utf8')).opencodeTransport,'acp');
      await page.evaluate(()=>window.__ui.openSettings());
      await page.getByRole('combobox',{name:'OpenCode transport'}).selectOption('run');
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.settings'));
    });
    await check('YAML configuration previews and applies through real Settings, preload and durable Home state', async () => {
      await page.evaluate(() => window.__ui.openSettings());
      await page.getByRole('button', { name: 'Crew configuration (YAML)', exact: true }).click();
      const editor = page.getByRole('textbox', { name: 'Crew YAML', exact: true });
      await page.waitForFunction(() => document.querySelector('[aria-label="Crew YAML"]')?.value.includes('schemaVersion: 1'));
      const exported = await editor.inputValue(); assert.doesNotMatch(exported, /workerApiKey|allowCode|nativeContainerImage/);
      await page.getByLabel('Load crew YAML', { exact: true }).setInputFiles({ name: 'crew.yaml', mimeType: 'application/yaml', buffer: Buffer.from(exported.replace('workerModel: null', 'workerModel: fixture-loaded')) });
      await page.getByRole('status').filter({ hasText: /File loaded for preview/ }).waitFor(); assert.match(await editor.inputValue(), /fixture-loaded/);
      assert.equal(home.getAgent('alex').workerModel, undefined);
      await editor.fill(exported.replace('workerModel: null', 'workerModel: fixture-ui-model'));
      await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
      const apply = page.getByRole('button', { name: 'Apply reviewed changes', exact: true });
      await apply.waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Apply reviewed changes').disabled);
      assert.equal(home.getAgent('alex').workerModel, undefined);
      await page.getByLabel('Configuration diff', { exact: true }).getByText(/fixture-ui-model/).waitFor();
      await page.screenshot({ path: path.join(out, 'crew-yaml-preview.png'), fullPage: true });
      await editor.fill(exported.replace('workerModel: null', 'workerModel: fixture-edited'));
      assert.equal(await apply.isDisabled(), true);
      await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Apply reviewed changes').disabled);
      home.updateAgent('alex', { workerContext: 8192 });
      await apply.click(); await page.getByRole('status').filter({ hasText: /revision changed/ }).waitFor();
      assert.equal(home.getAgent('alex').workerModel, undefined);
      await page.getByRole('button', { name: 'Reload from Orbit', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /Current stored configuration/ }).waitFor();
      const fresh = await editor.inputValue(); await editor.fill(fresh.replace('workerModel: null', 'workerModel: fixture-ui-model'));
      await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Apply reviewed changes').disabled);
      await apply.click(); await page.getByRole('status').filter({ hasText: /Applied and verified 1 field/ }).waitFor();
      assert.equal(home.getAgent('alex').workerModel, 'fixture-ui-model');
      const ledger = JSON.parse(fs.readFileSync(home.p('logs', 'crew-config.json'))); assert.equal(ledger.events.at(-1).status, 'applied');
      await editor.fill('schemaVersion: 1\nworkerApiKey: never-save-this');
      await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /unsupported configuration field/ }).waitFor(); assert.equal(await apply.isDisabled(), true);
      await page.getByRole('dialog', { name: 'Crew configuration', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    });
    await check('closing a reviewed YAML preview cancels without changing durable settings', async () => {
      const before = fs.readFileSync(home.p('agents', 'alex', 'agent.json'));
      await page.evaluate(() => window.__ui.openCrewConfig());
      const editor = page.getByRole('textbox', { name: 'Crew YAML', exact: true });
      await page.waitForFunction(() => document.querySelector('[aria-label="Crew YAML"]')?.value.includes('schemaVersion: 1'));
      await editor.fill((await editor.inputValue()).replace('workerModel: fixture-ui-model', 'workerModel: fixture-cancelled'));
      await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Apply reviewed changes').disabled);
      await page.getByRole('dialog', { name: 'Crew configuration', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
      assert.deepEqual(fs.readFileSync(home.p('agents', 'alex', 'agent.json')), before);
    });
    await check('incomplete YAML import is visible and explicitly acknowledged without replaying worker settings', async () => {
      const ledger = JSON.parse(fs.readFileSync(home.p('logs', 'crew-config.json')));
      ledger.events.push({ ...ledger.events.at(-1), id: 'fixture-interrupted-import', status: 'prepared', at: new Date().toISOString(), appliedWorkers: [] });
      require('../lib/job-storage').atomicWrite(home.p('logs', 'crew-config.json'), ledger);
      await page.evaluate(() => window.__ui.openCrewConfig());
      await page.getByRole('status').filter({ hasText: /Incomplete import/ }).waitFor();
      await page.getByLabel('Incomplete import history', { exact: true }).getByText(/fixture-interrupted-import/).waitFor();
      const summary = page.getByLabel('Import recovery summary', { exact: true });
      assert.equal(await summary.locator('tbody tr').count(), 5);
      await summary.getByText('Requested settings match', { exact: true }).waitFor();
      assert.equal(await summary.getByText('Unchanged', { exact: true }).count(), 4);
      await summary.getByText(/rollback safety has not been established/).waitFor();
      const ack = page.getByRole('button', { name: 'Record inspection', exact: true }); assert.equal(await ack.isDisabled(), true);
      const jobsBefore = home.listJobs('alex', Infinity).length;
      const blocked = await page.evaluate(() => bridge.jobs.dispatch('alex', 'Must not execute during incomplete import', []));
      assert.equal(blocked.ok, false); assert.match(blocked.error, /incomplete crew import/); assert.equal(home.listJobs('alex', Infinity).length, jobsBefore);
      await page.getByRole('checkbox', { name: /I inspected the current configuration/ }).check();
      await page.screenshot({ path: path.join(out, 'crew-yaml-interrupted.png'), fullPage: true });
      await ack.click(); await page.getByRole('status').filter({ hasText: /Inspection recorded/ }).waitFor();
      assert.equal(home.getAgent('alex').workerModel, 'fixture-ui-model');
      assert.equal(JSON.parse(fs.readFileSync(home.p('logs', 'crew-config.json'))).events.at(-1).status, 'acknowledged');
      await page.getByRole('dialog', { name: 'Crew configuration', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    });
    await check('interrupted YAML settings rollback previews a reverse diff and requires explicit trusted Apply', async () => {
      const ledger = JSON.parse(fs.readFileSync(home.p('logs', 'crew-config.json')));
      ledger.events.push({ ...ledger.events[0], id: 'fixture-rollback-import', status: 'partial', appliedWorkers: ['alex'] });
      require('../lib/job-storage').atomicWrite(home.p('logs', 'crew-config.json'), ledger);
      await page.evaluate(() => window.__ui.openCrewConfig());
      await page.getByRole('status').filter({ hasText: /Incomplete import/ }).waitFor();
      await page.getByRole('button', { name: 'Preview settings rollback', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /Review this reverse diff/ }).waitFor();
      assert.equal(home.getAgent('alex').workerModel, 'fixture-ui-model');
      const apply = page.getByRole('button', { name: 'Apply reviewed rollback', exact: true }); assert.equal(await apply.isDisabled(), false);
      await page.getByLabel('Configuration diff', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'crew-yaml-rollback.png'), fullPage: true });
      await apply.click(); await page.getByRole('status').filter({ hasText: /Rollback applied and verified 1 field/ }).waitFor();
      assert.equal(home.getAgent('alex').workerModel, undefined); assert.equal(home.getAgent('alex').workerContext, 8192);
      const stored = JSON.parse(fs.readFileSync(home.p('logs', 'crew-config.json')));
      assert.equal(stored.events.at(-2).status, 'rolled_back'); assert.equal(stored.events.at(-1).operation, 'rollback');
      await page.getByRole('dialog', { name: 'Crew configuration', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    });
    await check('Storage Guardian trusted UI reports categories, preserves protected jobs and cancels release',async()=>{
      const fixture=require('./storage-job-benchmark');let j=home.createJob('bob','Retirement UI fixture');j=fixture.checkpoint(home,j,65536);home.updateJob('bob',j.id,{status:'done',acceptedBy:'human',acceptedAt:new Date(Date.now()-40*86400000).toISOString()});
      await page.evaluate(()=>window.__ui.openSettings());await page.getByRole('button',{name:'Storage Guardian',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Storage Guardian',exact:true});await dialog.getByText(/No automatic deletion/).waitFor();await dialog.getByRole('checkbox',{name:'Select recovery '+j.id,exact:true}).check();await dialog.getByRole('button',{name:'Preview selected release',exact:true}).click();await dialog.getByRole('status').getByText(/permanently removes native recovery/).waitFor();await page.screenshot({path:path.join(out,'storage-retention.png'),fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(home.findJob(j.id).nativeCheckpoint);
      await page.evaluate(()=>window.__ui.openSettings());await page.getByRole('button',{name:'Storage Guardian',exact:true}).click();const d=page.getByRole('dialog',{name:'Storage Guardian',exact:true});await d.getByRole('checkbox',{name:'Select recovery '+j.id,exact:true}).check();await d.getByRole('button',{name:'Preview selected release',exact:true}).click();await d.getByRole('button',{name:'Release previewed native recovery',exact:true}).click();await d.getByRole('status').getByText(/measured net Home reduction/).waitFor();assert.equal(home.findJob(j.id).storageRetirement.status,'released');assert.ok(home.findJob(interrupted.id).nativeCheckpoint);await d.getByRole('button',{name:'Cancel',exact:true}).click();
    });
    await check('accepted state survives a real renderer reload without exceptions', async () => {
      await page.reload(); await page.waitForFunction(() => document.body.classList.contains('revealed'));
      assert.equal(home.findJob(accepted.id).acceptedBy, 'human'); assert.deepEqual(errors, []);
    });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'passed', checks, electron: require('electron/package.json').version, errors, coverage: 'Real Linux Electron main/window/preload/IPC and SDK startup; developer screenshot driver disabled; no engines/live providers/Windows test.' }, null, 2));
  } catch (e) { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'failed', checks, errors, error: e.message }, null, 2)); throw e; }
  finally { if (app) await app.close(); fixtureServer.closeAllConnections();await new Promise(r=>fixtureServer.close(r)); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
