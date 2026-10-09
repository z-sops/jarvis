'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const { Home } = require('../lib/home'), { Library } = require('../lib/library'), { LibraryProvider } = require('../lib/library-provider');
const { buildAgentPrompt } = require('../lib/persona'), { createTools } = require('../lib/tools');
const budget = require('../lib/context-budget');
function rig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-progressive-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(), agent = home.createAgent({ name: 'Alex', role: 'Developer' }), bus = new EventEmitter();
  const cfg = { aiName: 'Laila', userName: 'Fixture', lang: 'en' }, tools = createTools({ home, getCfg: () => cfg, bus, runtime: {}, gemini: {}, ask: async () => 'deny', openExternal: async () => {}, shell() {} });
  return { root, home, agent, cfg, tools, lib: new Library(home) };
}
test('100 local skills inject metadata, not all instruction bodies; selected tool reads only own skill', async t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' });
  for (let i = 0; i < 100; i++) r.home.addSkill('alex', 'Skill '+i, 'Brief description.\n\nDEEP_BODY_CANARY_'+i+'\n'+'x'.repeat(2000));
  r.home.addSkill('bob', 'Private', 'OTHER_WORKER_CANARY');
  const prompt = buildAgentPrompt(r.cfg, r.home, r.agent);
  assert.doesNotMatch(prompt, /DEEP_BODY_CANARY|OTHER_WORKER_CANARY/); assert.match(prompt, /skill-99/);
  assert.ok(Buffer.byteLength(prompt) < 25000);
  assert.match(JSON.stringify(await r.tools.exec('use_skill', { name: 'skill-7', actor: 'bob' }, 'alex')), /DEEP_BODY_CANARY_7/);
  assert.doesNotMatch(JSON.stringify(await r.tools.exec('use_skill', { name: 'private' }, 'alex')), /OTHER_WORKER_CANARY/);
  assert.doesNotMatch(JSON.stringify(await r.tools.exec('use_skill', { name: '../bob/private' }, 'alex')), /OTHER_WORKER_CANARY/);
});
test('library L1 and contracts do not read references; L2 opens only the requested file', async t => {
  const r = rig(t);
  r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/one.md': 'FIRST_CANARY', 'references/two.md': 'SECOND_CANARY' } });
  r.lib.setAssignment('alex', { skills: ['testing'] }); const provider = new LibraryProvider({ library: r.lib });
  const original = fs.readFileSync, reads = [];
  fs.readFileSync = function(f, ...a) { reads.push(String(f)); return original.call(this, f, ...a); };
  try {
    await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' });
    require('../lib/job-contract').build(r.home, r.agent, 'Test', { skills: ['testing'] });
    assert.equal(reads.some(f => f.endsWith('one.md') || f.endsWith('two.md')), false);
    const result = await provider.callTool('skill_read', { name: 'testing', path: 'references/one.md' }, { actor: 'alex' });
    assert.match(result.content[0].text, /FIRST_CANARY/); assert.equal(reads.some(f => f.endsWith('two.md')), false);
  } finally { fs.readFileSync = original; }
});
test('native MCP skill read uses authenticated actor and preserves explicit tool denial', async t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' });
  r.home.addSkill('alex', 'Own', 'OWN_CANARY'); r.home.addSkill('bob', 'Private', 'OTHER_CANARY');
  const { Connectors } = require('../lib/connectors'), { Hub } = require('../lib/hub'), { Gateway } = require('../lib/gateway');
  const connectors = new Connectors({ home: r.home }), gateway = new Gateway({ connectors, hub: new Hub({ ask: async () => 'deny' }),
    native: { use_skill: async (a, ctx) => { const out = await r.tools.exec('use_skill', a, ctx.actor); if (out.error) throw new Error(out.error); return out; } } });
  t.after(() => clearInterval(gateway.sweep));
  assert.match(JSON.stringify(await gateway.call('alex', 'orbit__use_skill', { name: 'own', actor: 'bob' })), /OWN_CANARY/);
  const denied = await gateway.call('alex', 'orbit__use_skill', { name: 'private', actor: 'bob' });
  assert.equal(denied.isError, true); assert.doesNotMatch(JSON.stringify(denied), /OTHER_CANARY/);
  connectors.setNativeLevel('use_skill', 'blocked'); assert.equal((await gateway.call('alex', 'orbit__use_skill', { name: 'own' })).isError, true);
});
test('revoked and oversized references are rejected without disclosing contents', async t => {
  const r = rig(t); r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/big.md': 'OVERSIZE_CANARY'+'x'.repeat(40000) } });
  r.lib.setAssignment('alex', { skills: ['testing'] }); const provider = new LibraryProvider({ library: r.lib });
  const out = await provider.callTool('skill_read', { name: 'testing', path: 'references/big.md' }, { actor: 'alex' });
  assert.equal(out.isError, true); assert.doesNotMatch(out.content[0].text, /OVERSIZE_CANARY/);
  r.lib.setAssignment('alex', { skills: [] }); assert.equal((await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' })).isError, true);
});
test('mandatory goal/state and pinned notes are never silently trimmed to fit', t => {
  const r = rig(t); fs.writeFileSync(path.join(r.home.agentDir('alex'), 'brain', 'rules.md'), 'MANDATORY_STATE_'+'x'.repeat(140000));
  assert.throws(() => buildAgentPrompt(r.cfg, r.home, r.agent), e => e.contextBudget === true);
  fs.writeFileSync(path.join(r.home.agentDir('alex'), 'brain', 'rules.md'), 'Keep safety rules.');
  const notes = Array.from({ length: 650 }, () => '- [pin] 2026-09-20 18:29  '+ 'p'.repeat(250)).join('\n');
  const file = path.join(r.home.agentDir('alex'), 'brain/memory/notes.md'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, notes);
  assert.throws(() => buildAgentPrompt(r.cfg, r.home, r.agent), e => e.contextBudget === true);
  assert.equal(fs.readFileSync(file, 'utf8'), notes);
  assert.throws(() => budget.check({ goal: 'GOAL', state: 'x'.repeat(2000) }, 1024), e => e.contextBudget === true);
  assert.equal(budget.check('é').bytes, 2); assert.throws(() => budget.check('x', NaN), /Invalid/);
});
test('oversized job stops before external dispatch and retains its full goal', async t => {
  const r = rig(t), bus = new EventEmitter(); let calls = 0;
  const workers = require('../lib/workers').createWorkers({ home: r.home, bus, getCfg: () => ({ engine: 'hermes' }),
    hermes: { runTask: async () => { calls++; return 'Report'; } }, tools: {}, gemini: {} });
  t.after(() => workers.cancelAll());
  const done = new Promise(resolve => bus.once('job:done', resolve)), goal = 'MANDATORY_GOAL_'+'x'.repeat(140000);
  const j = workers.dispatch('alex', goal); await done;
  assert.equal(calls, 0); const saved = r.home.findJob(j.id); assert.equal(saved.status, 'failed'); assert.equal(saved.task, goal); assert.match(saved.error, /request budget/);
});
test('on-demand skill reads reject links to files outside their allowed skill scope', async t => {
  const r = rig(t), outside = path.join(r.root, 'outside.txt'); fs.writeFileSync(outside, 'OUTSIDE_CANARY');
  r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/linked.md': 'Placeholder' } });
  r.lib.setAssignment('alex', { skills: ['testing'] });
  const ref = r.lib.p('skills', 'testing', 'references', 'linked.md'); fs.unlinkSync(ref); fs.symlinkSync(outside, ref);
  const provider = new LibraryProvider({ library: r.lib });
  let out = await provider.callTool('skill_read', { name: 'testing', path: 'references/linked.md' }, { actor: 'alex' });
  assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
  const body = r.lib.p('skills', 'testing', 'SKILL.md'); fs.unlinkSync(body); fs.symlinkSync(outside, body);
  out = await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' }); assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
  out = await provider.callTool('skill_list', {}, { actor: 'commander' }); assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
});
test('full builtin request budget includes tool schemas and denies before the first network call', async t => {
  const old = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw new Error('Unexpected network'); }; t.after(() => { global.fetch = old; });
  await assert.rejects(require('../lib/gemini').runLoop({ cfg: {}, system: 'GOAL', contents: [], tools: [{ name: 'test', description: 'x'.repeat(2000) }], exec: async () => ({}), requestBudgetBytes: 1024 }), e => e.contextBudget === true);
  assert.equal(calls, 0);
});
test('large tool result stops before next request without replaying the prior effect or deleting state', async t => {
  const old = global.fetch, submitted = []; let effects = 0;
  global.fetch = async (_url, options) => { submitted.push(JSON.parse(options.body)); return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'effect', args: {} } }] } }] }), { status: 200 }); };
  t.after(() => { global.fetch = old; });
  await assert.rejects(require('../lib/gemini').runLoop({ cfg: { apiKey: 'synthetic', textModel: 'fixture' }, system: 'KEEP_POLICY', contents: [{ role: 'user', parts: [{ text: 'KEEP_GOAL' }] }], tools: [], exec: async () => { effects++; return 'x'.repeat(3000); }, requestBudgetBytes: 1024 }), e => e.contextBudget === true);
  assert.equal(submitted.length, 1); assert.equal(effects, 1); assert.match(JSON.stringify(submitted[0]), /KEEP_POLICY/); assert.match(JSON.stringify(submitted[0]), /KEEP_GOAL/);
});

