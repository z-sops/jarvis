'use strict';
// Deterministic byte limits, not a tokenizer or a claim about provider billing.
const DEFAULT_REQUEST_BYTES = 131072;
function check(value, limit = DEFAULT_REQUEST_BYTES) {
  if (!Number.isSafeInteger(limit) || limit < 1024 || limit > 1048576) throw new Error('Invalid context byte budget.');
  const bytes = Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  if (bytes > limit) {
    const e = new Error(`Context exceeds the ${limit}-byte request budget (${bytes} bytes). Orbit stopped before submitting this request. No goal, state or approval was silently removed. Narrow the task or split the material before retrying; inspect any prior tool effects.`);
    e.contextBudget = true; throw e;
  }
  return { bytes, limit, unit: 'utf8_bytes' };
}
function createRequestBudget(limit = 40, onReserve = () => {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Worker request limit must be an integer from 1 to 500.');
  let attempted = 0;
  return {
    beforeSubmit(model) {
      if (attempted >= limit) throw Object.assign(new Error(`Worker request budget exhausted (${attempted}/${limit} model submissions). Inspect prior tool effects before explicitly retrying. No action was replayed.`), { requestBudget: true });
      attempted++;
      try { onReserve({ attempted, limit, model, unit: 'model_submission_attempts', boundary: 'builtin_worker_only' }); }
      catch { throw Object.assign(new Error('Worker request reservation could not be persisted. Submission stopped; inspect the existing job before retrying.'), { requestBudget: true }); }
    },
    snapshot: () => ({ attempted, limit, unit: 'model_submission_attempts', boundary: 'builtin_worker_only' })
  };
}
function fitReadHistory(body, limit = DEFAULT_REQUEST_BYTES) {
  const beforeBytes = Buffer.byteLength(JSON.stringify(body));
  try { check(body, limit); return { body, beforeBytes, afterBytes: beforeBytes, omittedReadResults: 0 }; }
  catch (e) { if (!e.contextBudget) throw e; }
  const reads = [];
  for (let i = 0; i < (body.contents || []).length; i++) {
    const message = body.contents[i]; if (message.role !== 'user') continue;
    for (let j = 0; j < (message.parts || []).length; j++) {
      const fr = message.parts[j].functionResponse, r = fr?.response?.result;
      if (fr?.name === 'read_file' && r && typeof r === 'object' && !r.error && typeof r.path === 'string' && typeof r.content === 'string') reads.push({ i, j, fr, r });
    }
  }
  // Keep the latest two read results intact. Never alter tool calls/signatures,
  // goals, system instructions, model text, approvals or effect results.
  const projected = { ...body, contents: (body.contents || []).slice() }; let omittedReadResults = 0;
  for (const { i, j, fr, r } of reads.slice(0, -2)) {
    const encoded = JSON.stringify(r), digest = require('crypto').createHash('sha256').update(encoded).digest('hex');
    const result = { path: r.path, offset: r.offset ?? 0, omitted: true, originalBytes: Buffer.byteLength(encoded), sha256: digest,
      note: 'Older untrusted file-read data omitted from this request only. Read a bounded window again if needed. The source may have changed; this digest is not verification, authorization or a retrievable snapshot.' };
    if (Buffer.byteLength(JSON.stringify(result)) >= Buffer.byteLength(encoded)) continue;
    const message = projected.contents[i];
    const parts = message.parts.slice(); parts[j] = { ...parts[j], functionResponse: { ...fr, response: { ...fr.response, result } } };
    projected.contents[i] = { ...message, parts }; omittedReadResults++;
    try { const measured = check(projected, limit); return { body: projected, beforeBytes, afterBytes: measured.bytes, omittedReadResults }; }
    catch (e) { if (!e.contextBudget) throw e; }
  }
  check(projected, limit); // Fail closed if protected/current context still does not fit.
  return { body: projected, beforeBytes, afterBytes: Buffer.byteLength(JSON.stringify(projected)), omittedReadResults };
}
module.exports = { check, DEFAULT_REQUEST_BYTES, createRequestBudget, fitReadHistory };
