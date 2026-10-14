'use strict';
// Fresh native ACP decisions reuse Orbit's human permission UI and durable job record.
const path=require('path'),crypto=require('crypto'),{digest}=require('./native-provider');
function create({home,job,run,runs,signal,askNative,decide,allowShell=false}){
 const seen=new Set();let session=null;
 const current=()=>{runs.assert(run);signal.throwIfAborted();const j=home.findJob(job.id);if(!j||j.agent!==job.agent||j.runId!==run.runId||j.status!=='running')throw Error('Native permission run expired.');return j;};
 async function answer(input){
  current();if(!session)throw Error('Native session not acknowledged.');if(!input||Buffer.byteLength(JSON.stringify(input))>32768)throw Error('Native permission bound.');
  const p=structuredClone(input),call=p.toolCall,options=p.options;
  if(typeof p.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(p.sessionId)||session&&session!==p.sessionId||typeof call?.toolCallId!=='string'||!call.toolCallId||call.toolCallId.length>256||!Array.isArray(options)||options.length>8)throw Error('Invalid native permission identity.');
  const id=p.sessionId+'/'+call.toolCallId;
  if(seen.has(id)||seen.size>=500)throw Error('Duplicate or excessive native permission.');seen.add(id);
  const once=options.filter(o=>o?.kind==='allow_once'&&typeof o.optionId==='string'&&o.optionId.length>0&&o.optionId.length<=128);
  if(once.length!==1||new Set(options.map(o=>o?.optionId)).size!==options.length)return null;
  const args=call.rawInput;if(!args||typeof args!=='object'||Array.isArray(args))return null;
  let supported=false,tool='native_acp/'+call.kind;
  if(call.kind==='execute'){
   const command=args.command||args.cmd;
   supported=allowShell&&!job.reviewTarget&&[args.cwd,args.workdir].filter(x=>x!==undefined).every(x=>typeof x==='string'&&(x==='/workspace'||x.startsWith('/workspace/'))&&path.posix.normalize(x)===x)&&typeof command==='string'&&command.length<=8192&&!!command&&!!decide&&decide('run_shell',{command},job.agent).level!=='deny';
  }else if(['read','edit'].includes(call.kind)){
   const locations=call.locations,paths=[args.filePath,args.filepath,args.path,...(Array.isArray(locations)?locations.map(x=>x?.path):[])].filter(x=>x!==undefined);
   supported=paths.length>0&&paths.length<=20&&paths.every(x=>typeof x==='string'&&x.startsWith('/workspace/')&&path.posix.normalize(x)===x&&!x.split('/').some(s=>s==='.git'||require('./fsmcp').SECRET_NAME.test(s)||require('./fsmcp').SECRET_DIR.test(s)))&&!(job.reviewTarget&&call.kind!=='read');
  }
  let receipt;const approvalSignal=AbortSignal.any([signal,AbortSignal.timeout(110000)]);const answer=supported&&askNative?await runs.within(run,()=>askNative({actor:job.agent,actorName:job.agent,tool,title:'Approve this native OpenCode action',detail:require('./audit').redact(JSON.stringify({sessionId:p.sessionId,callId:call.toolCallId,kind:call.kind,arguments:args})),allowSession:false,signal:approvalSignal,onDecision:r=>{receipt=r;}})):'deny';
  approvalSignal.throwIfAborted();const j=current(),allowed=answer==='once'&&receipt?.origin==='human_main_window'&&typeof receipt.id==='string'&&receipt.id.length>0;
  if((j.jobDecisions||[]).length>=500)throw Error('Native decision history bound.');
  const record={origin:receipt?.origin||'host_policy_denial',receiptId:receipt?.id||crypto.randomUUID(),jobId:job.id,runId:run.runId,sessionId:p.sessionId,tool,callId:call.toolCallId,argumentsSha256:digest(args),decision:allowed?'once':'deny',at:new Date().toISOString(),historicalOnly:true};
  home.updateJob(job.agent,job.id,{jobDecisions:[...(j.jobDecisions||[]),record]},{expectedStatus:'running',expectedRunId:run.runId,event:'native_acp_permission'});
  current();return allowed?once[0].optionId:null;
 }
 return {answer,bindSession(id){current();if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(id)||session&&session!==id)throw Error('Native session binding changed.');session=id;}};
}
module.exports={create};
