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
function inspectOutput(home, actor, rel, workspaceDir, allowEmpty = false) {
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
    if (!before.size && !allowEmpty) throw new Error('The output file is empty.');
    if (before.size > MAX_FILE) throw new Error('The output is too large for automatic evidence checking (8 MB limit).');
    const bytes = Buffer.alloc(before.size); let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
    const after = fs.fstatSync(fd), named = fs.lstatSync(target);
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.isSymbolicLink() || named.ino !== after.ino || named.dev !== after.dev) throw new Error('The output changed during verification. Try again.');
    return { path: rel, bytes: count, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally { fs.closeSync(fd); }
}
function revisionEvidence(home, actor, job) {
  if (job.isolation !== 'git_worktree') return null;
  const root = job.workspaceDir;
  if (!root) throw new Error('The isolated job workspace is missing.');
  const git = args => require('child_process').execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const head = git(['rev-parse', 'HEAD']).trim(), status = git(['status', '--porcelain=v1', '-z']);
  const names = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  if (names.length > 2000) throw new Error('Project evidence exceeds the 2000-file bound. Narrow the project before review.');
  let bytes = 0;
  const manifest = names.map(rel => {
    let a;
    try { a = inspectOutput(home, actor, rel, root, true); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return { path: rel, missing: true }; }
    bytes += a.bytes;
    if (bytes > 64 * 1024 * 1024) throw new Error('Project evidence exceeds the 64 MiB bound. Narrow the project before review.');
    return a;
  });
  // Detect tracked/untracked changes and HEAD movement while collecting evidence.
  if (head !== git(['rev-parse', 'HEAD']).trim() || status !== git(['status', '--porcelain=v1', '-z'])) throw new Error('The project changed during evidence collection. Try again.');
  const sha256 = crypto.createHash('sha256').update(JSON.stringify({ head, manifest })).digest('hex');
  return { head, sha256, files: names.length, bytes, boundary: 'git_tracked_and_nonignored_untracked_files',
    note: 'Content fingerprint, not independent review or test evidence. Ignored files and the Git metadata directory are excluded.' };
}
function evidence(home, actor, job) {
  const expected = outputs(job.expectedOutputs || []), artifacts = [], issues = [];
  for (const rel of expected) {
    try { artifacts.push(inspectOutput(home, actor, rel, job.workspaceDir)); }
    catch (e) { issues.push({ path: rel, reason: e.code === 'ENOENT' ? 'The requested output file is missing.' : e.message }); }
  }
  let revision = null;
  try { revision = revisionEvidence(home, actor, job); }
  catch (e) { issues.push({ reason: e.message?.startsWith('Project evidence') ? e.message : 'Project revision evidence could not be collected. Inspect its workspace before review.' }); }
  if (!String(job.result || '').trim()) issues.push({ reason: 'The worker returned no report.' });
  return { status: issues.length ? 'failed' : expected.length ? 'files_checked' : 'unverified', checkedAt: new Date().toISOString(), artifacts, issues, ...(revision ? { revision } : {}),
    note: 'Checks cover file presence, size and fingerprint. Human review is still required for correctness.' };
}
function accept(home, actor, id, decorate = (_job, patch) => patch) {
  const job = home.findJob(id);
  if (!job || job.agent !== actor || job.status !== 'review') throw new Error('Only this worker\'s review-ready job can be accepted.');
  // Read and fingerprint again at acceptance time; an earlier check may have gone stale.
  const verification = evidence(home, actor, job);
  if (job.isolation === 'git_worktree' && (!job.verification?.revision || !verification.revision || job.verification.revision.sha256 !== verification.revision.sha256)) {
    verification.issues.push({ reason: 'The project revision changed or has no prior fingerprint. Inspect the complete updated worktree before accepting again.' }); verification.status = 'failed';
  }
  if (job.verification?.artifacts?.length && verification.status === 'files_checked') {
    for (const previous of job.verification.artifacts) if (!verification.artifacts.some(a => a.path === previous.path && a.sha256 === previous.sha256)) verification.issues.push({ path: previous.path, reason: 'This file changed after the worker report. Inspect the updated file before accepting again.' });
    if (verification.issues.length) verification.status = 'failed';
  }
  if (verification.status === 'failed') {
    home.updateJob(actor, id, { verification }, { expectedStatus: 'review', expectedRunId: job.runId, event: 'acceptance_blocked' });
    throw new Error('Acceptance blocked: ' + verification.issues.map(i => (i.path ? i.path + ': ' : '') + i.reason).join(' '));
  }
  return home.updateJob(actor, id, decorate(job, { status: 'done', verification, acceptedAt: new Date().toISOString(), acceptedBy: 'human',
    completionKind: verification.status === 'files_checked' ? 'human_accepted_files' : 'human_accepted_report' }),
  { expectedStatus: 'review', expectedRunId: job.runId, event: 'human_accepted' });
}
module.exports = { componentPaths, inspectOutput, revisionEvidence, evidence, accept };
