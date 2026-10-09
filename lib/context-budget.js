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
module.exports = { check, DEFAULT_REQUEST_BYTES };
