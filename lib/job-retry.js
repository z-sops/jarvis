'use strict';
// A source-job intent allows deterministic repair of child/plan linkage after a crash.
const fs = require('fs'), storage = require('./job-storage');
function carry(old) {
  return { ...(old.remoteCommunication?{remoteCommunication:old.remoteCommunication}:{}), ...(old.builtinRoute?{builtinRoute:old.builtinRoute}:{}), ...(old.nativeBridge ? {nativeBridge:old.nativeBridge,nativeContinuity:old.nativeContinuity}:{}), ...(old.nativeCheckpoint?{nativeCheckpoint:old.nativeCheckpoint}:{}), ...(old.tokenBudget?{tokenBudget:old.tokenBudget}:{}), ...(old.jobDecisions?{jobDecisions:old.jobDecisions}:{}), ...(old.permissionReceipts?{permissionReceipts:old.permissionReceipts}:{}), ...(old.projectBinding?{projectBinding:old.projectBinding}:{}), ...(old.workspaceDir&&old.isolation==='git_worktree'?{resumeFrom:old.id}:{}), ...(old.workspaceDir&&old.isolation==='native_container'?{workspaceDir:old.workspaceDir,isolation:'native_container',workspaceOwnerJobId:old.workspaceOwnerJobId||old.id}:{}) };
}
// Stable history owner can precede several failed attempts. Never infer ancestry by actor alone.
function historyOwner(home, job, ownerId) {
  if (ownerId === job.id) return job;
  const immediate = job.retryOf ? home.findJob(job.retryOf) : null;
  // Preserve the existing direct-parent history contract for legacy single retries.
  if (immediate?.id === ownerId && immediate.agent === job.agent) return immediate;
  let current = job; const seen = new Set();
  while (current.id !== ownerId) {
    if (!current.retryOf || seen.has(current.id) || seen.size >= 128) throw Error('Native history retry lineage is missing, cyclic or exceeds its bound.');
    seen.add(current.id); const parent = home.findJob(current.retryOf);
    if (!parent || parent.agent !== job.agent || parent.status !== 'retried' || parent.retryJobId !== current.id || !current.retryLinkReady) throw Error('Native history retry ownership is not verified.');
    current = parent;
  }
  return current;
}
function originalTask(home,job) {
  let current=job;const seen=new Set();
  while(current.retryOf) {
    if(seen.has(current.id)||seen.size>=128)throw Error('Retry goal lineage is cyclic or exceeds its bound; inspect before retrying.');
    seen.add(current.id);const parent=home.findJob(current.retryOf);
    if(!parent||parent.agent!==job.agent||parent.retryJobId!==current.id||parent.status!=='retried'||!current.retryLinkReady)throw Error('Retry goal lineage is not verified; inspect before retrying.');
    current=parent;
  }
  if(typeof current.task!=='string'||!current.task.trim())throw Error('Original retry goal is missing.');
  return current.task;
}
function planLink(home,old,next,rollback=false) {
  if (!old.projectBinding) return;
  const id=old.projectBinding.projectId;
  if(!/^project-[a-f0-9-]{36}$/.test(id))throw Error('Invalid retry project binding.');
  const file=home.p('projects',id+'.json'); if(fs.lstatSync(file).isSymbolicLink())throw Error('Retry project card cannot be a link.');
  const p=JSON.parse(fs.readFileSync(file)),step=p.steps?.find(s=>s.id===old.projectBinding.stepId);
  if(p.id!==id||p.schemaVersion!==1||!step||![old.id,next.id].includes(step.jobId))throw Error('Retry project step ownership changed.');
  const expected=rollback?old.id:next.id;if(step.jobId===expected)return;
  storage.atomicWrite(file,{...p,steps:p.steps.map(s=>s.id===step.id?{...s,jobId:expected}:s)});
}
function complete(home,old,next) {
  if(old.agent!==next.agent||next.retryOf!==old.id||!['queued','interrupted'].includes(next.status)||old.retryIntent?.version!==1)throw Error('Retry intent/child binding is not safely recoverable.');
  if(JSON.stringify(next.expectedOutputs||[])!==JSON.stringify(old.expectedOutputs||[])||next.projectRoot!==old.projectRoot)throw Error('Retry contract changed during setup.');
  const updated=home.updateJob(next.agent,next.id,{...old.retryIntent.carry,retryLinkReady:true},{expectedStatus:next.status,event:'retry_link_ready'});
  planLink(home,old,updated);return updated;
}
module.exports={carry,complete,planLink,originalTask,historyOwner};
