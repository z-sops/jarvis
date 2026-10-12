'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events'),{PassThrough}=require('stream'),cp=require('child_process');
const {AcpClient,acpEvent}=require('../lib/native-container-runner');
function rig(t,handler,options={}){
 const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.killed=false;p.kill=()=>{p.killed=true;return true;};
 const sent=[],client=new AcpClient(p,{timeoutMs:200,...options});t.after(()=>client.dispose());let buf='';
 const emit=m=>p.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
 p.stdin.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);sent.push(m);if(handler)handler(m,emit,p);}});
 return {p,client,sent,emit};
}
function peer(m,emit){if(m.method==='initialize')emit({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});else if(m.method==='session/new'){emit({method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'available_commands_update',availableCommands:[]}}});emit({id:m.id,result:{sessionId:'s1'}});}else if(['session/set_model','session/load'].includes(m.method))emit({id:m.id,result:{}});else if(m.method==='session/prompt'){emit({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Result'}}}});emit({id:m.id,result:{stopReason:'end_turn'}});}}
test('ACP initializes scoped native session and pins model before prompt without host capabilities',async t=>{
 let acknowledged;const updates=[],r=rig(t,peer,{onSession:id=>{acknowledged=id;},onUpdate:u=>updates.push(u)});
 assert.equal(await r.client.open({model:'custom/fixture'}),'s1');assert.equal(acknowledged,'s1');assert.equal((await r.client.prompt('Goal')).stopReason,'end_turn');
 assert.deepEqual(r.sent.filter(m=>m.method).map(m=>m.method),['initialize','session/new','session/set_model','session/prompt']);
 assert.deepEqual(r.sent[0].params.clientCapabilities,{fs:{readTextFile:false,writeTextFile:false},terminal:false});
 assert.deepEqual(r.sent[1].params,{cwd:'/workspace',mcpServers:[]});assert.equal(r.sent[2].params.modelId,'custom/fixture');assert.equal(updates.length,1);
});
test('original session load suppresses historical text/tools, retains native identity, never creates a new session',async t=>{
 const updates=[],r=rig(t,(m,emit)=>{if(m.method==='session/load'){
  emit({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OLD'}}}});
  emit({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'tool_call',toolCallId:'old',status:'completed'}}});
  emit({id:m.id,result:{}});
 }else peer(m,emit);},{onUpdate:u=>updates.push(u)});
 await r.client.open({model:'custom/fixture',sessionId:'original'});assert.deepEqual(updates,[]);await r.client.prompt('Resume');assert.equal(updates.length,1);assert.ok(!r.sent.some(m=>m.method==='session/new'));assert.equal(r.client.sessionId,'original');
});
test('unsupported loading or failed load refuses before prompt and never falls back',async t=>{
 for(const unsupported of [true,false]){
  const r=rig(t,(m,emit)=>{if(m.method==='initialize')emit({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:!unsupported}}});else if(m.method==='session/load')emit({id:m.id,error:{code:-32000,message:'PRIVATE_ERROR'}});else peer(m,emit);});
  await assert.rejects(r.client.open({model:'custom/fixture',sessionId:'original'}),/unavailable|rejected/);assert.ok(!r.sent.some(m=>['session/new','session/prompt'].includes(m.method)));
 }
});
test('unknown protocol or failed model selection refuses generation',async t=>{
 for(const version of [2,1]){const r=rig(t,(m,emit)=>{if(m.method==='initialize')emit({id:m.id,result:{protocolVersion:version}});else if(m.method==='session/set_model')emit({id:m.id,error:{code:-32000,message:'SECRET_MODEL'}});else peer(m,emit);});await assert.rejects(r.client.open({model:'custom/fixture'}),/protocol|rejected/);assert.ok(!r.sent.some(m=>m.method==='session/prompt'));}
});
test('unexpected permission request is cancelled without approval and prompt fails',async t=>{
 const r=rig(t,(m,emit)=>{if(m.method==='session/prompt')emit({id:'peer-permission',method:'session/request_permission',params:{sessionId:'s1',toolCall:{toolCallId:'shell'},options:[{optionId:'yes',kind:'allow_always'}]}});else peer(m,emit);});await r.client.open({model:'custom/fixture'});await assert.rejects(r.client.prompt('Goal'),/permission/);assert.deepEqual(r.sent.find(m=>m.id==='peer-permission').result,{outcome:{outcome:'cancelled'}});assert.equal(r.p.killed,true);
});
test('host filesystem and terminal requests receive method-not-found, not execution',async t=>{
 const r=rig(t,peer);await r.client.open({model:'custom/fixture'});
 for(const method of ['fs/read_text_file','fs/write_text_file','terminal/create','authenticate']){r.emit({id:method,method,params:{sessionId:'s1',path:'/host/secrets'}});const reply=r.sent.find(m=>m.id===method);assert.equal(reply.error.code,-32601);assert.ok(!reply.result);}
});
test('foreign update cannot change another worker or disclose text',async t=>{
 let called=false;const r=rig(t,(m,emit)=>{if(m.method==='session/prompt')emit({method:'session/update',params:{sessionId:'foreign',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'SECRET'}}}});else peer(m,emit);},{onUpdate:()=>called=true});await r.client.open({model:'custom/fixture'});await assert.rejects(r.client.prompt('Goal'),/stream/);assert.equal(called,false);assert.equal(r.p.killed,true);
});
test('split UTF-8 and JSON frames preserve rendered text without logging protocol bodies',async t=>{
 const texts=[],r=rig(t,null,{onUpdate:u=>texts.push(u.content.text)});r.client.sessionId='s1';r.client.active=true;
 const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'café ✓'}}}})+'\n');const i=b.indexOf(Buffer.from('é'))+1;r.p.stdout.write(b.subarray(0,i));r.p.stdout.write(b.subarray(i));assert.deepEqual(texts,['café ✓']);
});
test('stream corruption, oversized buffers and duplicate response stop ACP',async t=>{
 for(const input of ['garbage\n','x'.repeat(2*1024*1024+1),JSON.stringify({jsonrpc:'2.0',id:991,result:{}})+'\n']){const r=rig(t,null);const pending=r.client.request('initialize',{});r.p.stdout.write(input);await assert.rejects(pending,/stream/);assert.equal(r.p.killed,true);}
});
test('deadline rejects all pending work and never resubmits',async t=>{
 const r=rig(t,null,{timeoutMs:15});const a=r.client.request('initialize',{}),b=r.client.request('other',{});const results=await Promise.allSettled([a,b]);assert.ok(results.every(x=>x.status==='rejected'));assert.equal(r.sent.length,2);assert.equal(r.p.killed,true);assert.equal(r.client.pending.size,0);
});
test('cancellation sends owning session notification and cannot return a successful turn',async t=>{
 const r=rig(t,(m,e)=>{if(m.method!=='session/prompt')peer(m,e);});await r.client.open({model:'custom/fixture'});const task=r.client.prompt('Goal');r.client.cancel();await assert.rejects(task,/cancelled/);assert.deepEqual(r.sent.at(-1),{jsonrpc:'2.0',method:'session/cancel',params:{sessionId:'s1'}});assert.equal(r.client.pending.size,0);
});
test('concurrent prompts refuse; partial stop reasons are not accepted as completion',async t=>{
 for(const reason of ['cancelled','max_tokens','max_turn_requests','refusal','NEW_REASON']){const r=rig(t,(m,e)=>{if(m.method==='session/prompt')e({id:m.id,result:{stopReason:reason}});else peer(m,e);});await r.client.open({model:'custom/fixture'});await assert.rejects(r.client.prompt('Goal'),/did not complete/);}
 const r=rig(t,(m,e)=>{if(m.method!=='session/prompt')peer(m,e);});await r.client.open({model:'custom/fixture'});const task=r.client.prompt('Goal');await assert.rejects(r.client.prompt('duplicate'),/not ready/);r.client.cancel();await assert.rejects(task);
});
test('reported tool metadata is informational and raw arguments/results never forwarded',()=>{
 const e=acpEvent({sessionUpdate:'tool_call',toolCallId:'t1',name:'SECRET',title:'SECRET',status:'completed',rawInput:{secret:'SECRET'},rawOutput:'SECRET'});assert.equal(e.part.state.status,'completed');assert.ok(!JSON.stringify(e).includes('SECRET'));assert.equal(acpEvent({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'PRIVATE'}}),null);assert.equal(acpEvent({sessionUpdate:'plan',entries:[{content:'CLAIM'}]}).type,'step_start');
 const c=require('../lib/ocevents').makeCollector();for(const text of ['Build ','ready'])c.push(JSON.stringify(acpEvent({sessionUpdate:'agent_message_chunk',content:{type:'text',text}}))+'\n');assert.equal(c.text(),'Build ready');
});
test('two workers can share a provider while ACP identities, messages and cancellation stay separate',async t=>{
 const a=rig(t,peer),b=rig(t,peer);await Promise.all([a.client.open({model:'custom/shared'}),b.client.open({model:'custom/shared'})]);a.client.cancel();assert.equal(b.client.closed,false);assert.equal((await b.client.prompt('Other goal')).stopReason,'end_turn');assert.equal(b.sent.filter(m=>m.method==='session/prompt').length,1);
});
test('real disposable ACP subprocess negotiates and streams; process death rejects in-flight prompt',async t=>{
 const source=`let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,i));b=b.slice(i+1);const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});if(m.method==='session/new')send({id:m.id,result:{sessionId:'child-session'}});if(m.method==='session/set_model')send({id:m.id,result:{}});if(m.method==='session/prompt'){if(m.params.prompt[0].text==='Crash')process.exit(9);else{send({method:'session/update',params:{sessionId:'child-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'CHILD_RESULT'}}}});send({id:m.id,result:{stopReason:'end_turn'}});}}}});`;
 const p=cp.spawn(process.execPath,['-e',source],{stdio:['pipe','pipe','pipe'],env:{}}),updates=[],client=new AcpClient(p,{timeoutMs:2000,onUpdate:u=>updates.push(u)});t.after(()=>client.dispose());await client.open({model:'custom/fixture'});await client.prompt('Goal');assert.equal(updates[0].content.text,'CHILD_RESULT');await assert.rejects(client.prompt('Crash'),/exited/);
});

test('post-response updates cannot become new output or successful completion after invalid frames',async t=>{
 const output=[],r=rig(t,(m,e)=>{if(m.method==='session/prompt'){
  e({id:m.id,result:{stopReason:'end_turn'}});
  e({method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'LATE'}}}});
 }else peer(m,e);},{onUpdate:u=>output.push(u)});
 await r.client.open({model:'custom/fixture'});await r.client.prompt('Goal');assert.deepEqual(output,[]);
 const broken=rig(t,(m,e)=>{if(m.method==='session/prompt'){e({id:m.id,result:{stopReason:'end_turn'}});e({id:999,result:{}});}else peer(m,e);});
 await broken.client.open({model:'custom/fixture'});await assert.rejects(broken.client.prompt('Goal'),/failed before/);
});