test('request limit counts retry submissions and stops before another paid model POST', async t => {
  const old=global.fetch;t.after(()=>{global.fetch=old;});let calls=0;const cap=budget.createRequestBudget(1);
  global.fetch=async()=>{calls++;return new Response('temporary failure',{status:503});};
  await assert.rejects(require('../lib/gemini').generate({apiKey:'synthetic',textModel:'fixture',geminiRetryDelays:[0],geminiNoFallback:true},{contents:[]},undefined,undefined,undefined,undefined,undefined,cap.beforeSubmit),e=>e.requestBudget===true);
  assert.equal(calls,1);assert.equal(cap.snapshot().attempted,1);
});
test('fallback and continuation share the same request allowance; failed reservations never submit', async t => {
  const old=global.fetch;t.after(()=>{global.fetch=old;});let calls=0;const cap=budget.createRequestBudget(1), cfg={apiKey:'synthetic',textModel:'primary',textFallbackModel:'fallback',geminiRetryDelays:[]};
  global.fetch=async()=>{calls++;return new Response('temporary failure',{status:503});};
  await assert.rejects(require('../lib/gemini').generate(cfg,{contents:[]},undefined,undefined,undefined,undefined,undefined,cap.beforeSubmit),e=>e.requestBudget===true);assert.equal(calls,1);
  await assert.rejects(require('../lib/gemini').runLoop({cfg,system:'Full goal',contents:[],exec:async()=>({}),beforeSubmit:cap.beforeSubmit}),e=>e.requestBudget===true);assert.equal(calls,1);
  const failed=budget.createRequestBudget(2,()=>{throw new Error('disk fault');});await assert.rejects(require('../lib/gemini').runLoop({cfg,system:'Goal',contents:[],exec:async()=>({}),beforeSubmit:failed.beforeSubmit}),e=>e.requestBudget===true);assert.equal(calls,1);
});
test('request exhaustion after a tool effect fails without repeating that effect or losing the goal', async t => {
  const old=global.fetch;t.after(()=>{global.fetch=old;});let requests=0,effects=0;const bodies=[],cap=budget.createRequestBudget(1);
  global.fetch=async(_url,o)=>{requests++;bodies.push(JSON.parse(o.body));return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{name:'effect',args:{}}}]}}]}),{status:200});};
  await assert.rejects(require('../lib/gemini').runLoop({cfg:{apiKey:'synthetic',textModel:'fixture'},system:'KEEP_POLICY',contents:[{role:'user',parts:[{text:'KEEP_GOAL'}]}],exec:async()=>{effects++;return {ok:true};},beforeSubmit:cap.beforeSubmit}),e=>e.requestBudget===true);
  assert.equal(requests,1);assert.equal(effects,1);assert.match(JSON.stringify(bodies[0]),/KEEP_GOAL/);
  for(const n of [0,501,NaN,1.5])assert.throws(()=>budget.createRequestBudget(n),/integer/);
});
test('worker persists its reserved submission count and fails at cap without replay', async t => {
  const r=rig(t), old=global.fetch, bus=new EventEmitter();t.after(()=>{global.fetch=old;});let effects=0,requests=0;
  global.fetch=async()=>{requests++;return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{id:'action',name:'effect',args:{}}}]}}]}),{status:200});};
  const workers=require('../lib/workers').createWorkers({home:r.home,bus,getCfg:()=>({...r.cfg,engine:'builtin',apiKey:'synthetic',textModel:'fixture',workerMaxRequests:1}),gemini:require('../lib/gemini'),tools:{declarationsFor:()=>[],exec:async()=>{effects++;return {ok:true};}}});t.after(()=>workers.cancelAll());
  const done=new Promise(resolve=>bus.once('job:done',resolve)), j=workers.dispatch('alex','Preserve goal');await done;const saved=r.home.findJob(j.id);
  assert.equal(saved.status,'failed');assert.equal(saved.task,'Preserve goal');assert.equal(saved.requestBudget.attempted,1);assert.equal(saved.requestBudget.limit,1);assert.equal(saved.requestBudget.boundary,'builtin_worker_only');assert.equal(effects,1);assert.equal(requests,1);
});

