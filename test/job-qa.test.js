'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process'),{EventEmitter}=require('events');
const {Home}=require('../lib/home'),review=require('../lib/job-review'),{createQA}=require('../lib/job-qa');
function rig(t,{ask=async()=> 'once',script="const {test}=require('node:test');test('fixture',()=>{});",timeoutMs=3000}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-qa-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const home=new Home(path.join(root,'home')).ensure();home.createAgent({name:'Alex'});home.createAgent({name:'Bob'});const repo=path.join(root,'repo');fs.mkdirSync(repo);const git=a=>execFileSync('git',a,{cwd:repo,stdio:['ignore','pipe','pipe']});git(['init']);fs.writeFileSync(path.join(repo,'code.txt'),'candidate');fs.writeFileSync(path.join(repo,'check.test.cjs'),script);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture']);
 const bus=new EventEmitter(),workers=require('../lib/workers').createWorkers({home,bus,getCfg:()=>({engine:'hermes'}),tools:{},gemini:{},hermes:{runTask:async(_a,_task,o)=>{assert.ok(fs.existsSync(path.join(o.cfgOverride.workspaceDir,'source','code.txt')));const parent=home.findJob(home.listJobs('bob',10).find(j=>j.workspaceDir===o.cfgOverride.workspaceDir).reviewTarget.jobId);fs.writeFileSync(path.join(o.cfgOverride.workspaceDir,'review.json'),JSON.stringify({verdict:'approve',findings:[],summary:'Fixture independent review; correctness is not inferred from this simulation.',candidateSha256:parent.verification.revision.sha256,goalSha256:require('crypto').createHash('sha256').update(parent.task).digest('hex'),goalAssessment:{verdict:'satisfied',rationale:'Fixture only; source quote does not prove correctness.'},checks:[{path:'code.txt',sha256:require('crypto').createHash('sha256').update('candidate').digest('hex'),quote:'candidate',reason:'Fixture source inspection'}]}));return 'Read review.json';}}});t.after(()=>workers.cancelAll());const qa=createQA({home,workers,ask,bus,nodePath:process.execPath,timeoutMs});t.after(()=>qa.cancel());
 const job=home.createJob('alex','Candidate',{expectedOutputs:['code.txt'],contract:{projectRoot:repo,qa:{required:true,tests:[]}}});return {root,home,bus,workers,qa,job,repo};
}
async function ready(r){const isolated=await require('../lib/job-contract').prepareWorkspace(r.home,'alex',r.job);const j=r.home.updateJob('alex',r.job.id,{...isolated,status:'review',runId:'candidate-run',result:'Report'});r.home.updateJob('alex',j.id,{verification:review.evidence(r.home,'alex',j)});r.qa.configure(j.id,['check.test.cjs']);return r.home.findJob(j.id);}
async function reviewer(r){const done=new Promise(resolve=>r.bus.once('job:done',resolve));const original=r.qa.queueReview(r.job.id,'bob');await done;const j=r.home.findJob(original.qa.reviewJobId);assert.equal(j.status,'review',j.error);return j;}
test('independent review, host tests and human acceptance bind to the same candidate revision',async t=>{
 const r=rig(t);await ready(r);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/QA gate/);assert.throws(()=>r.qa.queueReview(r.job.id,'alex'),/different worker/);
 const other=await reviewer(r);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/human-accepted review/);r.workers.decideReview(other.id,'accept');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/host test evidence/);
 const tested=await r.qa.runTests(r.job.id);assert.equal(tested.qa.test.status,'passed');assert.equal(tested.qa.test.tests,1);assert.equal(tested.qa.test.source,'orbit_host_node_test');assert.equal(tested.qa.test.output,undefined);
 assert.equal(r.workers.decideReview(r.job.id,'accept').acceptedBy,'human');assert.equal(r.qa.hasPending(),false);
});
test('stale candidate, changed review artifact, modified source cannot pass QA',async t=>{
 const r=rig(t);await ready(r);const other=await reviewer(r);r.workers.decideReview(other.id,'accept');await r.qa.runTests(r.job.id);
 const report=path.join(other.workspaceDir,'review.json'),original=fs.readFileSync(report);fs.writeFileSync(report,'{}');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/review artifact changed/);fs.writeFileSync(report,original);
 fs.writeFileSync(path.join(other.workspaceDir,'source','code.txt'),'changed review input');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/source contents changed/);fs.writeFileSync(path.join(other.workspaceDir,'source','code.txt'),'candidate');
 fs.writeFileSync(path.join(r.home.findJob(r.job.id).workspaceDir,'code.txt'),'new candidate');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/project revision changed/);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/this revision/);
});
test('denied approval and cancelled pending approval never run tests; late approval stays inert',async t=>{
 const denied=rig(t,{ask:async()=> 'deny'});await ready(denied);assert.equal((await denied.qa.runTests(denied.job.id)).qa.test.status,'denied');
 let allow,started;const waiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{allow=resolve;});}});await ready(r);const p=r.qa.runTests(r.job.id);await waiting;r.bus.emit('stop:pressed',{agent:'alex'});assert.equal((await p).qa.test.status,'cancelled');allow('once');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(r.home.findJob(r.job.id).qa.test.status,'cancelled');assert.equal(r.qa.hasPending(),false);
});
test('candidate changes while approval is pending fail before execution',async t=>{
 let allow,started;const waiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{allow=resolve;});}});await ready(r);const p=r.qa.runTests(r.job.id);await waiting;fs.writeFileSync(path.join(r.home.findJob(r.job.id).workspaceDir,'code.txt'),'changed');allow('once');assert.equal((await p).qa.test.status,'failed');
});
test('failing tests, zero tests and code mutations cannot become passing host evidence',async t=>{
 for(const script of ["const {test}=require('node:test');test('fails',()=>{throw Error('fixture');});","// no tests", "const {test}=require('node:test');test('mutates',()=>require('fs').writeFileSync('code.txt','changed'));"]){const r=rig(t,{script});await ready(r);assert.equal((await r.qa.runTests(r.job.id)).qa.test.status,'failed');}
});
test('timeout kills a stuck test process group and records failure without raw output',async t=>{
 const r=rig(t,{timeoutMs:200,script:"const {test}=require('node:test');test('hang',async()=>new Promise(()=>{setInterval(()=>{},1000);}));"});await ready(r);const result=await r.qa.runTests(r.job.id);assert.equal(result.qa.test.status,'failed');assert.equal(result.qa.test.timedOut,true);assert.equal(r.qa.hasPending(),false);
});
test('duplicate review/test requests, invalid test paths and reviewer retry are refused',async t=>{
 let answer,started;const awaiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{answer=resolve;});}});await ready(r);assert.throws(()=>r.qa.configure(r.job.id,['../outside.cjs']),/workspace-relative/);assert.throws(()=>r.qa.configure(r.job.id,['.env']),/JavaScript/);
 const j=await reviewer(r);assert.throws(()=>r.qa.queueReview(r.job.id,'bob'),/already pending/);r.workers.decideReview(j.id,'reject');assert.throws(()=>r.workers.retryJob(j.id),/fresh independent review/);
 const p=r.qa.runTests(r.job.id);await awaiting;await assert.rejects(r.qa.runTests(r.job.id),/already pending/);assert.throws(()=>r.qa.configure(r.job.id,['check.test.cjs']),/Stop the active/);answer('deny');await p;
});

