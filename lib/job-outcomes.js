'use strict';
// Commit the delivery intent with the local outcome. No model reports become
// remote approval, verified evidence or completion. Report/artifact content is
// represented only by hashes and counts in these outcome messages.
const { randomUUID } = require('node:crypto');
const { sha, stable } = require('./job-guidance');
const STATES = { review: 'review', done: 'accepted_locally', rejected: 'rejected_locally', failed: 'failed', cancelled: 'cancelled', interrupted: 'interrupted' };
function outcomePatch(job, patch) {
  if (!job.managed || !job.guidance || !STATES[patch.status]) return patch;
  if (job.guidance.runId !== job.runId) throw new Error('Managed outcome has a stale run binding.');
  const combined = { ...job, ...patch }, entries = job.remoteOutcomes || [];
  if (entries.length >= 2) throw new Error('This job already has its terminal outcome records.');
  const payload = { taskId: job.guidance.taskId, version: 'orbit-v1', jobId: job.id, runId: job.runId,
    sequence: entries.length + 1, state: STATES[patch.status], verification: combined.verification?.status || 'unverified',
    reportSha256: sha(String(combined.result || '')), artifactsSha256: sha(stable(combined.verification?.artifacts || [])),
    artifactCount: combined.verification?.artifacts?.length || 0 };
  return { ...patch, remoteOutcomes: [...entries, { actId: 'orbit_outcome_' + randomUUID(), payload, delivery: 'pending' }] };
}
module.exports = { outcomePatch };