test('bounded text windows preserve UTF-8 characters and reach late content without eager whole-file reads', async t => {
  const r=rig(t), {readTextWindow}=require('../lib/text-window'), file=r.home.p('workspace','alex','large.txt');
  const text='é€🙂Z'.repeat(8000)+'LATE_CANARY';fs.writeFileSync(file,text);let content='',offset=0,windows=0;
  while(true) { const out=readTextWindow(file,{offset,limit:19}); assert.ok(out.bytesRead<=19); assert.ok(out.nextOffset>=offset); content+=out.content;windows++;if(!out.truncated)break;offset=out.nextOffset; }
  assert.equal(content,text);assert.ok(windows>2);
  const original=fs.readSync,reads=[];fs.readSync=function(fd,b,o,n,pos){reads.push({n,pos});return original.call(this,fd,b,o,n,pos);};
  try {const late=Buffer.byteLength(text)-11;const out=await r.tools.exec('read_file',{path:'large.txt',offset:late,limit:19},'alex');assert.match(out.content,/LATE_CANARY/);assert.deepEqual(reads,[{n:11,pos:late}]);}finally{fs.readSync=original;}
  for(const args of [{offset:-1},{offset:1.1},{limit:20001},{limit:3}])assert.throws(()=>readTextWindow(file,args),/byte/);
  assert.throws(()=>readTextWindow(file,{offset:1,limit:19}),/UTF-8/);
  fs.writeFileSync(file,Buffer.from([65,0]));assert.throws(()=>readTextWindow(file),/binary/);
  fs.writeFileSync(file,Buffer.from([65,0xc3]));assert.throws(()=>readTextWindow(file),/UTF-8/);
});
test('Files connector window mode reuses bounded reader while retaining root/secret restrictions', async t => {
  const r=rig(t), {FilesProvider}=require('../lib/fsmcp'), root=path.join(r.root,'files-root');fs.mkdirSync(root);const file=path.join(root,'text.txt');fs.writeFileSync(file,'FirstSECOND');
  const provider=new FilesProvider({roots:[root],allowUnder:r.root});
  const text=provider.t_read_text_file({path:file,offset:5,limit:6});assert.equal(JSON.parse(text).content,'SECOND');
  assert.throws(()=>provider.t_read_text_file({path:file,offset:0,head:2}),/cannot combine/);
  assert.throws(()=>provider.t_read_text_file({path:path.join(r.root,'outside.txt'),offset:0}),/allowed|outside|folder/i);
  fs.writeFileSync(path.join(root,'.env'),'SECRET_CANARY');assert.throws(()=>provider.t_read_text_file({path:path.join(root,'.env'),limit:10}),/secret/i);
});

