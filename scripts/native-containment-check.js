'use strict';
// Real kernel boundary check on an already installed image; no CLI/model call or image pull.
const C=require('../lib/native-containment'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),net=require('net');
async function main(){
  const image=process.argv[2],root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-os-check-')),input=path.join(root,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(root,'host-canary.txt'),'synthetic host canary');fs.writeFileSync(path.join(input,'visible.txt'),'synthetic job input');
  const listener=net.createServer(s=>s.end('host canary'));await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const state={name:'orbit-native-'+crypto.randomUUID(),image,root:input,memoryMB:3072,cpu:2};let created=false;
  try{
    const args=C.options(state);args.push('--isolation-check',path.join(root,'host-canary.txt'),String(listener.address().port));
    const ready=await C.docker(['info','--format','{{.OSType}}']);if(ready.code||ready.stdout.trim()!=='linux')throw Error('Local Docker Linux engine is unavailable.');
    const result=await C.docker(args);if(result.code)throw Error('Image/create unavailable. No image was pulled.');created=true;
    const inspected=await C.docker(['inspect',state.name]);if(inspected.code)throw Error('Inspection failed.');C.verify(JSON.parse(inspected.stdout)[0],state);
    const ran=await C.docker(['start','-a',state.name],30000);let report;for(const line of ran.stdout.trim().split('\n')){try{const j=JSON.parse(line);if(j.type==='isolation')report=j;}catch{}}
    if(ran.code||!report||!Object.values(report.checks).every(Boolean))throw Error('Isolation check failed: '+JSON.stringify(report?.checks||{}));
    console.log(JSON.stringify({status:'passed',checks:report.checks,scope:'Real Docker kernel/filesystem/network boundary; no live native CLI/provider proof'},null,2));
  }finally{try{if(created)await C.stopOwned(C.docker,state);}finally{listener.close();fs.rmSync(root,{recursive:true,force:true});}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
