'use strict';
// A source-job intent allows deterministic repair of child/plan linkage after a crash.
const fs = require('fs'), storage = require('./job-storage');
function carry(old) {
  return { ...(old.nativeBridge ? {nativeBridge:old.nativeBridge,nativeContinuity:old.nativeContinuity}:{}), ...(old.nativeCheckpoint?{nativeCheckpoint:old.nativeCheckpoint}:{}), ...(old.tokenBudget?{tokenBudget:old.tokenBudget}:{}), ...(old.jobDecisions?{jobDecisions:old.jobDecisions}:{}), ...(old.permissionReceipts?{permissionReceipts:old.permissionReceipts}:{}), ...(old.projectBinding?{projectBinding:old.projectBinding}:{}), ...(old.workspaceDir&&old.isolation==='git_worktree'?{resumeFrom:old.id}:{}), ...(old.workspaceDir&&old.isolation==='native_container'?{workspaceDir:old.workspaceDir,isolation:'native_container',workspaceOwnerJobId:old.workspaceOwnerJobId||old.id}:{}) };
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
module.exports={carry,complete,planLink};