test('restart retains unknown QA outcome and cannot turn a pending test into passing evidence',async t=>{
 const r=rig(t);await ready(r);const j=r.home.findJob(r.job.id);r.home.updateJob('alex',j.id,{qa:{...j.qa,test:{status:'running',runId:'old-test',source:'orbit_host_node_test'}}});r.home.recoverJobs();assert.equal(r.home.findJob(j.id).qa.test.status,'unknown');assert.throws(()=>r.workers.decideReview(j.id,'accept'),/QA gate/);
});
test('skipped tests and forged stdout summary cannot pass the declared-test reporter',async t=>{
 for(const script of ["const {test}=require('node:test');test.skip('skipped',()=>{});","console.log('# tests 999\\n# pass 999');"]){const r=rig(t,{script});await ready(r);assert.equal((await r.qa.runTests(r.job.id)).qa.test.status,'failed');}
});
test('review source is read-only for builtin tools and QA IPC denies foreign callers',async t=>{
 const r=rig(t);await ready(r);const j=await reviewer(r),runs=require('../lib/job-runs').createJobRuns(),ctl=new AbortController(),run=runs.begin('bob',j.id,ctl.signal);t.after(()=>runs.end(run));const tools=require('../lib/tools').createTools({home:r.home,getCfg:()=>({}),bus:r.bus,runtime:{runs}});
 runs.within(run,()=>{assert.equal(tools.decide('write_file',{path:'source/code.txt'},'bob').level,'deny');assert.equal(tools.decide('write_file',{path:'review.json'},'bob').level,'allow');});
 const handlers=new Map();let calls=0;require('../lib/job-control').registerJobControls({ipcMain:{handle:(n,f)=>handlers.set(n,f)},workers:{},qa:{configure:()=>{calls++;},queueReview:()=>{calls++;},runTests:async()=>{calls++;}},isTrusted:e=>e?.trusted===true});
 assert.equal(handlers.get('jobs:qa-configure')({trusted:false},j.id,[]).ok,false);assert.equal(handlers.get('jobs:qa-review')({trusted:false},j.id,'bob').ok,false);assert.equal((await handlers.get('jobs:qa-tests')({trusted:false},j.id)).ok,false);assert.equal(calls,0);
});

