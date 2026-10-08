'use strict';
// The master key never leaves Orbit. Each profile receives only its actor-bound HMAC token.
const crypto = require('crypto');
const fs = require('fs');
const ACTOR = /^[a-z0-9][a-z0-9-]{0,40}$/;
const RESERVED = new Set(['commander', 'jarvis']);

function loadActorKey(file, io = fs) {
  const read = () => {
    const key = io.readFileSync(file, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('The Orbit gateway identity key is invalid. Restore it from a trusted backup; it was not replaced.');
    return key;
  };
  try { return read(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const key = crypto.randomBytes(32).toString('hex');
  try { io.writeFileSync(file, key, { mode: 0o600, flag: 'wx' }); return key; }
  catch (e) { if (e.code === 'EEXIST') return read(); throw e; }
}

function createActorAuth({ key, isActiveActor, generationFor }) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Orbit gateway authentication requires a private 32-byte key.');
  if (typeof isActiveActor !== 'function') throw new Error('Orbit gateway authentication requires an active-worker check.');
  if (typeof generationFor !== 'function') throw new Error('Orbit gateway authentication requires a run-generation check.');
  const keyBytes = Buffer.from(key, 'hex');
  function tokenForActor(actor) {
    if (typeof actor !== 'string' || !ACTOR.test(actor) || RESERVED.has(actor) || !isActiveActor(actor)) return null;
    const generation = generationFor(actor);
    if (typeof generation !== 'string' || !generation) return null;
    return 'orbit_actor_' + crypto.createHmac('sha256', keyBytes).update(JSON.stringify(['orbit-mcp-run-v2', actor, generation])).digest('hex');
  }
  function authenticate(actor, got) {
    const expected = tokenForActor(actor);
    if (!expected || typeof got !== 'string') return false;
    const a = Buffer.from(expected), b = Buffer.from(got);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return { tokenForActor, authenticate };
}
module.exports = { loadActorKey, createActorAuth };
