'use strict';
// File existence is evidence, not proof that an artifact satisfies the user's goal.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { outputs } = require('./job-storage');
const MAX_FILE = 8 * 1024 * 1024;
function componentPaths(root, rel, impl = path) {
  let current = impl.resolve(root); const prefix = impl.parse(current).root;
  const pieces = current.slice(prefix.length).split(impl.sep).filter(Boolean); current = prefix;
  return [...pieces, ...rel.split('/')].map(piece => (current = impl.join(current, piece)));
}
function inspectOutput(home, actor, rel, workspaceDir) {
  outputs([rel]);
  const root = workspaceDir || home.p('workspace', actor), target = path.join(root, ...rel.split('/'));
  // Do not follow symlinks in any component, including the workspace root.
  for (const current of componentPaths(root, rel)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not accepted as output evidence.');
  }
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new Error('The output is not a regular file.');
    if (!before.size) throw new Error('The output file is empty.');
    if (before.size > MAX_FILE) throw new Error('The output is too large for automatic evidence checking (8 MB limit).');
    const bytes = Buffer.alloc(before.size); let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
    const after = fs.fstatSync(fd), named = fs.lstatSync(target);
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink() || named.ino !== after.ino || named.dev !== after.dev) throw new Error('The output changed during verification. Try again.');
    return { path: rel, bytes: count, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(fd); }
}
function evidence(home, actor, job) {
  const expected = outputs(job.expectedOutputs || []), artifacts = [], issues = [];
  for (const rel of expected) {
    try { artifacts.push(inspectOutput(home, actor, rel, job.workspaceDir)); }
    catch (e) { issues.push({ path: rel, reason: e.code === 'ENOENT' ? 'The requested output file is missing.' : e.message }); }
  }
  if (!String(job.result || '').trim()) issues.push({ reason: 'The worker returned no report.' });
  return { status: issues.length ? 'failed' : expected.length ? 'files_checked' : 'unverified', checkedAt: new Date().toISOString(), artifacts, issues,
    note: 'Checks cover file presence, size and fingerprint. Human review is still required for correctness.' };
}
function accept(home, actor, id) {
  const job = home.findJob(id);
  if (!job || job.agent !== actor || job.status !== 'review') throw new Error('Only this worker\'s review-ready job can be accepted.');
  // Read and fingerprint again at acceptance time; an earlier check may have gone stale.
  const verification = evidence(home, actor, job);
  if (job.verification?.artifacts?.length && verification.status === 'files_checked') {
    for (const previous of job.verification.artifacts) if (!verification.artifacts.some(a => a.path === previous.path && a.sha256 === previous.sha256)) verification.issues.push({ path: previous.path, reason: 'This file changed after the worker report. Inspect the updated file before accepting again.' });
    if (verification.issues.length) verification.status = 'failed';
  }
  if (verification.status === 'failed') {
    home.updateJob(actor, id, { verification }, { expectedStatus: 'review', expectedRunId: job.runId, event: 'acceptance_blocked' });
    throw new Error('Acceptance blocked: ' + verification.issues.map(i => (i.path ? i.path + ': ' : '') + i.reason).join(' '));
  }
  return home.updateJob(actor, id, { status: 'done', verification, acceptedAt: new Date().toISOString(), acceptedBy: 'human',
    completionKind: verification.status === 'files_checked' ? 'human_accepted_files' : 'human_accepted_report' },
  { expectedStatus: 'review', expectedRunId: job.runId, event: 'human_accepted' });
}
module.exports = { componentPaths, inspectOutput, evidence, accept };