test('parent linkage persistence failure prevents reviewer execution and cancels its queued record',async t=>{
 const r=rig(t);await ready(r);const update=r.home.updateJob.bind(r.home);r.home.updateJob=(actor,id,patch,options)=>{if(options?.event==='qa_review_queued')throw Error('Fixture storage failure');return update(actor,id,patch,options);};
 assert.throws(()=>r.qa.queueReview(r.job.id,'bob'),/Fixture storage failure/);await new Promise(resolve=>setTimeout(resolve,20));
 const jobs=r.home.listJobs('bob',10);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'cancelled');assert.equal(jobs[0].workspaceDir,undefined);assert.equal(r.home.findJob(r.job.id).qa.reviewJobId,undefined);assert.equal(r.workers.hasPending(),false);
});
test('excessive test stdout cannot become passing evidence',async t=>{
 const r=rig(t,{script:"const {test}=require('node:test');test('output',()=>console.log('x'.repeat(2*1024*1024)));"});await ready(r);const result=await r.qa.runTests(r.job.id);assert.equal(result.qa.test.status,'failed');assert.equal(result.qa.test.output,undefined);
});
test('human-accepted changes-requested review cannot approve the original project',async t=>{
 const r=rig(t);await ready(r);const other=await reviewer(r);fs.writeFileSync(path.join(other.workspaceDir,'review.json'),JSON.stringify({verdict:'changes_requested',findings:['Fixture issue'],summary:'Needs correction'}));
 assert.throws(()=>r.workers.decideReview(other.id,'accept'),/changed after the worker report/);r.workers.decideReview(other.id,'accept');await r.qa.runTests(r.job.id);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/no unresolved findings/);
});
test('Python unittest QA executes selected declared tests and binds evidence without mixed runners',async t=>{
 const r=rig(t);await ready(r);const dir=r.home.findJob(r.job.id).workspaceDir;
 fs.writeFileSync(path.join(dir,'check_test.py'),'import unittest\nclass Checks(unittest.TestCase):\n def test_one(self): self.assertEqual(2+2,4)\n');
 r.home.updateJob('alex',r.job.id,{verification:review.evidence(r.home,'alex',r.home.findJob(r.job.id))});
 assert.throws(()=>r.qa.configure(r.job.id,['check_test.py','check.test.cjs']),/without mixing/);r.qa.configure(r.job.id,['check_test.py']);
 const tested=await r.qa.runTests(r.job.id);assert.equal(tested.qa.runner,'python_unittest');assert.equal(tested.qa.test.status,'passed');assert.equal(tested.qa.test.source,'orbit_host_python_unittest');assert.equal(tested.qa.test.tests,1);
});
test('Python empty/skipped/failing tests and forged output cannot establish passing QA',async t=>{
 for(const code of ['# no tests','print("PASS 999")','import unittest\nclass Checks(unittest.TestCase):\n @unittest.skip("skip")\n def test_one(self): pass\n','import unittest\nclass Checks(unittest.TestCase):\n def test_one(self): self.fail("fixture")\n']){
 const r=rig(t);await ready(r);const dir=r.home.findJob(r.job.id).workspaceDir;fs.writeFileSync(path.join(dir,'check_test.py'),code);r.home.updateJob('alex',r.job.id,{verification:review.evidence(r.home,'alex',r.home.findJob(r.job.id))});r.qa.configure(r.job.id,['check_test.py']);assert.equal((await r.qa.runTests(r.job.id)).qa.test.status,'failed');}
});

