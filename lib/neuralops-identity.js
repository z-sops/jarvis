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
module.exports = { validateAgentId, normalizeIdentities, identityFor };