test('adaptive read projection preserves protected state/signatures/effects and retains original history', () => {
  const messages=[{role:'user',parts:[{text:'KEEP_FULL_GOAL_AND_APPROVAL_RULE'}]}];
  for(let i=0;i<5;i++){
    messages.push({role:'model',parts:[{functionCall:{id:'read-'+i,name:'read_file',args:{path:'file-'+i}},thoughtSignature:'KEEP_SIGNATURE_'+i}]});
    messages.push({role:'user',parts:[{functionResponse:{id:'read-'+i,name:'read_file',response:{result:{path:'file-'+i,content:i<3?'DATA_'+i+'x'.repeat(4000):'CURRENT_DATA_'+i,offset:0}}}}]});
  }
  const effect={role:'user',parts:[{functionResponse:{id:'effect',name:'write_file',response:{result:{ok:true,receipt:'KEEP_EFFECT_RECEIPT'}}}}]};messages.push(effect);
  const body={systemInstruction:{parts:[{text:'KEEP_SYSTEM_POLICY'}]},contents:messages,tools:[{functionDeclarations:[{name:'read_file'}]}]}, before=JSON.stringify(body);
  const fitted=budget.fitReadHistory(body,4000);assert.ok(fitted.afterBytes<=4000);assert.equal(fitted.omittedReadResults,3);assert.equal(JSON.stringify(body),before);
  assert.deepEqual(fitted.body.systemInstruction,body.systemInstruction);assert.deepEqual(fitted.body.tools,body.tools);assert.deepEqual(fitted.body.contents[0],body.contents[0]);assert.deepEqual(fitted.body.contents.at(-1),effect);
  for(let i=0;i<5;i++)assert.deepEqual(fitted.body.contents[1+i*2],body.contents[1+i*2]);
  assert.match(JSON.stringify(fitted.body),/CURRENT_DATA_3/);assert.match(JSON.stringify(fitted.body),/CURRENT_DATA_4/);assert.match(JSON.stringify(fitted.body),/not verification/);
  body.systemInstruction.parts[0].text='MANDATORY_'+'x'.repeat(5000);assert.throws(()=>budget.fitReadHistory(body,4000),e=>e.contextBudget===true);
});
test('builtin compaction changes only transmitted older read data, not checkpoint conversation or actions', async t => {
  const old=global.fetch;t.after(()=>{global.fetch=old;});const contents=[];
  for(let i=0;i<4;i++)contents.push({role:'user',parts:[{functionResponse:{name:'read_file',response:{result:{path:'file-'+i,content:i<2?'x'.repeat(4000):'RECENT_'+i}}}}]});
  const snapshot=JSON.stringify(contents);let submitted,measurement;
  global.fetch=async(_url,o)=>{submitted=JSON.parse(o.body);return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'Report remains unverified.'}]}}]}),{status:200});};
  const out=await require('../lib/gemini').runLoop({cfg:{apiKey:'synthetic',textModel:'fixture'},system:'KEEP_RULES',contents,exec:async()=>{throw new Error('No effect expected');},requestBudgetBytes:3000,compactReadHistory:true,onContext:m=>{measurement=m;}});
  assert.equal(JSON.stringify(contents),snapshot);assert.equal(out.convo[0].parts[0].functionResponse.response.result.content.length,4000);assert.ok(Buffer.byteLength(JSON.stringify(submitted))<=3000);assert.equal(measurement.omittedReadResults,2);assert.equal(measurement.boundary,'builtin_read_data_projection');
});

