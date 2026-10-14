'use strict';
/*
  Anomaly rules for a crew job on the built-in engine. Plain code, no model call, no cost.
  After every step it looks at the checkpoint card (the last 12 steps) and spots a job that is going in circles:
    loop  - the same tool with the same arguments again and again (warn at 3, stop at 6)
    fails - the same tool failing again and again (warn at 3, stop at 4)
  A warning is shown in the chat and in the log. A stop ends the job with a clear message, so the agent does not burn
  tokens in a loop. Each rule speaks once per job. Everything is best-effort: a problem here never breaks a job.
  Events are also appended to <home>/anomalies.jsonl, so there is a record to look at later.
*/
const fs = require('fs');

const RULES = { loopWarn: 3, loopStop: 6, failWarn: 3, failStop: 4 };
const fired = new WeakMap();   // card -> Set of "rule:level" already reported for this job

const sig = s => s.tool + '|' + JSON.stringify(s.args || {});

// Pure: returns what is wrong with the steps right now ([] when nothing).
function detect(steps) {
  const out = []; steps = steps || [];
  if (!steps.length) return out;
  const last = steps[steps.length - 1];
  let n = 0; for (let i = steps.length - 1; i >= 0 && sig(steps[i]) === sig(last); i--) n++;
  if (n >= RULES.loopStop) out.push({ rule: 'loop', level: 'stop', n, text: `${last.tool} was called ${n} times in a row with the same arguments` });
  else if (n >= RULES.loopWarn) out.push({ rule: 'loop', level: 'warn', n, text: `${last.tool} was called ${n} times in a row with the same arguments` });
  let f = 0; for (let i = steps.length - 1; i >= 0 && steps[i].tool === last.tool && steps[i].ok === false; i--) f++;
  if (f >= RULES.failStop) out.push({ rule: 'fails', level: 'stop', n: f, text: `${last.tool} failed ${f} times in a row` });
  else if (f >= RULES.failWarn) out.push({ rule: 'fails', level: 'warn', n: f, text: `${last.tool} failed ${f} times in a row` });
  return out;
}

// Called after every step. Warns once per rule and level; on "stop" it aborts the job with a reason that says why.
function check({ home, bus, agent, job, card, ctl }) {
  try {
    if (!card || !ctl || ctl.signal.aborted) return;
    let seen = fired.get(card); if (!seen) { seen = new Set(); fired.set(card, seen); }
    for (const a of detect(card.steps)) {
      const key = a.rule + ':' + a.level;
      if (seen.has(key)) continue; seen.add(key);
      const stop = a.level === 'stop';
      const text = `${agent.name}: ${a.text}.` + (stop ? ' Orbit stopped the job.' : ' Watching.');
      try { bus && bus.emit('anomaly', { agentId: agent.id, agentName: agent.name, jobId: job.id, rule: a.rule, level: a.level, n: a.n, text, stopped: stop }); } catch { /* the display is optional */ }
      try { require('./managed-write').appendFileSync(home.p('anomalies.jsonl'), JSON.stringify({ t: new Date().toISOString(), agent: agent.id, job: job.id, rule: a.rule, level: a.level, n: a.n, text }) + '\n'); } catch { /* the record is optional */ }
      if (stop) {
        const err = new Error(`Stopped by Orbit: ${a.text}. The job was going in circles, so it was ended instead of using more tokens. What it did so far is in its workspace; give it a clearer task or another approach.`);
        err.anomaly = a.rule; ctl.abort(err);
        return;
      }
    }
  } catch { /* never stop a job because of the watcher */ }
}

module.exports = { RULES, detect, check };
