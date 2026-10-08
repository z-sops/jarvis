'use strict';
// A job's state and transition history are committed in the same atomic file replacement.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const validJobId = id => typeof id === 'string' && /^job-[a-z0-9-]{1,100}$/.test(id);
function jobFile(home, actor, id) {
  if (!validJobId(id)) throw new Error('Invalid job id.');
  return path.join(home.agentDir(actor), 'jobs', id + '.json');
}
function readJob(home, actor, id) {
  const file = jobFile(home, actor, id);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('A job record cannot be a symbolic link.');
  const job = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (job.id !== id || job.agent !== actor) throw new Error('Job record identity does not match its folder.');
  if (typeof job.task !== 'string' || typeof job.createdAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt)) || !['queued', 'running', 'review', 'done', 'failed', 'cancelled', 'interrupted', 'retrying', 'retried', 'rejected'].includes(job.status)) throw new Error('The job record is invalid.');
  return job;
}
function atomicWrite(file, job) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomUUID() + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(job, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    // Directory fsync is unavailable on some Windows filesystems. The file is already flushed.
    let dir; try { dir = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dir); } catch { /* platform limitation */ } finally { if (dir !== undefined) fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function appendEvent(job, patch, event) {
  const revision = (Number.isSafeInteger(job.revision) ? job.revision : 0) + 1;
  const next = { ...job, ...patch, id: job.id, agent: job.agent, task: job.task, createdAt: job.createdAt, revision };
  next.history = [...(Array.isArray(job.history) ? job.history : []), {
    revision, at: new Date().toISOString(), event: event || (patch.status && patch.status !== job.status ? patch.status : 'updated'),
    from: job.status || null, to: next.status, runId: next.runId || null
  }].slice(-100);
  return next;
}
function updateJob(home, actor, id, patch, { expectedRunId, expectedStatus, event } = {}) {
  const job = readJob(home, actor, id);
  if (expectedRunId !== undefined && job.runId !== expectedRunId) throw new Error('This job generation no longer owns the record.');
  if (expectedStatus !== undefined && job.status !== expectedStatus) throw new Error('The job state has changed. Refresh before trying again.');
  const next = appendEvent(job, patch, event); atomicWrite(jobFile(home, actor, id), next); return next;
}
function outputs(value = []) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Expected outputs must be a list of at most 20 workspace file paths.');
  return [...new Set(value.map(v => {
    if (typeof v !== 'string') throw new Error('An expected output must be a workspace-relative file path.');
    const p = v.replace(/\\/g, '/');
    if (!p || p.length > 240 || p.startsWith('/') || /[:\x00-\x1f]/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('An expected output must be a workspace-relative file path.');
    return p;
  }))];
}
function createJob(home, actor, task, options = {}) {
  if (typeof task !== 'string' || !task.trim()) throw new Error('A job needs a task.');
  const id = 'job-' + randomUUID();
  const base = { id, agent: actor, task, createdAt: new Date().toISOString(), expectedOutputs: outputs(options.expectedOutputs),
    ...(options.retryOf ? { retryOf: options.retryOf } : {}) };
  const job = appendEvent(base, { status: 'queued' }, 'created'); atomicWrite(jobFile(home, actor, id), job); return job;
}
module.exports = { validJobId, jobFile, readJob, atomicWrite, updateJob, createJob, outputs };
