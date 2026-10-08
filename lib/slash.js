'use strict';
/*
  Slash commands in the chat: an order, not a request. No model decides anything here.
    /bob <job>       the job goes straight into Bob's queue, word for word
    /laila <words>   Laila answers alone and does not hand any work out (the AI's own name works too)
    /stop bob        stops what Bob is doing and every job waiting behind it
    /bob report      stops Bob now, gives the report, saves a short note
    /bob health      is OpenCode / the model connected and answering? (also /bob status)
    /bob continue    carries on from that short note (words after it are a new instruction)
  A text that does not start with a slash word is never touched (a path like /home/me/x is not a command).
  A slash word that is not a crew member gets a short hint instead of being sent anywhere.
*/
const ATTACH = /\[Attached file: .+?\]\s*$/;

function parse(text, { aiName = 'Laila', agents = [] } = {}) {
  const m = /^\s*\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(String(text == null ? '' : text));
  if (!m) return null;
  const word = m[1].toLowerCase(), rest = (m[2] || '').trim();
  const list = agents.map(a => a.name).join(', ') || 'none';
  const low = s => String(s || '').toLowerCase();
  const find = w => agents.find(a => low(a.name) === w) || agents.find(a => low(a.id) === w) || agents.find(a => low(a.name).split(/\s+/)[0] === w);
  if (word === low(aiName) || word === 'laila') {
    return rest ? { kind: 'laila', rest } : { kind: 'hint', text: `Write what you want after /${word}.` };
  }
  if (word === 'stop' || word === 'cancel') {
    if (!rest) return { kind: 'hint', text: `Stop whom? For example /stop ${agents[0] ? low(agents[0].name) : 'bob'}. Crew: ${list}.` };
    const a = find(low(rest));
    return a ? { kind: 'stop', agent: a } : { kind: 'hint', text: `"${rest}" is not on the crew. Crew: ${list}.` };
  }
  const agent = find(word);
  if (!agent) return { kind: 'hint', text: `"/${m[1]}" is not a crew member. Crew: ${list}. Use /${low(aiName)} to talk to ${aiName}.` };
  if (!rest) return { kind: 'hint', text: `Write the job after /${word}, for example: /${word} make a file called test.txt` };
  if (/^(stop|cancel)$/i.test(rest)) return { kind: 'stop', agent };
  if (/^(health|check|status)$/i.test(rest)) return { kind: 'health', agent };
  if (/^(report|rapport)$/i.test(rest)) return { kind: 'report', agent };
  const cont = /^(continue|resume)(?:\s+([\s\S]*))?$/i.exec(rest); if (cont) return { kind: 'resume', agent, note: (cont[2] || '').trim() };
  if (ATTACH.test(rest)) return { kind: 'hint', text: `A file goes to the crew through ${aiName} (she copies it into their workspace). Send it to ${aiName}: tag @${low(agent.name)} or write it without the slash.` };
  return { kind: 'crew', agent, task: rest };
}
module.exports = { parse };
