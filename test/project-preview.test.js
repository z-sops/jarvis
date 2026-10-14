'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{EventEmitter}=require('events');
const {create,snapshot}=require('../lib/project-preview');
function rig(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'bob','site');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'<title>ZuniTech</title><script type="module" src="main.js"></script>');fs.writeFileSync(path.join(dir,'main.js'),'export const ready=true;');fs.writeFileSync(path.join(dir,'.env'),'SECRET');fs.writeFileSync(path.join(dir,'secrets.json'),'SECRET');return{root,dir};}
test('loopback preview serves immutable HTML/modules, blocks secrets, traversal, foreign hosts and POST',async t=>{
 const r=rig(t),service=create({workspace:()=>r.root});t.after(()=>service.stop());const p=await service.start(r.dir),base=p.url.replace(/index.html$/,'');
 fs.writeFileSync(path.join(r.dir,'main.js'),'changed');
 assert.match(await(await fetch(p.url)).text(),/ZuniTech/);
 const js=await fetch(base+'main.js');assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.equal(await js.text(),'export const ready=true;');assert.match(js.headers.get('content-security-policy'),/connect-src 'self'/);
 for(const name of ['.env','secrets.json','%2e%2e%2findex.html'])assert.ok((await fetch(base+name)).status>=400);
 assert.equal((await fetch(p.url,{method:'POST'})).status,403);
 const foreign=await new Promise((resolve,reject)=>{const req=require('http').get(p.url,{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(foreign,403);
 assert.equal((await fetch(p.url,{headers:{Origin:'https://evil.invalid'}})).status,403);
 assert.equal((await fetch(new URL('/index.html',p.url))).status,404);
 assert.ok(p.diagnostics().missingAssets.includes('secrets.json'));
 service.stop();await assert.rejects(fetch(p.url));
});
test('snapshot requires a bounded static project, refuses workspace root, external paths and links',t=>{
 const r=rig(t);assert.throws(()=>snapshot(r.root,r.root),/subfolder/);assert.throws(()=>snapshot(r.root,path.dirname(r.root)),/subfolder/);
 if(process.platform!=='win32'){fs.symlinkSync(path.join(r.dir,'main.js'),path.join(r.dir,'link.js'));assert.throws(()=>snapshot(r.root,r.dir),/Linked/);fs.unlinkSync(path.join(r.dir,'link.js'));}
 fs.writeFileSync(path.join(r.dir,'large.js'),Buffer.alloc(8*1024*1024+1));assert.throws(()=>snapshot(r.root,r.dir),/bound/);
});
test('preview tool reuses browser approval/open path, stays commander-only and stops on Stop',async t=>{
 const r=rig(t),bus=new EventEmitter(),calls=[],{createTools}=require('../lib/tools');
 const home={root:r.root,p:(...a)=>a[0]==='workspace'?path.join(r.root,...a.slice(1)):path.join(r.root,...a),listAgents:()=>[]};
 const tools=createTools({home,bus,getCfg:()=>({}),runtime:{browser:{manager:{open:async(actor,url)=>{calls.push({actor,url});return{snapshot:{title:'ZuniTech',text:'Loaded fixture'}};}}}},gemini:{},ask:async()=>{throw Error('Unexpected tool permission bypass');}});t.after(()=>tools.dispose());
 assert.equal(tools.decide('preview_project',{path:r.dir},'bob').level,'deny');
 const out=await tools.exec('preview_project',{path:r.dir},'commander');assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.pageLoaded,true);assert.equal(calls[0].actor,'commander');assert.match(out.verification,/unverified/);
 bus.emit('stop:pressed',{});await assert.rejects(fetch(out.url));
});
