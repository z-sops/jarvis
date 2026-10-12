'use strict';
/*
  `opencode run --format json` prints one JSON event per line. This reads them while the job runs, so Orbit knows what the agent is doing
  (thinking, which tool, how many tokens) and what it said, instead of waiting for the final text.
  Shapes seen on this PC (opencode run "say hi in one word" --format json):
    {"type":"step_start","part":{"type":"step-start"}}
    {"type":"text","part":{"type":"text","text":"Hi"}}
    {"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"total":7915,"input":5970,"output":3,"reasoning":0,"cache":{...}}}}
  {"type":"tool_use","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"...\\t.txt","content":"hi"},"output":"Wrote file successfully."}}}   (also tool "glob" with input.pattern)
  Any other event type with "tool" in its name is read the same way; unknown shapes are ignored, never an error.
*/
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };

function toolLabel(part) {
  const name = part.tool || part.name || 'tool';
  const inp = (part.state && part.state.input) || part.input || {};
  const file = inp.filePath || inp.path || inp.file;
  const detail = file ? String(file).split(/[\\/]/).pop() : (inp.command || inp.pattern || inp.url || '');
  const words = typeof inp.content === 'string' ? (inp.content.match(/\S+/g) || []).length : null;   // a write: how many words went into the file
  return { name: String(name), label: clip(name + (detail ? ' ' + detail : '') + (words != null ? ` (${words} words)` : ''), 90) };
}
const statusOf = s => (s === 'completed' || s === 'done' ? 'done' : s === 'error' || s === 'failed' ? 'failed' : 'running');

function describe(e) {
  if (!e || typeof e !== 'object') return null;
  const part = e.part || {};
  switch (e.type) {
    case 'step_start': return { kind: 'step', label: 'thinking' };
    case 'acp_text': return typeof part.text==='string'?{kind:'text',text:part.text,append:true}:null;
    case 'text': return part.text ? { kind: 'text', text: String(part.text) } : null;
    case 'step_finish': { const k = part.tokens || {}; return { kind: 'finish', label: 'step done' + (k.total ? ` (${k.input || 0} in, ${k.output || 0} out)` : ''), tokens: k }; }
    case 'error': { const er = e.error || {}; return { kind: 'error', text: clip((er.data && er.data.message) || er.message || er.name || JSON.stringify(er), 200) }; }
    default:
      if (/tool/i.test(String(e.type))) { const t = toolLabel(part); return { kind: 'tool', name: t.name, label: t.label, status: statusOf(part.state && part.state.status), ...(typeof part.id==='string'?{id:part.id}:{}) }; }
      return null;
  }
}

function makeCollector({ onProgress, onText, log } = {}) {
  let buf = '', n = 0, err = ''; const texts = [];
  const note = m => { if (log) { try { log(m); } catch { /* the log must never break a job */ } } };
  const say = p => { if (onProgress) { try { onProgress(p); } catch { /* a listener must never break a job */ } } };
  function line(s) {
    s = s.trim(); if (!s) return; note('raw ' + s.slice(0, 160)); if (s[0] !== '{') return;
    let e; try { e = JSON.parse(s); } catch { return; }
    if (!e || typeof e.type !== 'string') return; n++;
    const d = describe(e); note('-> ' + (d ? d.kind + ' ' + (d.label || '').slice(0, 80) : 'ignored ' + e.type)); if (!d) return;
    if (d.kind === 'step') say({ tool: 'opencode', label: d.label, status: 'running' });
    else if (d.kind === 'finish') say({ tool: 'opencode', label: d.label, status: 'running' });
    else if (d.kind === 'tool') say({ tool: d.name, label: d.label, status: d.status, ...(d.id?{id:d.id}:{}) });
    else if (d.kind === 'text') { if(d.append&&texts.length)texts[texts.length-1]+=d.text;else texts.push(d.text); if (onText) { try { onText(texts.join('\n\n')); } catch { /* ignore */ } } }
    else if (d.kind === 'error') err = d.text;
  }
  return {
    push(chunk) { buf += String(chunk); let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } },
    end() { if (buf) { line(buf); buf = ''; } },
    note, text: () => texts.join('\n\n').trim(), count: () => n, error: () => err
  };
}
module.exports = { describe, makeCollector };