test('nested Gemini tool requests share the worker cap instead of bypassing it', async t => {
  const old=global.fetch;t.after(()=>{global.fetch=old;});let requests=0;const cap=budget.createRequestBudget(1),gemini=require('../lib/gemini'),cfg={apiKey:'synthetic',textModel:'fixture'};
  global.fetch=async()=>{requests++;return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{functionCall:{name:'read_image',args:{}}}]}}]}),{status:200});};
  await assert.rejects(gemini.runLoop({cfg,system:'Keep goal',contents:[],beforeSubmit:cap.beforeSubmit,exec:async()=>gemini.generate(cfg,{contents:[]})}),e=>e.requestBudget===true);assert.equal(requests,1);assert.equal(cap.snapshot().attempted,1);
});

test('Files tail reads the actual end of a large file instead of the end of its first scan window', t => {
  const r=rig(t), {FilesProvider}=require('../lib/fsmcp'), root=path.join(r.root,'tail-root');fs.mkdirSync(root);const file=path.join(root,'large.txt');fs.writeFileSync(file,'FIRST_CANARY\n'+'a'.repeat(9000000)+'\nFINAL_CANARY');
  const provider=new FilesProvider({roots:[root]});assert.equal(provider.t_read_text_file({path:file,tail:1}),'FINAL_CANARY');assert.equal(provider.t_read_text_file({path:file,head:1}),'FIRST_CANARY');
  assert.throws(()=>provider.t_read_text_file({path:file,head:1,tail:1}),/not both/);assert.throws(()=>provider.t_read_text_file({path:file,tail:0}),/integer/);
});