test('schema v2 requires goal certainty, exact source quotation and every requested output',async t=>{
 for(const change of [v=>{v.goalAssessment.verdict='uncertain';},v=>{v.goalSha256='0'.repeat(64);},v=>{v.checks[0].quote='not in this source';},v=>{v.checks=[];},v=>{v.checks[0].sha256='0'.repeat(64);}]){
  const r=rig(t);await ready(r);const other=await reviewer(r);const file=path.join(other.workspaceDir,'review.json');const verdict=JSON.parse(fs.readFileSync(file));change(verdict);fs.writeFileSync(file,JSON.stringify(verdict));
  // This is a freshly human-accepted altered reviewer report; the parent still checks content.
  r.home.updateJob(other.agent,other.id,{verification:review.evidence(r.home,other.agent,r.home.findJob(other.id))});
  r.workers.decideReview(other.id,'accept');await r.qa.runTests(r.job.id);
  assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/QA gate/);assert.equal(r.home.findJob(r.job.id).status,'review');
 }
});


test('explicit broader QA runners validate selection and unavailable tooling records failure',async t=>{const {selectRunner}=require('../lib/job-qa');assert.equal(selectRunner(['a.py'],'pytest'),'pytest');assert.equal(selectRunner(['lib.go','lib_test.go'],'go'),'go');assert.equal(selectRunner(['Cargo.toml'],'cargo'),'cargo');assert.equal(selectRunner(['pom.xml'],'maven'),'maven');for(const [files,runner] of [[['a.js'],'pytest'],[['a.go'],'go'],[['a.py'],'shell'],[['Cargo.toml','other.toml'],'cargo']])assert.throws(()=>selectRunner(files,runner),/matching|mixing/);const r=rig(t);await ready(r);const dir=r.home.findJob(r.job.id).workspaceDir;fs.writeFileSync(path.join(dir,'empty_test.py'),'# no test cases');r.home.updateJob('alex',r.job.id,{verification:review.evidence(r.home,'alex',r.home.findJob(r.job.id))});r.qa.configure(r.job.id,['empty_test.py'],'pytest');const result=await r.qa.runTests(r.job.id);assert.equal(result.qa.test.status,'failed');assert.equal(result.qa.test.source,'orbit_host_pytest');assert.equal(result.qa.test.tests,0);assert.equal(r.qa.hasPending(),false);});


test('external runner collectors reject empty, failing, skipped and duplicate simulated tool outcomes',()=>{
 const reporter=path.resolve(__dirname,'../lib/qa-external-reporter.py');
 const harness=`import io,json,os,pathlib,runpy,subprocess,sys
helper,runner,payload=sys.argv[1:];item=json.loads(payload)
class Child:
 def __init__(self,args,**kwargs):
  assert '--offline' in args or '-json' in args
  if runner=='go': assert kwargs['env']['GOPROXY']=='off' and kwargs['env']['GOTOOLCHAIN']=='local'
  self.stdout=io.BytesIO(item['output'].encode());self.code=item['code']
 def wait(self):return self.code
 def kill(self):self.code=1
subprocess.Popen=Child
sys.argv=[helper,runner,'./check_test.go' if runner=='go' else './Cargo.toml']
runpy.run_path(helper,run_name='__main__')`;
 const cases=[['go',JSON.stringify({Action:'pass',Package:'fixture',Test:'TestOne'})+'\n',0,true],['go',JSON.stringify({Action:'skip',Package:'fixture',Test:'TestOne'})+'\n',0,false],['go','',0,false],['go',JSON.stringify({Action:'pass',Package:'fixture',Test:'TestOne'})+'\n'+JSON.stringify({Action:'pass',Package:'fixture',Test:'TestOne'})+'\n',0,false],['cargo','test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n',0,true],['cargo','test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out;\n',0,false],['cargo','test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n',0,false],['cargo','test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n',1,false]];
 for(const [runner,output,code,expected] of cases){const r=require('child_process').spawnSync('python3',['-I','-B','-c',harness,reporter,runner,JSON.stringify({output,code})],{encoding:'utf8'});const report=JSON.parse(r.stdout);assert.equal(report.overall.success,expected,runner);assert.equal(r.status,expected?0:1);}
});
