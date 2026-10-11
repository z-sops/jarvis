'use strict';
// Synthetic protected checkpoint only. No Orbit user profile, model or native CLI is opened.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const state=require('../lib/native-engine-state'),{createSecretStorage}=require('../lib/secret-storage');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const binding={engine:'opencode',image:'synthetic-key-fixture',provider:'fixture',model:'fixture',actor:'fixture',jobId:'fixture',runId:'fixture'};
const emit=value=>process.stdout.write('ORBIT_KEY_RESULT '+JSON.stringify(value)+'\n');
async function child(){
 if(process.platform!=='win32')throw Error('Windows protected fixture required.');
 const phase=process.argv[3],root=process.argv[4];
 if(!['save','restore'].includes(phase)||!root||fs.lstatSync(root).isSymbolicLink())throw Error('Invalid fixture.');
 const {app,safeStorage}=require('electron');const profile=path.join(root,'electron-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);await app.whenReady();
 const storage=createSecretStorage(safeStorage,'win32'),home={secretStorage:storage},file=path.join(root,'checkpoint.json');
 if(!storage.available())throw Error('OS protected storage unavailable.');
 if(phase==='save'){
  const bytes=Buffer.from('SYNTHETIC_PRIVATE_STATE_NOT_A_REAL_DATABASE');
  const bundle={version:1,adapter:1,engine:'opencode',sessionId:'synthetic-session',pendingEffects:0,retiredQueueRows:0,files:[{path:'data/opencode/opencode.db',bytes:bytes.length,sha256:sha(bytes),data:bytes.toString('base64')}]};
  require('../lib/job-storage').atomicWrite(file,state.seal(home,bundle,binding));
  emit({saved:true,protected:true});process.exit(77); // Abrupt app exit after flushed fixture, not a power-cut simulation.
 }
 const original=fs.readFileSync(file),saved=JSON.parse(original),checks={};
 checks.newProcessDecrypted=state.open(home,saved,binding).sessionId==='synthetic-session';
 try{state.open(home,saved,{...binding,actor:'foreign'});checks.foreignBindingBlocked=false;}catch{checks.foreignBindingBlocked=true;}
 const locked={secretStorage:createSecretStorage({isEncryptionAvailable:()=>false},'win32')};
 try{state.open(locked,saved,binding);checks.simulatedLockBlocked=false;}catch{checks.simulatedLockBlocked=true;}
 const bad=structuredClone(saved);bad.protected.ciphertext=Buffer.alloc(64,1).toString('base64');
 try{state.open(home,bad,binding);checks.corruptionBlocked=false;}catch{checks.corruptionBlocked=true;}
 checks.encryptedFileUnchanged=fs.readFileSync(file).equals(original);
 checks.noPlaintextFixture= !original.includes(Buffer.from('SYNTHETIC_PRIVATE_STATE'));
 emit({checks});app.exit(Object.values(checks).every(Boolean)?0:1);
}
if(process.argv[2]==='--key-child')child().catch(()=>{emit({error:'Protected fixture operation failed; no secret output.'});process.exit(1);});
else {
 const scope='Actual Windows Electron protected storage across abrupt fixture process exit/reopen; lock is simulated. Not logout/key-loss, physical outage, native SQLite/workspace crash consistency, live Guardian, provider, approval or billing proof.';
 if(process.platform!=='win32'){process.stdout.write(JSON.stringify({status:'unavailable',error:'Run this diagnostic on Windows with existing Electron dependencies.',scope})+'\n');process.exitCode=2;}
 else {
  let root,passed=false;
  try{
   const args=process.argv.slice(2);
   if(args.length&&!(args.length===2&&args[0]==='--electron'&&path.isAbsolute(args[1])&&fs.lstatSync(args[1]).isFile()&&!fs.lstatSync(args[1]).isSymbolicLink()))throw Error('Use an existing absolute Electron executable.');
   const binary=args.length?args[1]:require('electron');if(typeof binary!=='string')throw Error('Installed Electron unavailable.');
   root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-keystore-check-'));
   const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH'])if(process.env[k])env[k]=process.env[k];
   const run=phase=>cp.spawnSync(binary,[__filename,'--key-child',phase,root],{env,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,windowsHide:true});
   const saved=run('save');if(saved.error||saved.status!==77)throw Error('Protected checkpoint save/exit failed.');
   const restored=run('restore'),line=(restored.stdout||'').split(/\r?\n/).find(x=>x.startsWith('ORBIT_KEY_RESULT '));
   const result=line?JSON.parse(line.slice(17)):null;
   const required=['newProcessDecrypted','foreignBindingBlocked','simulatedLockBlocked','corruptionBlocked','encryptedFileUnchanged','noPlaintextFixture'];
   if(restored.error||restored.status!==0||!result?.checks||required.some(k=>result.checks[k]!==true)||Object.keys(result.checks).length!==required.length)throw Error('Protected checkpoint reopen failed.');
   passed=true;process.stdout.write(JSON.stringify({status:'passed',checks:{abruptFixtureExit:true,...result.checks},scope},null,2)+'\n');
  }catch{process.stdout.write(JSON.stringify({status:'failed',error:'Windows protected fixture failed. Existing app profiles were not opened.',fixtureRetained:!!root,scope})+'\n');process.exitCode=1;}
  finally{if(passed&&root)fs.rmSync(root,{recursive:true});}
 }
}
