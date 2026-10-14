'use strict';
// Persist host prompt provenance before returning an authorization. A prompt hash is
// distinct from the action argument hash recorded at the tool boundary.
const { randomUUID, createHash } = require('crypto');
function record(home, runs, run, req, receipt) {
  if (!run) return;
  runs.assert(run);
  if (req.actor && req.actor !== run.actor) throw Error('Permission actor does not match the active job.');
  const job = home.findJob(run.jobId);
  if (!job || job.agent !== run.actor || (job.permissionReceipts || []).length >= 500) throw Error('Permission provenance cannot be persisted.');
  const { signal, onDecision, ...prompt } = req;
  const entry = { id: receipt.id || randomUUID(), origin: receipt.origin,
    decision: receipt.decision, at: receipt.at, actor: run.actor, jobId: run.jobId,
    runId: run.runId, tool: req.tool || 'unspecified', bindingScope: 'permission_prompt',
    promptSha256: createHash('sha256').update(JSON.stringify(prompt)).digest('hex'), historicalOnly: true };
  home.updateJob(run.actor,run.jobId,{permissionReceipts:[...(job.permissionReceipts||[]),entry]},
    {expectedStatus:'running',expectedRunId:run.runId,event:'permission_receipt'});
}
module.exports = { record };
