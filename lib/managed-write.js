'use strict';
// Guard Orbit-owned write paths. No global fs monkeypatch; external processes/OS/Docker are outside scope.
const fs=require('fs'),path=require('path'),roots=new Map();
function register(home,getCfg,{sample=()=>require('./storage-guardian').measure(home.root)}={}){const root=path.resolve(home.root);if(roots.has(root))throw Error('Managed write root already registered.');roots.set(root,{getCfg,sample,pending:0});return ()=>roots.delete(root);}
function check(file,bytes,{recovery=false}={}){
 if(typeof file!=='string'&&!Buffer.isBuffer(file))return null;file=path.resolve(String(file));const entry=[...roots].filter(([root])=>file.startsWith(root+path.sep)||file===root).sort((a,b)=>b[0].length-a[0].length)[0];if(!entry)return null;
 const [root,r]=entry,cfg=r.getCfg();if(cfg.storageQuotaMiB===undefined)return null;
 if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('Managed write size is unknown.');
 for(let p=file;p.startsWith(root+path.sep)||p===root;p=path.dirname(p)){try{if(fs.lstatSync(p).isSymbolicLink())throw Error('Managed storage path cannot contain links.');}catch(e){if(e.code!=='ENOENT')throw e;}if(p===root)break;}
 const p=require('./storage-admission').policy(cfg),s=r.sample();if(!s.coverage.complete||!Number.isSafeInteger(s.freeBytes)||!Number.isSafeInteger(s.logicalBytes))throw Error('Managed storage coverage is unknown; write refused.');
 const headroom=(recovery?Math.min(p.reserve,32):p.reserve)*1024*1024,peak=bytes+r.pending;
 if(s.logicalBytes+peak+headroom>p.quota*1024*1024||s.freeBytes<peak+headroom)throw Error('Managed write would exceed storage quota or protected recovery headroom. Original file retained.');
 return r;
}
const size=(data,options)=>Buffer.isBuffer(data)||ArrayBuffer.isView(data)?data.byteLength:Buffer.byteLength(String(data),typeof options==='string'?options:options?.encoding||'utf8');
function writeFileSync(file,data,options){check(file,size(data,options));return fs.writeFileSync(file,data,options);}
function appendFileSync(file,data,options){check(file,size(data,options));return fs.appendFileSync(file,data,options);}
function copyFileSync(source,dest,flags){check(dest,fs.statSync(source).size);return fs.copyFileSync(source,dest,flags);}
async function writeFile(file,data,options){const bytes=size(data,options),r=check(file,bytes);if(r)r.pending+=bytes;try{return await fs.promises.writeFile(file,data,options);}finally{if(r)r.pending-=bytes;}}
async function copyFile(source,dest,flags){const bytes=fs.statSync(source).size,r=check(dest,bytes);if(r)r.pending+=bytes;try{return await fs.promises.copyFile(source,dest,flags);}finally{if(r)r.pending-=bytes;}}
module.exports={register,check,writeFileSync,appendFileSync,copyFileSync,writeFile,copyFile};
