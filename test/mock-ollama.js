'use strict';
// Tiny stand-in for Ollama, used only to test scripts/doctor.js. MOCK_MODE=good|thinker|notools
const http = require('http');
const mode = process.env.MOCK_MODE || 'good', port = +process.env.PORT || 11499;
http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
    const j = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/version') return j({ version: '0.23.2' });
    if (req.url === '/api/tags') return j({ models: [{ name: 'qwen2.5-coder:7b', size: 4.7e9, details: { parameter_size: '7B' } }] });
    if (req.url === '/api/ps') return j({ models: [{ name: 'qwen2.5-coder:7b', context_length: mode === 'thinker' ? 4096 : 65536 }] });
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(b || '{}');
      if (body.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'); return setTimeout(() => res.end('data: [DONE]\n\n'), 200); }
      if (mode === 'thinker' && body.max_tokens < 100) return j({ choices: [{ finish_reason: 'length', message: { content: '' } }] });
      if (body.tools && body.tools.length === 1 && mode !== 'notools') return j({ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"Karachi"}' } }] } }] });
      return j({ choices: [{ finish_reason: 'stop', message: { content: mode === 'notools' ? 'It is probably hot in Karachi.' : 'Hello there.' } }] });
    }
    j({ error: 'nope' }, 404);
  });
}).listen(port, '127.0.0.1', () => console.log('mock ollama on', port, mode));
