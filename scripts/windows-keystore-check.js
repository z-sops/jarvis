'use strict';
// Synthetic protected checkpoint only. No Orbit user profile, model or native CLI is opened.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const state=require('../lib/native-engine-state'),{createSecretStorage}=require('../lib/secret-storage');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const binding={engine:'opencode',image:'synthetic-key-fixture',provider:'fixture',model:'fixture',actor:'fixture',jobId:'fixture',runId:'fixture'};
const emit=value=>process.stdout.write('ORBIT_KEY_RESULT '+JSON.stringify(value)+'\n');
const phases=['arguments','electron_ready','storage_available','key_persistence','checkpoint_save','checkpoint_read','os_decrypt','payload_json','checkpoint_decrypt','negative_checks'];
let childPhase='arguments',keyEvidence=null;
const childFailure=e=>({phase:childPhase,issue:['EACCES','EPERM','ENOENT','ENOSPC','EIO'].includes(e?.code)?e.code:'operation_failed',...(keyEvidence||{}),electron:/^\d+\.\d+\.\d+$/.test(process.versions?.electron||'')?process.versions.electron:null,node:/^\d+\.\d+\.\d+$/.test(process.versions?.node||'')?process.versions.node:null});
async function child(){
 if(process.platform!=='win32')throw Error('Windows protected fixture required.');
 const phase=process.argv[3],root=process.argv[4];
 if(!['save','restore'].includes(phase)||!root||fs.lstatSync(root).isSymbolicLink())throw Error('Invalid fixture.');
 childPhase='electron_ready';
 const {app,safeStorage}=require('electron');const profile=path.join(root,'electron-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);await app.whenReady();
 if(path.resolve(app.getPath('sessionData'))!==path.resolve(profile))throw Error('Fixture profile binding changed.');
 const keyRecord=flush=>require('../lib/windows-key-state').keyRecord(profile, flush);
 const storage=createSecretStorage(safeStorage,'win32',{beforeSeal:()=>!!keyRecord(true).key}),home={secretStorage:storage},file=path.join(root,'checkpoint.json');
 childPhase='storage_available';if(!storage.available())throw Error('OS protected storage unavailable.');
 if(phase==='save'){
  childPhase='key_persistence';
  // Trigger only a disposable synthetic encryption, never save a checkpoint before readiness.
  safeStorage.encryptString('ORBIT_KEY_READINESS_PROBE');
  const deadline=Date.now()+30000;
  while(!keyRecord(true).key && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,200));
  const ready=keyRecord(true);keyEvidence={localStateAtSave:ready.present,keyRecordAtSave:!!ready.key};
  if(!ready.key)throw Error('Protected key record is not persistent.');
  const bytes=Buffer.from('SYNTHETIC_PRIVATE_STATE_NOT_A_REAL_DATABASE');
  const bundle={version:1,adapter:1,engine:'opencode',sessionId:'synthetic-session',pendingEffects:0,retiredQueueRows:0,files:[{path:'data/opencode/opencode.db',bytes:bytes.length,sha256:sha(bytes),data:bytes.toString('base64')}]};
  childPhase='checkpoint_save';require('../lib/job-storage').atomicWrite(file,state.seal(home,bundle,binding));
  require('../lib/job-storage').atomicWrite(path.join(root,'key-evidence.json'),keyRecord()); // Fingerprint stays private; only booleans are emitted.
  emit({saved:true,protected:true});process.exit(77); // Abrupt app exit after flushed fixture, not a power-cut simulation.
 }
 childPhase='checkpoint_read';const original=fs.readFileSync(file),saved=JSON.parse(original),checks={};
 const before=JSON.parse(fs.readFileSync(path.join(root,'key-evidence.json'))),after=keyRecord();
 keyEvidence={localStateAtSave:before.present===true,keyRecordAtSave:!!before.key,localStateAtRestore:after.present,keyRecordAtRestore:!!after.key,keyRecordUnchanged:!!before.key&&before.key===after.key};
 childPhase='os_decrypt';const plaintext=safeStorage.decryptString(Buffer.from(saved.protected.ciphertext,'base64'));
 childPhase='payload_json';JSON.parse(plaintext); // Never emit decrypted content or provider error text.
 childPhase='checkpoint_decrypt';
 checks.newProcessDecrypted=state.open(home,saved,binding).sessionId==='synthetic-session';
 childPhase='negative_checks';try{state.open(home,saved,{...binding,actor:'foreign'});checks.foreignBindingBlocked=false;}catch{checks.foreignBindingBlocked=true;}
 const locked={secretStorage:createSecretStorage({isEncryptionAvailable:()=>false},'win32')};
 try{state.open(locked,saved,binding);checks.simulatedLockBlocked=false;}catch{checks.simulatedLockBlocked=true;}
 const bad=structuredClone(saved);bad.protected.ciphertext=Buffer.alloc(64,1).toString('base64');
 try{state.open(home,bad,binding);checks.corruptionBlocked=false;}catch{checks.corruptionBlocked=true;}
 checks.encryptedFileUnchanged=fs.readFileSync(file).equals(original);
 checks.noPlaintextFixture= !original.includes(Buffer.from('SYNTHETIC_PRIVATE_STATE'));
 emit({checks});app.exit(Object.values(checks).every(Boolean)?0:1);
}
if(process.argv[2]==='--key-child')child().catch(e=>{const value={error:'Protected fixture operation failed; no secret output.',diagnostics:childFailure(e)};process.stdout.write('ORBIT_KEY_RESULT '+JSON.stringify(value)+'\n',()=>process.exit(1));});
else {
 const scope='Actual Windows Electron protected storage after a bounded key-initialization wait, then abrupt fixture process exit/reopen; lock is simulated. Earlier immediate cold-start crash failed. Not logout/key-loss, physical outage, native SQLite/workspace crash consistency, live Guardian, provider, approval or billing proof.';
 if(process.platform!=='win32'){process.stdout.write(JSON.stringify({status:'unavailable',error:'Run this diagnostic on Windows with existing Electron dependencies.',scope})+'\n');process.exitCode=2;}
 else {
  let root,passed=false,stage='executable',diagnostics=null;
  const parse=result=>{try{const line=(result.stdout||'').split(/\r?\n/).find(x=>x.startsWith('ORBIT_KEY_RESULT '));return line?JSON.parse(line.slice(17)):null;}catch{return null;}};
  const describe=result=>{const d=parse(result)?.diagnostics;return {exitCode:Number.isInteger(result.status)?result.status:null,signal:['SIGTERM','SIGKILL','SIGABRT'].includes(result.signal)?result.signal:null,spawnIssue:result.error?(['ETIMEDOUT','ENOENT','EACCES','EPERM','ENOBUFS'].includes(result.error.code)?result.error.code:'launch_failed'):null,protocolPresent:!!parse(result),...(d?{childPhase:phases.includes(d.phase)?d.phase:'unknown',childIssue:['EACCES','EPERM','ENOENT','ENOSPC','EIO','operation_failed'].includes(d.issue)?d.issue:'unknown',...Object.fromEntries(['localStateAtSave','keyRecordAtSave','localStateAtRestore','keyRecordAtRestore','keyRecordUnchanged'].filter(k=>typeof d[k]==='boolean').map(k=>[k,d[k]])),electron:/^\d+\.\d+\.\d+$/.test(d.electron||'')?d.electron:null,node:/^\d+\.\d+\.\d+$/.test(d.node||'')?d.node:null}:{}),startupIssue:/Cannot find module/.test(result.stderr||'')?'module_unavailable':/SyntaxError/.test(result.stderr||'')?'script_syntax':/is not a function/.test(result.stderr||'')?'runtime_api_mismatch':'unknown'};};
  try{
   const args=process.argv.slice(2);
   if(args.length&&!(args.length===2&&args[0]==='--electron'&&path.isAbsolute(args[1])&&fs.lstatSync(args[1]).isFile()&&!fs.lstatSync(args[1]).isSymbolicLink()))throw Error('Use an existing absolute Electron executable.');
   const binary=args.length?args[1]:require('electron');if(typeof binary!=='string')throw Error('Installed Electron unavailable.');
   root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-keystore-check-'));
   const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH'])if(process.env[k])env[k]=process.env[k];
   const run=phase=>cp.spawnSync(binary,[__filename,'--key-child',phase,root,'--user-data-dir='+path.join(root,'electron-profile')],{env,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,windowsHide:true});
   stage='save_process';const saved=run('save');diagnostics=describe(saved);if(saved.error||saved.status!==77)throw Error('Protected checkpoint save/exit failed.');
   stage='restore_process';const restored=run('restore');diagnostics=describe(restored);
   const result=parse(restored);
   const required=['newProcessDecrypted','foreignBindingBlocked','simulatedLockBlocked','corruptionBlocked','encryptedFileUnchanged','noPlaintextFixture'];
   if(restored.error||restored.status!==0||!result?.checks||required.some(k=>result.checks[k]!==true)||Object.keys(result.checks).length!==required.length)throw Error('Protected checkpoint reopen failed.');
   passed=true;process.stdout.write(JSON.stringify({status:'passed',checks:{abruptFixtureExit:true,...result.checks},scope},null,2)+'\n');
  }catch{process.stdout.write(JSON.stringify({status:'failed',error:'Windows protected fixture failed. Existing app profiles were not opened.',stage,diagnostics,fixtureRetained:!!root,scope})+'\n');process.exitCode=1;}
  finally{if(passed&&root)fs.rmSync(root,{recursive:true});}
 }
}
