'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createSecretStorage } = require('../lib/secret-storage'), { createStore } = require('../lib/store'), { Connectors } = require('../lib/connectors');
function rig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-secrets-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32); let ready = true, backend = 'gnome_libsecret', fail = false;
  const provider = { isEncryptionAvailable: () => ready, getSelectedStorageBackend: () => backend,
    encryptString(s) { if (fail) throw new Error('CANARY_PROVIDER_ERROR'); const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv), body = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]); },
    decryptString(b) { if (fail) throw new Error('CANARY_PROVIDER_ERROR'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0,12)); d.setAuthTag(b.subarray(12,28)); return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString(); }
  };
  const storage = createSecretStorage(provider, 'linux'), file = path.join(root,'settings.json');
  return { root, file, storage, provider, ready: v => { ready=v; }, backend: v => { backend=v; }, fail: v => { fail=v; } };
}
test('settings protect all known keys and nested channel secrets, retaining nonsecret settings across restart', t => {
  const r = rig(t), store = createStore(r.file, { secretStorage:r.storage });
  store.set({ apiKey:'GEMINI_CANARY', workerApiKey:'WORKER_CANARY', userName:'Fixture', comms:{telegram:{enabled:true,token:'TG_CANARY',allowed:['123']}, email:{password:'MAIL_CANARY',address:'fixture@example.test'}} });
  const disk=fs.readFileSync(r.file,'utf8'); assert.doesNotMatch(disk,/GEMINI_CANARY|WORKER_CANARY|TG_CANARY|MAIL_CANARY/); assert.match(disk,/Fixture/);
  const read=createStore(r.file,{secretStorage:r.storage}).get(); assert.equal(read.apiKey,'GEMINI_CANARY'); assert.equal(read.workerApiKey,'WORKER_CANARY'); assert.equal(read.comms.email.password,'MAIL_CANARY'); assert.equal(read.comms.telegram.token,'TG_CANARY'); assert.deepEqual(read.comms.telegram.allowed,['123']);
  read.comms.telegram.allowed.push('MUTATION'); assert.deepEqual(store.get().comms.telegram.allowed,['123']);
});
test('legacy settings migrate only after the key store is ready; locked files cannot be overwritten', t => {
  const r=rig(t), legacy={apiKey:'LEGACY_CANARY',homeDir:r.root,comms:{email:{password:'LEGACY_EMAIL'}}}; fs.writeFileSync(r.file,JSON.stringify(legacy)); const original=fs.readFileSync(r.file,'utf8');
  r.ready(false); const store=createStore(r.file,{secretStorage:r.storage}); assert.equal(store.get().homeDir,r.root); assert.equal(store.get().apiKey,''); assert.throws(()=>store.protect(),/unavailable/); assert.throws(()=>store.set({userName:'Changed'}),/unavailable/); assert.equal(fs.readFileSync(r.file,'utf8'),original);
  r.ready(true); store.protect(); assert.doesNotMatch(fs.readFileSync(r.file,'utf8'),/LEGACY_CANARY|LEGACY_EMAIL/); assert.equal(store.get().apiKey,'LEGACY_CANARY');
  r.ready(false); const reopened=createStore(r.file,{secretStorage:r.storage}); const encrypted=fs.readFileSync(r.file,'utf8'); assert.equal(reopened.get().apiKey,''); assert.throws(()=>reopened.set({userName:'Lost'}),/locked/); assert.equal(fs.readFileSync(r.file,'utf8'),encrypted);
  r.ready(true); assert.equal(reopened.get().apiKey,'LEGACY_CANARY');
});
test('insecure Linux basic_text and unavailable providers refuse new secret writes without leaking provider errors', t => {
  const r=rig(t), store=createStore(r.file,{secretStorage:r.storage}); store.set({userName:'Fixture'}); const previous=fs.readFileSync(r.file,'utf8');
  for(const backend of ['basic_text','unknown']) { r.backend(backend); assert.equal(r.storage.available(),false); assert.throws(()=>store.set({apiKey:'NEW_CANARY'}),/Protected credential/); assert.equal(fs.readFileSync(r.file,'utf8'),previous); assert.equal(store.get().apiKey,''); }
  r.backend('gnome_libsecret'); r.fail(true); assert.throws(()=>store.set({apiKey:'NEW_CANARY'}), e=>!/CANARY/.test(e.message)); assert.equal(fs.readFileSync(r.file,'utf8'),previous);
});
test('connector tokens migrate, encrypt, rotate and delete without plaintext fallback', t => {
  const r=rig(t), home={p:(...a)=>path.join(r.root,...a)}, c=new Connectors({home,secretStorage:r.storage}); fs.mkdirSync(c.dir); fs.writeFileSync(c.secretFile,JSON.stringify({github:'LEGACY_TOKEN'}));
  c.protectSecrets(); assert.doesNotMatch(fs.readFileSync(c.secretFile,'utf8'),/LEGACY_TOKEN/); assert.equal(c.token('github'),'LEGACY_TOKEN');
  c.setToken('github','NEW_TOKEN'); assert.equal(c.token('github'),'NEW_TOKEN'); const original=fs.readFileSync(c.secretFile,'utf8'); r.ready(false); assert.throws(()=>c.setToken('github','LOST_TOKEN'),/unavailable/); assert.equal(fs.readFileSync(c.secretFile,'utf8'),original);
  r.ready(true); c.setToken('github',''); assert.equal(c.token('github'),''); assert.equal(fs.readFileSync(c.secretFile,'utf8').trim(),'{}');
});
test('corrupt credential files and wrong keys are preserved and cannot be silently replaced', t => {
  const r=rig(t); fs.writeFileSync(r.file,'{bad'); const store=createStore(r.file,{secretStorage:r.storage}); assert.throws(()=>store.set({userName:'Reset'}),/Repair/); assert.equal(fs.readFileSync(r.file,'utf8'),'{bad');
  const home={p:(...a)=>path.join(r.root,...a)}, c=new Connectors({home,secretStorage:r.storage}); fs.mkdirSync(c.dir); fs.writeFileSync(c.secretFile,'{bad'); assert.throws(()=>c.setToken('github','TOKEN'),/could not be read/); assert.equal(fs.readFileSync(c.secretFile,'utf8'),'{bad');
  const sealed=r.storage.seal({apiKey:'PRIVATE_CANARY'}); sealed.ciphertext=Buffer.alloc(35,1).toString('base64'); fs.writeFileSync(r.file,JSON.stringify({_orbitSecrets:sealed})); const original=fs.readFileSync(r.file,'utf8'); const wrong=createStore(r.file,{secretStorage:r.storage}); assert.equal(wrong.get().apiKey,''); assert.throws(()=>wrong.protect(),e=>!/PRIVATE_CANARY/.test(e.message)); assert.equal(fs.readFileSync(r.file,'utf8'),original);
});
test('failed atomic settings save leaves in-memory and on-disk configuration unchanged', t => {
  const r=rig(t), store=createStore(r.file,{secretStorage:r.storage}); store.set({userName:'Before',apiKey:'BEFORE_CANARY'}); const old=fs.readFileSync(r.file,'utf8'), persistence=require('../lib/job-storage'), atomic=persistence.atomicWrite;
  persistence.atomicWrite=()=>{throw new Error('disk write failed');}; t.after(()=>{persistence.atomicWrite=atomic;}); assert.throws(()=>store.set({userName:'After',apiKey:'AFTER_CANARY'}),/disk write failed/); assert.equal(store.get().userName,'Before'); assert.equal(store.get().apiKey,'BEFORE_CANARY'); assert.equal(fs.readFileSync(r.file,'utf8'),old);
});

