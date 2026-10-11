'use strict';
// Explicit owner-run read-only sampling. Redirect stdout to retain before/after samples.
const {measure}=require('../lib/storage-guardian');
const cp=require('child_process');
async function main(args) {
  if (!args.length || args.some(a=>a.startsWith('--')&&!['--docker'].includes(a))) throw Error('Usage: node scripts/storage-check.js <Orbit home> [--docker]');
  if (args.filter(a=>a!=='--docker').length!==1) throw Error('Expected one storage root.');
  const sample=measure(args.find(a=>a!=='--docker'));
  sample.docker={status:'not_measured',scope:'Daemon-wide shared storage, not per-worker attribution; no prune/pull/build.'};
  if(args.includes('--docker')) {
    const endpoint=process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';
    const result=await new Promise(resolve=>cp.execFile('docker',['--host',endpoint,'system','df','--format','{{json .}}'],{timeout:10000,maxBuffer:65536,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}},(error,stdout)=>resolve({error,stdout})));
    if(result.error)sample.docker.status='unavailable';
    else { try {const rows=result.stdout.trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)); sample.docker.rows=rows.map(r=>({type:['Images','Containers','Local Volumes','Build Cache'].includes(r.Type)?r.Type:'other',size:/^[0-9.]+\s*[a-zA-Z]+$/.test(r.Size||'')?r.Size:null,total: /^\d+$/.test(String(r.TotalCount))?Number(r.TotalCount):null}));sample.docker.status='measured';} catch {sample.docker.status='invalid_response';} }
  }
  console.log(JSON.stringify(sample,null,2));
  if(!sample.coverage.complete)process.exitCode=2;
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.log(JSON.stringify({status:'failed',error:'Storage sample could not be completed. No cleanup performed.'}));process.exitCode=1;});
module.exports={main};
