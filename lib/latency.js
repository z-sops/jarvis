'use strict';
// Observational only: monotonic intervals, no prompts, credentials, tool arguments or policies.
const {AsyncLocalStorage}=require('async_hooks'),{performance}=require('perf_hooks'),crypto=require('crypto');
const scope=new AsyncLocalStorage(),recent=[];
const MARKS=new Set(['worker_started','engine_submit','startup_ready','first_action','first_tool_progress','first_text','response_ready','report_ready','settled']);
const SPANS=new Set(['decision','worker_prepare','container_create','native_startup','model_request','token_count','tool','approval_wait','checkpoint','private_restore','model_relay','gateway_relay','retry_wait']);
const safe=f=>{try{return f();}catch{return undefined;}};
function union(intervals){const sorted=intervals.slice().sort((a,b)=>a[0]-b[0]);let total=0,end=-Infinity;for(const [a,b]of sorted){if(b>end){total+=b-Math.max(a,end);end=b;}}return total;}
function create(kind,{now=()=>performance.now(),parentId=null,engine='unknown'}={}){
 if(!['commander','worker','native_fixture','native_resume_fixture'].includes(kind))throw Error('Unsupported latency class.');
 if(!['builtin','hermes','opencode','unknown'].includes(engine))engine='unknown';
 const started=now(),id=crypto.randomUUID(),marks={},intervals=[],pending=new Set();let closed=false,dropped=0,last=0;
 const stamp=()=>{const n=now()-started;if(Number.isFinite(n))last=Math.max(last,n,0);return last;};
 const trace={id,kind,parentId,engine,
  mark(name){safe(()=>{if(!closed&&MARKS.has(name)&&marks[name]===undefined)marks[name]=stamp();});},
  span(name){if(closed||!SPANS.has(name))return ()=>{};if(pending.size+intervals.length>=512){dropped++;return ()=>{};}const from=stamp(),entry={};pending.add(entry);let ended=false;
   return ()=>safe(()=>{if(ended||closed)return;ended=true;pending.delete(entry);const end=Math.max(from,stamp());if(intervals.length<512)intervals.push({name,from,to:end});else dropped++;});},
  finish(outcome='success'){if(closed)return trace.result;const elapsedMs=stamp();closed=true;const groups={};for(const s of intervals)(groups[s.name]||=[]).push([s.from,s.to]);
   const spans=Object.fromEntries(Object.entries(groups).map(([name,items])=>[name,{count:items.length,sumMs:items.reduce((n,[a,b])=>n+b-a,0),unionMs:union(items)}]));
   const accounted=union(intervals.map(s=>[s.from,s.to]));
   trace.result={version:1,id,kind,engine,...(parentId?{parentId}:{}),outcome:['success','failed','cancelled'].includes(outcome)?outcome:'failed',elapsedMs,marks:{...marks},spans,coverage:{complete:!dropped&&!pending.size,droppedSpans:dropped,unfinishedSpans:pending.size},unattributedElapsedMs:Math.max(0,elapsedMs-accounted),scope:'Host monotonic observations; overlapping spans are not additive. Unattributed time is NOT pure orchestration overhead. Response ready is not renderer receipt, first token, acknowledgement or accepted project completion.'};
   recent.push(trace.result);if(recent.length>500)recent.shift();return trace.result;
  }};return trace;
}
function current(){return scope.getStore();}
function within(trace,fn){return scope.run(trace,fn);}
function mark(name){safe(()=>current()?.mark(name));}
function span(name){return safe(()=>current()?.span(name))||(()=>{});}
function timed(name,fn){const end=span(name);try{const value=fn();if(value&&typeof value.then==='function')return Promise.resolve(value).finally(end);end();return value;}catch(e){end();throw e;}}
function percentile(values){const v=values.filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);return {samples:v.length,p50:v.length?v[Math.ceil(v.length*.5)-1]:null,p95:v.length?v[Math.ceil(v.length*.95)-1]:null,max:v.length?v.at(-1):null};}
function summarize(records=recent){const groups={};for(const r of records){if(r?.version!==1||!['commander','worker','native_fixture','native_resume_fixture'].includes(r.kind)||!['success','failed','cancelled'].includes(r.outcome))continue;const key=r.kind+'/'+(['builtin','hermes','opencode','unknown'].includes(r.engine)?r.engine:'unknown')+'/'+r.outcome+'/'+(r.spans?.model_request?.count?'provider_observed':'no_provider_span'),g=groups[key]||=( {records:[],metrics:{}} );g.records.push(r);const add=(k,v)=>{if(Number.isFinite(v)&&v>=0)(g.metrics[k]||=[]).push(v);};add('elapsedMs',r.elapsedMs);for(const [k,v]of Object.entries(r.marks||{}))if(MARKS.has(k))add(k+'Ms',v);for(const [k,v]of Object.entries(r.renderer||{}))if(['feedbackMs','replyDomMs'].includes(k))add('renderer_'+k,v);for(const [k,v]of Object.entries(r.spans||{}))if(r.coverage?.complete&&SPANS.has(k)&&(k!=='native_startup'||r.marks?.startup_ready!==undefined))add(k+'UnionMs',v.unionMs);}
 return {version:1,groups:Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,{traces:g.records.length,incomplete:g.records.filter(r=>!r.coverage?.complete).length,metrics:Object.fromEntries(Object.entries(g.metrics).map(([k,v])=>[k,percentile(v)]))}])),windowLimit:records===recent?500:null,unmeasured:['semantic_first_acknowledgement','semantic_first_useful_response','warm_native_worker','human_acceptance_end_to_end','NeuralOps_remote_handoff'],scope:'Nearest-rank percentiles by trace class/outcome; missing metrics are absent, never zero. In-memory window is lost on restart. Worker summaries can persist in existing jobs.'};
}
function rendered(id,metrics){const r=recent.find(r=>r.id===id&&r.kind==='commander');if(!r||r.renderer||!metrics||Object.keys(metrics).some(k=>!['feedbackMs','replyDomMs'].includes(k))||!['feedbackMs','replyDomMs'].every(k=>Number.isFinite(metrics[k])&&metrics[k]>=0&&metrics[k]<=86400000)||metrics.feedbackMs>metrics.replyDomMs)return false;r.renderer={feedbackMs:metrics.feedbackMs,replyDomMs:metrics.replyDomMs};return true;}
module.exports={create,current,within,mark,span,timed,percentile,summarize,rendered};
