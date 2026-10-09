'use strict';
// Provider token reservations, separate from convenience telemetry and request counts.
function failure(message) { return Object.assign(new Error(message), { requestBudget: true }); }
function policy(cfg) {
  const tokens = cfg.workerTokenBudget ?? 0, usd = cfg.workerCostBudgetUsd ?? 0, output = cfg.workerMaxOutputTokens ?? 4096;
  if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > 100000000 || !Number.isFinite(usd) || usd < 0 || usd > 10000 || !Number.isSafeInteger(output) || output < 1 || output > 65536) throw failure('Invalid worker token/cost budget.');
  const rates = cfg.workerModelRates || {};
  if (!rates || typeof rates !== 'object' || Array.isArray(rates) || Object.keys(rates).length > 100) throw failure('Invalid model price configuration.');
  for (const [model, r] of Object.entries(rates)) if (!/^[a-zA-Z0-9._-]{1,120}$/.test(model) || !r || !Number.isFinite(r.input) || r.input < 0 || r.input > 10000 || !Number.isFinite(r.output) || r.output < 0 || r.output > 10000) throw failure('Model prices must be explicit nonnegative USD per million token rates.');
  return { tokens, usd, output, rates, enabled: tokens > 0 || usd > 0 };
}
function createBudget(cfg, persist, prior) {
  const p = policy(cfg); if (!p.enabled) { if (prior) throw failure('A continuation cannot disable its prior token/cost policy.'); return null; }
  let state = prior ? structuredClone(prior) : { version: 1, policy: p, measuredInput: 0, measuredOutput: 0, measuredUsd: 0, reservedTokens: 0, reservedUsd: 0, reservations: [] };
  if (prior && (prior.version !== 1 || !Array.isArray(prior.reservations) || !['measuredInput','measuredOutput','measuredUsd','reservedTokens','reservedUsd'].every(k => Number.isFinite(prior[k]) && prior[k] >= 0))) throw failure('Prior budget evidence is invalid; inspect before continuing.');
  if (prior && JSON.stringify(prior.policy) !== JSON.stringify(p)) throw failure('Budget settings changed since the prior run; a continuation cannot silently change its accounting policy.');
  let fault = state.reservations.some(r => r.status === 'provider_exceeded');
  const save = next => { try { persist(next); state = next; } catch { fault = true; throw failure('Budget evidence could not be saved; no further model submission is authorized.'); } };
  return {
    policy: p,
    reserve(model, input) {
      if (fault) throw failure('Budget persistence failed; inspect storage before retrying.');
      if (!Number.isSafeInteger(input) || input < 0) throw failure('Provider input token count is unavailable.');
      const rate = p.rates[model]; if (p.usd && !rate) throw failure('Explicit token prices are required for this model before budgeted execution.');
      const tokens = input + p.output, usd = rate ? (input * rate.input + p.output * rate.output) / 1e6 : 0;
      if ((p.tokens && state.measuredInput + state.measuredOutput + state.reservedTokens + tokens > p.tokens) || (p.usd && state.measuredUsd + state.reservedUsd + usd > p.usd)) throw failure('Worker token/cost reservation would exceed the job budget.');
      if (state.reservations.length >= 500) throw failure('Job budget reservation history reached its bound.');
      const entry = { id: require('crypto').randomUUID(), model, input, output: p.output, tokens, usd, rate: rate || null, status: 'reserved_unknown' };
      save({ ...state, reservedTokens: state.reservedTokens + tokens, reservedUsd: state.reservedUsd + usd, reservations: [...state.reservations, entry] });
      return entry.id;
    },
    settle(id, usage) {
      const entry = state.reservations.find(r => r.id === id); if (!entry || entry.status !== 'reserved_unknown') throw failure('Budget reservation is missing or already settled.');
      const input = usage?.promptTokenCount, candidate = usage?.candidatesTokenCount, thought = usage?.thoughtsTokenCount ?? 0;
      if (![input,candidate,thought].every(n => Number.isSafeInteger(n) && n >= 0)) throw failure('Usage metadata is missing or invalid; reservation remains charged conservatively.');
      const output = candidate + thought, usd = entry.rate ? (input * entry.rate.input + output * entry.rate.output) / 1e6 : 0;
      const exceeded = input > entry.input || output > entry.output;
      save({ ...state, measuredInput: state.measuredInput + input, measuredOutput: state.measuredOutput + output, measuredUsd: state.measuredUsd + usd,
        reservedTokens: Math.max(0, state.reservedTokens - entry.tokens), reservedUsd: Math.max(0, state.reservedUsd - entry.usd),
        reservations: state.reservations.map(r => r.id === id ? { ...r, status: exceeded ? 'provider_exceeded' : 'measured', actualInput: input, actualOutput: output, actualUsd: usd } : r) });
      if (exceeded) { fault = true; throw failure('Provider usage exceeded its reservation; execution stopped for inspection.'); }
    },
    snapshot: () => structuredClone(state)
  };
}
module.exports = { policy, createBudget, failure };
