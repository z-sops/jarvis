'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {killAfterSave}=require('../lib/fixture-kill-save');
const proof='ORBIT_KEY_RESULT '+JSON.stringify({saved:true,protected:true,keyPersistent:true})+'\n';
test('save controller kills only its own live child after complete flushed-save acknowledgement',async()=>{
 const result=await killAfterSave(process.execPath,['-e',`process.stdout.write(${JSON.stringify(proof)});setInterval(()=>{},1000);`],{},5000);
 assert.deepEqual(result,{saved:true,protected:true,forcedTermination:true});
});
test('normal exit, incomplete proof, malformed protocol and timeout cannot pass forced-save acceptance',async()=>{
 for(const code of [`process.exit(0)`, `console.log('ORBIT_KEY_RESULT {}');setInterval(()=>{},1000);`, `console.log('ORBIT_KEY_RESULT INVALID');setInterval(()=>{},1000);`, `setInterval(()=>{},1000);`]){
  const result=await killAfterSave(process.execPath,['-e',code],{},300);
  assert.equal(result.forcedTermination,false);assert.equal(result.saved,false);
 }
});
test('actual installed Linux Electron is force-terminated by parent after an asynchronous save marker',async t=>{
 if(process.platform!=='linux'){t.skip('Linux lifecycle probe only; actual Windows acceptance is separate.');return;}
 let binary;try{binary=require('electron');}catch{t.skip('Installed Electron unavailable.');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-key-kill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=path.join(root,'probe.cjs');fs.writeFileSync(script,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(root,'profile'))});app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{await new Promise(r=>setTimeout(r,100));process.stdout.write(${JSON.stringify(proof)});setInterval(()=>{},1000);});`);
 const env={};for(const k of ['PATH','HOME','XDG_RUNTIME_DIR','TMPDIR'])if(process.env[k])env[k]=process.env[k];
 const result=await killAfterSave(binary,['--no-sandbox','--ozone-platform=headless','--headless','--disable-gpu',script],env,10000);
 assert.equal(result.forcedTermination,true); // Lifecycle only, no Windows safeStorage claim.
});

test('controller forwards only allowlisted key-initialization diagnostics',async()=>{
 const payload={error:'PRIVATE_ERROR',diagnostics:{phase:'key_persistence',issue:'PRIVATE_ISSUE',localStateAtSave:false,keyRecordAtSave:false,electron:'44.4.3',node:'24.21.0',ciphertext:'PRIVATE_CIPHERTEXT'}};
 const line='ORBIT_KEY_RESULT '+JSON.stringify(payload)+'\n';
 const result=await killAfterSave(process.execPath,['-e',`process.stdout.write(${JSON.stringify(line)});setInterval(()=>{},1000);`],{},5000);
 assert.equal(result.forcedTermination,false);assert.equal(result.diagnostics.phase,'key_persistence');assert.equal(result.diagnostics.issue,'unknown');assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});
