'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {Connectors}=require('../lib/connectors'),{Gateway}=require('../lib/gateway');
test('trusted token replacement persists encrypted fixture credentials and fresh SDK verification uses broker after reopen',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-token-save-')),key=crypto.randomBytes(32);
  const old='nops_disposable_old_token',next='nops_disposable_broker_token',calls=[];
  // Actual cipher/disk round trip, NOT Windows safeStorage/key lifecycle proof.
  const protection={available:()=>true,seal(value){
    const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
    const ciphertext=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);
    return {orbitSecretVersion:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  },open(value){
    const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));
    d.setAuthTag(Buffer.from(value.tag,'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(value.ciphertext,'base64')),d.final()]).toString());
  }};
  const server=http.createServer((req,res)=>{
    if(req.method!=='POST'){res.writeHead(405);return res.end();}
    let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{
      const m=JSON.parse(raw),token=req.headers.authorization;
      if(![old,next].some(t=>token==='Bearer '+t)){res.writeHead(401);return res.end();}
      if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}
      let result;
      if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
      else if(m.method==='tools/list')result={tools:[{name:'neuralops_whoami',inputSchema:{type:'object'}}]};
      else if(m.method==='tools/call'){
        const actor=req.headers['x-agent-id'];calls.push({broker:token==='Bearer '+next,actor:actor||null});
        const agent={id:actor||(token==='Bearer '+next?'agent.orbit-broker':'agent.orbit'),workspaceId:'fixture',revokedAt:null,
          ...(actor?{delegate:'agent.orbit-broker'}:token==='Bearer '+next?{access:'broker'}:{})};
        result={content:[{type:'text',text:JSON.stringify({agent,via:actor?'delegated':'token'})}]};
      }else{res.writeHead(400);return res.end();}
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const home={root,p:(...parts)=>path.join(root,...parts)},c=new Connectors({home,allowInsecureLocal:true,secretStorage:protection});
  c.save([{id:'neuralops',catalogId:'neuralops',name:'NeuralOps',url:'http://127.0.0.1:'+server.address().port+'/mcp',
    enabled:true,agents:'all',mode:'read-only',options:{},tools:['neuralops_whoami'],levels:{neuralops_whoami:'free'},
    neuralopsIdentities:{commander:'agent.laila',alex:'agent.alex',bob:'agent.bob'}}]);
  c.setToken('neuralops',old);
  const gw=new Gateway({connectors:c}),handlers={},sender={};
  require('../lib/connectors-panel').register({ipcMain:{handle:(n,f)=>handlers[n]=f},connectors:c,gateway:gw,store:{},
    bus:{on(){},emit(){}},win:()=>({webContents:sender}),workerIds:()=>['alex','bob']});
  try{
    const before=await handlers['connectors:verifyIdentities']({sender},'neuralops');
    assert.equal(before.verification.broker.id,'agent.orbit');assert.equal(before.verification.allPassed,false);
    await gw.test('neuralops');
    assert.equal((await handlers['connectors:token']({sender:{}},'neuralops',next)).ok,false);
    assert.equal(c.token('neuralops'),old);
    const saved=await handlers['connectors:token']({sender},'neuralops',next);
    assert.equal(saved.ok,true);assert.equal(saved.test.ok,true);assert.equal(c.token('neuralops'),next);
    const disk=fs.readFileSync(c.secretFile,'utf8');assert.ok(!disk.includes(old)&&!disk.includes(next));
    const reopened=new Connectors({home,allowInsecureLocal:true,secretStorage:protection});assert.equal(reopened.token('neuralops'),next);
    const after=await require('../lib/neuralops-identity').verifyIdentities(reopened,'neuralops',['alex','bob']);
    assert.equal(after.allPassed,true);assert.equal(after.broker.id,'agent.orbit-broker');
    assert.ok(calls.slice(1).every(x=>x.broker));assert.ok(!JSON.stringify(saved).includes(next));
  }finally{await gw.closeAll();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
