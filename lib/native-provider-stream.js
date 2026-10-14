'use strict';
// Bounded Chat Completions SSE assembly. Tool deltas are not delivered before approval/state publication.
async function readCompletion(response,{signal,maxBytes=1024*1024}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',bytes=0,done=false,finish=null,usage=null,content='',role=null,id='';const tools=new Map();
 function event(raw){
  if(!raw.trim())return;const lines=raw.split(/\r?\n/),data=[];
  for(const line of lines){if(line.startsWith('data:'))data.push(line.slice(5).trimStart());else if(line&&!line.startsWith(':')&&!line.startsWith('event:'))throw Error('Unsupported provider SSE field.');}
  if(!data.length)return;const value=data.join('\n');if(done)throw Error('Provider SSE data after settlement.');
  if(value==='[DONE]'){done=true;return;}
  const p=JSON.parse(value);if(p.error)throw Error('Provider SSE refused completion.');
  if(typeof p.id==='string'){if(p.id.length>256||id&&id!==p.id)throw Error('Provider SSE identity changed.');id=p.id;}
  if(p.usage!=null){if(usage)throw Error('Duplicate provider usage.');usage=p.usage;}
  if(!Array.isArray(p.choices)||p.choices.length>1)throw Error('Unsupported provider stream candidate.');
  for(const c of p.choices){
   if(c.index!==0||finish!==null)throw Error('Provider SSE candidate changed after finish.');
   const d=c.delta||{};if(Object.keys(d).some(k=>!['role','content','tool_calls'].includes(k)))throw Error('Unsupported private/reasoning stream delta.');
   if(d.role!==undefined){if(d.role!=='assistant'||role&&role!==d.role)throw Error('Invalid streamed assistant role.');role=d.role;}
   if(d.content!=null){if(typeof d.content!=='string')throw Error('Unsupported streamed content.');content+=d.content;}
   for(const t of d.tool_calls||[]){
    if(!Number.isSafeInteger(t.index)||t.index<0||t.index>=64)throw Error('Streamed tool index bound.');
    const prior=tools.get(t.index)||{id:'',type:'function',function:{name:'',arguments:''}};
    if(t.type!==undefined&&t.type!=='function'||t.id!==undefined&&(typeof t.id!=='string'||prior.id&&prior.id!==t.id))throw Error('Streamed tool identity changed.');
    if(t.id!==undefined)prior.id=t.id;
    if(t.function?.name!==undefined){if(typeof t.function.name!=='string')throw Error('Invalid streamed tool name.');prior.function.name+=t.function.name;}
    if(t.function?.arguments!==undefined){if(typeof t.function.arguments!=='string')throw Error('Invalid streamed tool arguments.');prior.function.arguments+=t.function.arguments;}
    tools.set(t.index,prior);
   }
   if(c.finish_reason!=null)finish=c.finish_reason;
  }
 }
 try{
  for await(const chunk of response.body){signal?.throwIfAborted();bytes+=chunk.length;if(bytes>maxBytes)throw Error('Provider stream byte bound.');buffer+=decoder.decode(chunk,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(buffer))){event(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}}
  buffer+=decoder.decode();if(buffer.trim())event(buffer);signal?.throwIfAborted();
  if(!done||!['stop','tool_calls'].includes(finish)||role!=='assistant'||!usage)throw Error('Provider stream ended without complete usage/finish evidence.');
  const indexes=[...tools.keys()].sort((a,b)=>a-b);if(indexes.some((x,i)=>x!==i))throw Error('Provider streamed tool indexes are discontinuous.');
  return {id,choices:[{index:0,finish_reason:finish,message:{role:'assistant',content:content||null,...(tools.size?{tool_calls:indexes.map(i=>tools.get(i))}:{})}}],usage};
 }catch{throw Error('Provider stream is incomplete or unsupported; submission outcome remains protected.');}
}
module.exports={readCompletion};
