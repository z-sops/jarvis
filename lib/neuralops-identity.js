'use strict';
// Explicit worker identities. Never infer authority from a display name or tool arguments.
const AGENT_ID = /^agent\.[a-z0-9][a-z0-9_-]{1,62}$/;
const ACTOR_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function validateAgentId(id) {
  if (typeof id !== 'string' || !AGENT_ID.test(id)) throw new Error('Choose a NeuralOps AI identity such as agent.alex. Human identities cannot be assigned to AI workers.');
  return id;
}
function normalizeIdentities(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('NeuralOps identities must map Orbit workers to AI identities.');
  const entries = Object.entries(input);
  if (entries.length > 101) throw new Error('At most 101 NeuralOps worker identities may be configured.');
  const out = Object.create(null), used = new Set();
  for (const [actor, value] of entries) {
    if (!ACTOR_ID.test(actor) || ['__proto__', 'prototype', 'constructor'].includes(actor)) throw new Error('Invalid Orbit worker id.');
    if (value === '') continue; // a blank row explicitly removes a mapping
    const id = validateAgentId(value);
    if (used.has(id)) throw new Error('Each Orbit worker needs a different NeuralOps identity.');
    used.add(id); out[actor] = id;
  }
  return out;
}
function identityFor(connector, actor) {
  if (connector.catalogId !== 'neuralops') return null;
  const ids = normalizeIdentities(connector.neuralopsIdentities || {});
  if (!Object.hasOwn(ids, actor)) throw new Error('NeuralOps identity is not configured for this worker. Open Connectors > NeuralOps > Who can use it and set its AI identity.');
  return ids[actor];
}
// Read-only diagnostic. The saved broker secret and raw service replies never cross IPC.
async function verifyIdentities(connectors, id, actors, { Upstream = require('./upstream').Upstream, timeoutMs = 10000 } = {}) {
  const c = connectors.get(id);
  if (!c || c.catalogId !== 'neuralops' || !c.enabled) throw Error('Enable the NeuralOps connector before verification.');
  const ids = normalizeIdentities(c.neuralopsIdentities || {}), token = connectors.token(id);
  const names = [...new Set(['commander', ...actors])];
  if (names.length > 101 || names.some(a => !ACTOR_ID.test(a))) throw Error('Invalid worker inventory.');
  const signature = () => {
    const current = connectors.get(id);
    return current && JSON.stringify([current.url, current.enabled, current.agents, Object.entries(normalizeIdentities(current.neuralopsIdentities || {})).sort()]);
  };
  const before = signature(), current = () => signature() === before && connectors.token(id) === token;
  const result = { checkedAt: new Date().toISOString(), broker: { passed: false, reason: 'not_checked' }, workers: [], allPassed: false, stale: false };
  const reason = e => /401|unauthorized/i.test(String(e?.message)) ? 'authentication_refused' : /403|forbidden/i.test(String(e?.message)) ? 'delegation_refused' : e?.code === 'VERIFY_TIMEOUT' ? 'deadline' : 'unavailable';
  async function who(agentId) {
    const u = new Upstream({ id, url: c.url, token, agentId, timeoutMs }), work = (async () => {
      try {
        const r = await u.callTool('neuralops_whoami', {});
        if (r.isError) return null;
        const candidates = [r.structuredContent];
        for (const block of (r.content || []).slice(0, 8)) if (block.type === 'text' && typeof block.text === 'string' && Buffer.byteLength(block.text) <= 65536) {
          try { candidates.push(JSON.parse(block.text)); } catch { /* malformed reply is not evidence */ }
        }
        const data = candidates.find(x => x?.ok === true && x.result?.agent && typeof x.result.agent === 'object');
        return data?.result.agent || null;
      } finally { await u.close(); }
    })();
    let timer;
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { const e = Error('Verification deadline'); e.code = 'VERIFY_TIMEOUT'; u.abort(); reject(e); }, timeoutMs); })]); }
    finally { clearTimeout(timer); } // work owns closing even if a pending handshake finishes late
  }
  let broker;
  try {
    if (!token) { result.broker.reason = 'authentication_refused'; return result; }
    broker = await who(null);
    if (!broker || !AGENT_ID.test(broker.id) || typeof broker.workspaceId !== 'string' || !broker.workspaceId) { result.broker.reason = 'invalid_response'; return result; }
    result.broker = { id: broker.id, passed: broker.access === 'broker' && broker.revokedAt === null, reason: broker.revokedAt !== null ? 'revoked_or_unknown' : broker.access !== 'broker' ? 'broker_required' : 'verified' };
    if (!result.broker.passed) return result;
    const deadline = Date.now() + 60000; let stopped = false;
    for (const actor of names) {
      const identity = ids[actor], row = { actor, identity: identity || null, passed: false, reason: 'not_checked' };
      result.workers.push(row);
      if (!identity) { row.reason = 'no_mapping'; continue; }
      if (!connectors.visibleTo(c, actor)) { row.reason = 'access_disabled'; continue; }
      if (stopped || Date.now() >= deadline) { row.reason = 'not_checked'; continue; }
      if (!current()) { result.stale = true; stopped = true; continue; }
      try {
        const a = await who(identity);
        row.reason = !a ? 'invalid_response' : a.id !== identity ? 'unexpected_identity' : a.revokedAt !== null ? 'revoked_or_unknown' : a.delegate !== broker.id ? 'delegate_mismatch' : a.workspaceId !== broker.workspaceId ? 'workspace_mismatch' : 'verified';
        row.passed = row.reason === 'verified';
      } catch (e) { row.reason = reason(e); if (row.reason === 'deadline') stopped = true; }
    }
  } catch (e) { result.broker.reason = reason(e); }
  finally {
    if (!current()) { result.stale = true; result.broker.passed = false; for (const row of result.workers) { row.passed = false; row.reason = 'stale'; } }
  }
  result.allPassed = !result.stale && result.broker.passed && result.workers.length === names.length && result.workers.every(r => r.passed);
  return result;
}
module.exports = { validateAgentId, normalizeIdentities, identityFor, verifyIdentities };