test('per-worker override keys migrate and stay blocked while the OS key store is locked', async t => {
  const r=rig(t), {Home}=require('../lib/home'), {EventEmitter}=require('events');
  const home=new Home(path.join(r.root,'home'),{secretStorage:r.storage}).ensure(); home.createAgent({name:'Alex'});
  const agent=home.updateAgent('alex',{engine:'hermes',workerApiKey:'AGENT_CANARY'}), file=path.join(home.agentDir('alex'),'agent.json');
  assert.equal(agent.workerApiKey,'AGENT_CANARY'); assert.doesNotMatch(fs.readFileSync(file,'utf8'),/AGENT_CANARY/); assert.equal(home.getAgent('alex').workerApiKey,'AGENT_CANARY');
  fs.writeFileSync(file,JSON.stringify({...agent,workerApiKey:'LEGACY_AGENT'})); home.protectAgents(); assert.doesNotMatch(fs.readFileSync(file,'utf8'),/LEGACY_AGENT/); assert.equal(home.getAgent('alex').workerApiKey,'LEGACY_AGENT');
  r.ready(false); assert.equal(home.getAgent('alex').credentialStorageLocked,true); assert.throws(()=>home.updateAgent('alex',{workerModel:'changed'}),/locked/);
  const bus=new EventEmitter(); let calls=0; const workers=require('../lib/workers').createWorkers({home,bus,getCfg:()=>({engine:'hermes'}),tools:{},gemini:{},hermes:{runTask:async()=>{calls++;return 'Report';}}});t.after(()=>workers.cancelAll());
  const done=new Promise(resolve=>bus.once('job:done',resolve)), job=workers.dispatch('alex','Inspect');await done;assert.equal(calls,0);assert.equal(home.findJob(job.id).status,'failed');assert.match(home.findJob(job.id).error,/credential storage is locked/);
});

test('app-wide IPC origin guard protects credential reads, writes, tools and human approval answers', () => {
  const {installMainFrameGuard}=require('../lib/ipc-origin'), handlers=new Map(), ipcMain={handle:(name,handler)=>handlers.set(name,handler)};
  let window=null, effects=0;installMainFrameGuard(ipcMain,()=>window);
  for(const name of ['config:get','config:save','agents:inspect','comms:get','permission:answer','tool:exec'])ipcMain.handle(name,()=>{effects++;return 'SYNTHETIC_RESULT';});
  const contents={mainFrame:{},isDestroyed:()=>false};window={webContents:contents,isDestroyed:()=>false};
  const trusted={sender:contents,senderFrame:contents.mainFrame};
  for(const fn of handlers.values()) {
    for(const event of [{sender:{}}, {sender:contents,senderFrame:{}}, {sender:contents}, null])assert.throws(()=>fn(event),/main application frame/);
    assert.equal(fn(trusted),'SYNTHETIC_RESULT');
  }
  assert.equal(effects,6);window=null;assert.throws(()=>handlers.get('config:get')(trusted),/main application frame/);assert.equal(effects,6);
});

test('disabled empty channel settings remain saveable without an OS key provider', t => {
  const r=rig(t);r.backend('basic_text');const store=createStore(r.file,{secretStorage:r.storage});
  store.set({comms:{telegram:{enabled:false,token:''},email:{enabled:false,password:''}}});
  const saved=JSON.parse(fs.readFileSync(r.file,'utf8'));assert.equal(saved.comms.telegram.enabled,false);assert.equal(saved._orbitSecrets,undefined);assert.equal(store.get().apiKey,'');
});
