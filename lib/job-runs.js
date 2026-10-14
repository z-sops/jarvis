'use strict';
// Main-process lifetime fences. Never infer a job's identity from model-supplied arguments.
const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

function createJobRuns() {
  const live = new Map(), scope = new AsyncLocalStorage();
  const current = () => scope.getStore();
  function isCurrent(run) { return !!run && live.get(run.actor) === run && !run.signal.aborted; }
  function assert(run) { if (!isCurrent(run)) throw new Error('This job run has stopped or expired. Start a new job to continue.'); return run; }
  function end(run) {
    if (live.get(run.actor) !== run) return false;
    live.delete(run.actor); run.signal.removeEventListener('abort', run.onAbort); return true;
  }
  function begin(actor, jobId, signal) {
    if (!actor || !jobId || !signal || signal.aborted) throw new Error('A live job and cancellation signal are required.');
    if (live.has(actor)) throw new Error('This worker already has an active job run.');
    const run = Object.freeze({ actor, jobId, runId: randomUUID(), signal, onAbort: () => end(run) });
    live.set(actor, run); signal.addEventListener('abort', run.onAbort, { once: true }); return run;
  }
  function within(run, fn) { assert(run); return scope.run(run, fn); }
  // Capture at authentication time, before waiting for an HTTP request body.
  function bind(actor) { const run = assert(live.get(actor)); return fn => within(run, fn); }
  function assertCurrent() { const run = current(); if (run) assert(run); }
  function guard(run, fn) { return (...args) => { if (isCurrent(run)) return scope.run(run, () => fn(...args)); }; }
  return { begin, end, assert, isCurrent, within, bind, current, assertCurrent, guard,
    generationFor: actor => { const run = live.get(actor); return isCurrent(run) ? run.runId : null; } };
}
module.exports = { createJobRuns };
