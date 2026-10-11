'use strict';
// Read actual existing jobs/runtime; desired lifecycle stays in agent.json.
function snapshot(home,workers,{now=Date.now(),staleMs=120000}={}){
 const rows=home.listAgents().map(a=>{
  const issues=[];let recordsHealthy=true,jobs=[],state={state:'unknown'},activity=null;
  try{home.assertJobsHealthy(a.id);jobs=home.listJobs(a.id,Infinity);}catch{recordsHealthy=false;issues.push('job_storage_fault');}
  try{state=workers.stateOf(a.id)||state;}catch{issues.push('runtime_observation_unavailable');}
  try{activity=workers.activityOf(a.id);}catch{issues.push('transport_observation_unavailable');}
  const running=jobs.filter(j=>j.status==='running'),queued=jobs.filter(j=>j.status==='queued');
  const desired=['ready','paused'].includes(a.desiredLifecycle)?a.desiredLifecycle:'ready';
  if(a.credentialStorageLocked)issues.push('credential_storage_locked');
  if(running.length>1)issues.push('multiple_running_jobs');
  if(running.length&&state.state!=='working')issues.push('durable_runtime_mismatch');
  if(state.state==='working'&&!running.some(j=>j.id===state.jobId))issues.push('runtime_job_mismatch');
  if(desired==='paused'&&(running.length||queued.length||state.state==='working'))issues.push('pause_cleanup_pending');
  if(jobs.some(j=>j.containment&&j.containment.status!=='stopped'&&['failed','cancelled','interrupted'].includes(j.status)))issues.push('container_cleanup_requires_inspection');
  if(activity?.jobId&&activity.jobId!==state.jobId){activity=null;issues.push('transport_job_mismatch');}
  const raw=activity?.lastDataAt??activity?.startedAt;const last=typeof raw==='number'?raw:Date.parse(raw||'');
  if(state.state==='working'&&!Number.isFinite(last))issues.push('no_transport_evidence');
  if(state.state==='working'&&Number.isFinite(last)&&now-last>staleMs)issues.push('no_recent_transport_evidence');
  let dependencyUnknown=false;
  const blocked=queued.filter(j=>j.recoveryNeeded||j.dependencies?.some(id=>{try{return home.findJob(id)?.status!=='done';}catch{dependencyUnknown=true;return true;}})).length;
  if(dependencyUnknown)issues.push('dependency_observation_unavailable');
  if(blocked)issues.push('queue_requires_inspection_or_dependencies');
  return {id:a.id,name:a.name,desired,actual:!recordsHealthy||state.state==='unknown'?'unknown':state.state==='working'?'working':running.length?'unknown':queued.length?'queued':'idle',running:running.length,queued:queued.length,blocked,recordsHealthy,issues,lastTransportAgeMs:Number.isFinite(last)?Math.max(0,now-last):null,automaticRecovery:false};
 });
 return {at:new Date(now).toISOString(),workers:rows,issues:rows.reduce((n,r)=>n+r.issues.length,0),scope:'Observed jobs and runtime, not provider health or verified progress. No automatic restart/replay.'};
}
function setDesired(home,workers,id,desired){
 if(!['ready','paused'].includes(desired)||!home.getAgent(id))throw Error('Choose an existing worker and ready/paused lifecycle.');
 home.assertJobsHealthy(id);
 home.updateAgent(id,{desiredLifecycle:desired}); // Durable intent precedes cancellation.
 if(desired==='paused')workers.cancel(id);
 return snapshot(home,workers); // ready never starts jobs or replays a queue.
}
module.exports={snapshot,setDesired};
