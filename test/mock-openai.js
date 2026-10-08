'use strict';
// A scripted OpenAI-compatible model used to test Hermes end to end without any real API key.
// First turn it asks Hermes to run a shell command, second turn it reports the result.
const http = require('http');
const port = +process.env.PORT || 11500;
const CMD = process.env.MOCK_CMD || 'echo hello-from-crew > proof.txt';
const log = o => console.log('MOCK ' + JSON.stringify(o));
http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
    const json = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && /\/models/.test(req.url)) return json({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] });
    if (!/chat\/completions/.test(req.url)) { log({ probe404: req.url }); return json({ error: 'not found' }, 404); }
    const body = JSON.parse(b || '{}'); const msgs = body.messages || [];
    const hasToolResult = msgs.some(m => m.role === 'tool');
    const tools = (body.tools || []).map(t => t.function && t.function.name);
    log({ chat: true, stream: !!body.stream, model: body.model, messages: msgs.length, toolCount: tools.length, hasTerminal: tools.includes('terminal'), firstUser: String((msgs.filter(m => m.role === 'user').pop() || {}).content || '').slice(0, 80) });
    const lastUser = String((msgs.filter(m => m.role === 'user').pop() || {}).content || '');
    const echo = /exactly the single word:\s*(\w+)/i.exec(lastUser);
    const wantTool = !echo && !hasToolResult && tools.includes('terminal');
    const message = echo ? { role: 'assistant', content: echo[1] } : wantTool
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: CMD }) } }] }
      : { role: 'assistant', content: hasToolResult ? 'Done. I created proof.txt in my workspace.' : 'Hello from the mock model.' };
    const finish = wantTool ? 'tool_calls' : 'stop';
    if (!body.stream) return json({ id: 'x', object: 'chat.completion', model: 'mock-model', choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, fr) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'mock-model', choices: [{ index: 0, delta, finish_reason: fr || null }] }) + '\n\n');
    if (wantTool) chunk({ role: 'assistant', tool_calls: message.tool_calls.map((t, i) => ({ index: i, ...t })) }); else { chunk({ role: 'assistant', content: '' }); chunk({ content: message.content }); }
    chunk({}, finish); res.write('data: [DONE]\n\n'); res.end();
  });
}).listen(port, '127.0.0.1', () => console.log('MOCK listening', port));
