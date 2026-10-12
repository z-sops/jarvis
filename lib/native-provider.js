'use strict';
// Strict text/function adapter. Ask the provider to count the complete upstream input.
const crypto = require('crypto');
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function validate(body) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 500) throw Error('Native broker requires bounded chat messages.');
  const allowed = new Set(['model','messages','tools','tool_choice','stream','stream_options','max_tokens','max_completion_tokens','temperature','top_p','parallel_tool_calls','n','user','metadata']);
  if (Object.keys(body).some(k => !allowed.has(k)) || body.n && body.n !== 1) throw Error('Unsupported native request feature; no upstream submission.');
  for (const m of body.messages) {
    if (!['system','developer','user','assistant','tool'].includes(m.role) || m.content != null && typeof m.content !== 'string') throw Error('Native broker currently supports text/function messages only.');
    if (Object.keys(m).some(k => !['role','content','tool_calls','tool_call_id','name'].includes(k))) throw Error('Unsupported native message field.');
    for (const c of m.tool_calls || []) if (c.type !== 'function' || !c.id || typeof c.function?.name !== 'string' || typeof c.function?.arguments !== 'string') throw Error('Invalid native function call.');
  }
  for (const t of body.tools || []) if (t.type !== 'function' || !t.function?.name || Object.keys(t).some(k => !['type','function'].includes(k))) throw Error('Unpriced native provider tools are unsupported.');
  if (body.tool_choice && !['auto','none'].includes(body.tool_choice)) throw Error('Unsupported forced native tool choice.');
  for (const k of ['max_tokens','max_completion_tokens']) if (body[k] !== undefined && (!Number.isSafeInteger(body[k]) || body[k] < 1)) throw Error('Invalid native output limit.');
  for (const k of ['temperature','top_p']) if (body[k] !== undefined && (!Number.isFinite(body[k]) || body[k] < 0 || body[k] > (k === 'top_p' ? 1 : 2))) throw Error('Invalid native sampling option.');
}
function prepare(provider, model, body, output, parts = {}) {
  validate(body);
  output = Math.min(output, body.max_completion_tokens ?? body.max_tokens ?? output);
  const sampling = Object.fromEntries(['temperature','top_p'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]]));
  const system = body.messages.filter(m => ['system','developer'].includes(m.role)).map(m => m.content || '').join('\n');
  const messages = body.messages.filter(m => !['system','developer'].includes(m.role));
  const names = new Map();
  for (const m of messages) for (const c of m.tool_calls || []) names.set(c.id, c.function.name);
  const tools = (body.tools || []).map(t => ({ ...t.function }));
  if (provider === 'gemini') {
    const contents = messages.map(m => {
      if (m.role === 'assistant' && parts[digest(m)]) return { role: 'model', parts: parts[digest(m)] };
      const p = m.content ? [{ text: m.content }] : [];
      for (const c of m.tool_calls || []) p.push({ functionCall: { id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments) } });
      if (m.role === 'tool') { const name = names.get(m.tool_call_id); if (!name) throw Error('Native tool response has no matching call.'); return { role: 'user', parts: [{ functionResponse: { id: m.tool_call_id, name, response: { output: m.content || '' } } }] }; }
      if (!p.length) p.push({ text: '' });
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: p };
    });
    const request = { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), generationConfig: { maxOutputTokens: output, candidateCount: 1 } };
    for (const k of ['temperature','top_p']) if (body[k] !== undefined) request.generationConfig[k === 'top_p' ? 'topP' : k] = body[k];
    if (tools.length) request.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description || '', parametersJsonSchema: t.parameters || { type: 'object', properties: {} } })) }];
    if (body.tool_choice === 'none') request.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    const base = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model);
    return { countUrl: base + ':countTokens', countBody: { generateContentRequest: { ...request, model: 'models/' + model } }, url: base + ':generateContent', body: request };
  }
  if (provider === 'openai') {
    const input = [];
    for (const m of messages) {
      if (m.role === 'assistant' && parts[digest(m)]) { input.push(...parts[digest(m)]); continue; }
      if (m.role === 'tool') { if (!names.has(m.tool_call_id)) throw Error('Native tool response has no matching call.'); input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content || '' }); continue; }
      if (m.content) input.push({ role: m.role, content: m.content });
      for (const c of m.tool_calls || []) input.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments });
    }
    const steering = { model, input, ...(system ? { instructions: system } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', ...t, strict: false })), tool_choice: body.tool_choice || 'auto' } : {}) };
    return { countUrl: 'https://api.openai.com/v1/responses/input_tokens', countBody: steering, url: 'https://api.openai.com/v1/responses', body: { ...steering, ...sampling, max_output_tokens: output, store: false, include: ['reasoning.encrypted_content'] } };
  }
  if (provider === 'anthropic') {
    const input = messages.map(m=>{
      if(m.role==='assistant'&&parts[digest(m)])return {role:'assistant',content:parts[digest(m)]};
      if(m.role==='tool'){if(!names.has(m.tool_call_id))throw Error('Native tool response has no matching call.');return {role:'user',content:[{type:'tool_result',tool_use_id:m.tool_call_id,content:m.content||''}]};}
      const content=m.content?[{type:'text',text:m.content}]:[];
      for(const c of m.tool_calls||[])content.push({type:'tool_use',id:c.id,name:c.function.name,input:JSON.parse(c.function.arguments)});
      if(!content.length)throw Error('Empty Anthropic native message.');return {role:m.role,content};
    });
    const steering={model,messages:input,...(system?{system}:{}),...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description||'',input_schema:t.parameters||{type:'object',properties:{}}})),tool_choice:{type:body.tool_choice==='none'?'none':'auto'}}:{})};
    return {countUrl:'https://api.anthropic.com/v1/messages/count_tokens',countBody:steering,url:'https://api.anthropic.com/v1/messages',body:{...steering,...sampling,max_tokens:output}};
  }
  const spec=require('./provider-registry').get(provider);
  // Only the owner's documented Chat Completions model is admitted here. Other
  // gateway models can require Responses/Messages; names are not protocol proof.
  if(provider==='opencode' && model!=='space-bunny-free')throw Error('OpenCode gateway adapter currently supports only space-bunny-free Chat Completions; other model protocols are unverified.');
  const request={model,messages:body.messages.map(m=>({...m})),max_tokens:output,stream:false,...sampling,...(tools.length?{tools:body.tools,tool_choice:body.tool_choice||'auto'}:{})};
  return {url:spec.chat,body:request,countQuality:spec.count,countUrl:null,countBody:null};
}
function decode(provider, data) {
  let raw, text = '', calls = [], usage;
  if (provider === 'gemini') {
    if (data.candidates?.length !== 1 || !data.candidates[0].content?.parts) throw Error('Provider returned no supported candidate.');
    raw = data.candidates[0].content.parts;
    for (const p of raw) { if (p.text && !p.thought) text += p.text; if (p.functionCall) calls.push({ id: p.functionCall.id || 'call_' + crypto.randomUUID(), type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }); }
    // Ensure generated identifiers also survive Gemini's next function-response request.
    let index = 0; for (const p of raw) if (p.functionCall) p.functionCall.id = calls[index++].id;
    usage = data.usageMetadata;
  } else if (provider === 'openai') {
    if (!Array.isArray(data.output) || data.status !== 'completed') throw Error('Provider response did not complete.');
    raw = data.output;
    for (const p of raw) { if (p.type === 'message') for (const c of p.content || []) if (c.type === 'output_text') text += c.text; if (p.type === 'function_call') calls.push({ id: p.call_id, type: 'function', function: { name: p.name, arguments: p.arguments } }); }
    usage = { promptTokenCount: data.usage?.input_tokens, candidatesTokenCount: data.usage?.output_tokens }; // Responses output already includes reasoning.
  } else if(provider==='opencode') {
    const choice=data.choices?.[0],m=choice?.message;
    if(data.choices?.length!==1||!['stop','tool_calls'].includes(choice?.finish_reason)||m?.role!=='assistant'||m.content!=null&&typeof m.content!=='string')throw Error('OpenCode gateway response is incomplete or unsupported.');
    calls=m.tool_calls||[];
    if(!Array.isArray(calls)||calls.length>64||choice.finish_reason==='tool_calls'&&!calls.length||choice.finish_reason==='stop'&&calls.length)throw Error('Invalid OpenCode gateway tool completion.');
    const ids=new Set();
    for(const c of calls){
      if(c?.type!=='function'||typeof c.id!=='string'||!c.id||c.id.length>200||ids.has(c.id)||typeof c.function?.name!=='string'||!c.function.name||typeof c.function?.arguments!=='string')throw Error('Invalid OpenCode gateway function call.');
      ids.add(c.id);const args=JSON.parse(c.function.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid OpenCode gateway function arguments.');
    }
    if(!calls.length&&!m.content)throw Error('OpenCode gateway returned no text or function call.');
    if(![data.usage?.prompt_tokens,data.usage?.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('OpenCode gateway usage metadata is unavailable.');
    calls=calls.map(c=>({id:c.id,type:'function',function:{name:c.function.name,arguments:c.function.arguments}}));
    raw=[m];text=m.content||'';usage={promptTokenCount:data.usage.prompt_tokens,candidatesTokenCount:data.usage.completion_tokens};
  } else if(['kimi','qwen','deepseek'].includes(provider)) {
    if(data.choices?.length!==1||data.choices[0].finish_reason!=='stop'||data.choices[0].message?.tool_calls?.length)throw Error('Compatible discussion response incomplete or attempted tool actions.');
    const m=data.choices[0].message;if(m?.role!=='assistant'||typeof m.content!=='string')throw Error('Invalid compatible text response.');
    raw=[m];text=m.content;usage={promptTokenCount:data.usage?.prompt_tokens,candidatesTokenCount:data.usage?.completion_tokens};
  } else if(provider==='anthropic') {
    if(data.type!=='message'||!Array.isArray(data.content))throw Error('Anthropic returned no supported message.');
    if(data.usage?.cache_creation_input_tokens)throw Error('Unpriced Anthropic cache-write billing is unsupported.');
    raw=data.content;
    for(const p of raw){if(p.type==='text')text+=p.text;if(p.type==='tool_use')calls.push({id:p.id,type:'function',function:{name:p.name,arguments:JSON.stringify(p.input)}});}
    usage={promptTokenCount:Number.isSafeInteger(data.usage?.input_tokens)?data.usage.input_tokens+(data.usage.cache_read_input_tokens||0):undefined,candidatesTokenCount:data.usage?.output_tokens};
  }
  if(!['gemini','openai','anthropic','kimi','qwen','deepseek','opencode'].includes(provider))throw Error('Unsupported response adapter.');
  const message = { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) };
  return { message, raw, usage, key: digest(message) };
}
module.exports = { prepare, decode, digest, validate };
