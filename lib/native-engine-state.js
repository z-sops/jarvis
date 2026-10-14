'use strict';
// Protected payload belongs to the existing workspace checkpoint, never a second replay store.
const crypto=require('crypto');
const LIMIT=8*1024*1024, hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const paths={hermes:['hermes/state.db','hermes/memories/MEMORY.md','hermes/memories/USER.md'],opencode:['data/opencode/opencode.db']};
function validate(bundle, engine, manifestOnly=false) {
  if(!bundle||bundle.version!==1||bundle.adapter!==1||bundle.engine!==engine||!paths[engine]||!Array.isArray(bundle.files)||bundle.files.length>paths[engine].length||!Number.isSafeInteger(bundle.pendingEffects)||bundle.pendingEffects<0||!Number.isSafeInteger(bundle.retiredQueueRows)||bundle.retiredQueueRows<0||bundle.sessionId!==null&&!/^[a-zA-Z0-9_-]{1,256}$/.test(bundle.sessionId||''))throw Error('Invalid bounded private engine state.');
  let total=0;const seen=new Set();
  for(const f of bundle.files){
    if(!f||!paths[engine].includes(f.path)||seen.has(f.path)||!manifestOnly&&(typeof f.data!=='string'||f.data.length>12*1024*1024)||!Number.isSafeInteger(f.bytes)||f.bytes<0||(total+=f.bytes)>LIMIT||typeof f.sha256!=='string'||! /^[a-f0-9]{64}$/.test(f.sha256))throw Error('Unsafe private engine state file.');
    if(!manifestOnly){const bytes=Buffer.from(f.data,'base64');if(bytes.length!==f.bytes||bytes.toString('base64')!==f.data||crypto.createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Private engine state integrity changed.');}seen.add(f.path);
  }
  if(bundle.sessionId&&!seen.has(engine==='hermes'?'hermes/state.db':'data/opencode/opencode.db'))throw Error('Native session lacks its database.');
  if(bundle.portable!==undefined){const p=bundle.portable,ids=new Set();if(p.version!==1||typeof p.supported!=='boolean'||p.scope!=='data_only_not_permissions_plugins_or_pending_actions'||!Array.isArray(p.todos)||p.todos.length>256||!p.supported&&p.todos.length)throw Error('Invalid portable native TODO view.');for(const t of p.todos){if(!t||Object.keys(t).some(k=>!['id','content','status'].includes(k))||typeof t.id!=='string'||!t.id||t.id.length>256||ids.has(t.id)||typeof t.content!=='string'||!t.content.trim()||t.content.length>4000||!['pending','in_progress','completed','cancelled'].includes(t.status))throw Error('Invalid portable TODO item.');ids.add(t.id);}}
  return bundle;
}
function seal(home,bundle,binding){
  validate(bundle,binding.engine);if(!home.secretStorage?.available())throw Error('Private engine checkpoints require unlocked protected storage.');
  const envelope={version:1,binding,bundle};return {protected:home.secretStorage.seal(envelope),summary:{engine:binding.engine,adapter:1,sessionPresent:!!bundle.sessionId,files:bundle.files.length,pendingEffects:bundle.pendingEffects,retiredQueueRows:bundle.retiredQueueRows,sha256:hash(envelope)}};
}
function open(home,data,expected){
  if(!data?.protected||!home.secretStorage?.available())throw Error('Private engine checkpoint storage is locked or missing.');
  const e=home.secretStorage.open(data.protected);if(e.version!==1||hash(e)!==data.summary?.sha256||JSON.stringify(e.binding)!==JSON.stringify(expected))throw Error('Private engine checkpoint ownership/image/provider binding changed.');
  validate(e.bundle,expected.engine);if(e.bundle.pendingEffects)throw Error('Private engine state has unresolved native effects. Inspect before continuing.');return e.bundle;
}
function publicSummary(s){
  if(!s||!paths[s.engine]||typeof s.sessionPresent!=='boolean'||!Number.isSafeInteger(s.pendingEffects)||s.pendingEffects<0||!Number.isSafeInteger(s.retiredQueueRows)||s.retiredQueueRows<0)return null;
  return {engine:s.engine,sessionPresent:s.sessionPresent,pendingEffects:s.pendingEffects,retiredQueueRows:s.retiredQueueRows};
}
module.exports={validate,seal,open,hash,LIMIT,publicSummary};
