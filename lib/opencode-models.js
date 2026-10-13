'use strict';
// Read-only catalogue for the existing worker settings. Selection never starts a task.
const crypto=require('crypto'),registry=require('./provider-registry');
async function list({home,getCfg,actor,fetchImpl=global.fetch}){
 const snapshot=()=>{const cfg=getCfg(),a=home.getAgent(actor);if(!a||a.credentialStorageLocked)throw Error('Worker credentials are unavailable.');const provider=a.workerProvider||cfg.workerProvider;if(provider!=='opencode')throw Error('Select and save the OpenCode provider for this worker first.');const key=a.workerApiKey||cfg.workerApiKey;if(!key)throw Error('Save this worker’s OpenCode API key first.');return {key,provider};};
 const c=snapshot(),binding=crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
 const response=await fetchImpl(registry.get('opencode').catalog,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:registry.headers('opencode',c.key)});
 if(!response.ok)throw Error('OpenCode model catalogue refused (HTTP '+response.status+'). No model request was submitted.');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('Model catalogue exceeds its bound.');chunks.push(Buffer.from(chunk));}
 const data=JSON.parse(Buffer.concat(chunks)),rows=data.data;if(!Array.isArray(rows)||rows.length>2000)throw Error('Invalid bounded OpenCode model catalogue.');
 const models=[...new Set(rows.map(r=>r?.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9._-]{1,120}$/.test(id)))].sort();
 if(!models.length)throw Error('The catalogue returned no selectable model IDs.');
 if(crypto.createHash('sha256').update(JSON.stringify(snapshot())).digest('hex')!==binding)throw Error('Worker credentials/provider changed while loading models. Load again.');
 return {models,scope:'Catalogue availability only; access, pricing and API protocol are not verified. User selection is not an automatic fallback or task start.'};
}
module.exports={list};
