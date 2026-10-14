'use strict';
// Metadata only. This helper never changes the history matching contract.
const {detail}=require('./native-rejection');
const stable=require('./job-guidance').stable;
const bucket=n=>n===0?'0':n<=256?'1-256':n<=4096?'257-4096':'>4096';
const kind=m=>m?.content==null?'null':m.content===''?'empty':'text';
function historyDetail(prefix,incoming,historySite){
 const differences=[];let firstDiffIndex;
 for(let i=0;i<prefix.length;i++){
  const a=prefix[i],b=incoming[i],diffFields=[];
  if(a?.role!==b?.role)diffFields.push('role');
  if((a?.content??null)!==(b?.content??null))diffFields.push('content');
  if(a?.tool_call_id!==b?.tool_call_id)diffFields.push('tool_call_id');
  const ac=a?.tool_calls||[],bc=b?.tool_calls||[];
  if(ac.length!==bc.length)diffFields.push('tool_calls_count');
  for(const [name,get] of [['tool_call_id_value',c=>c?.id],['tool_call_type',c=>c?.type],['tool_call_name',c=>c?.function?.name],['tool_call_arguments',c=>c?.function?.arguments===undefined?undefined:stable(JSON.parse(c.function.arguments))]]){
   if(ac.some((c,j)=>get(c)!==get(bc[j])))diffFields.push(name);
  }
  if(!diffFields.length)continue;
  firstDiffIndex??=i;
  if(i<10)differences.push({messageIndex:i,diffFields:diffFields.slice(0,6),rolePrefix:a?.role,roleIncoming:b?.role,contentKindPrefix:kind(a),contentKindIncoming:kind(b),contentLengthBucketPrefix:bucket(typeof a?.content==='string'?Buffer.byteLength(a.content):0),contentLengthBucketIncoming:bucket(typeof b?.content==='string'?Buffer.byteLength(b.content):0)});
 }
 return detail({historySite,prefixLength:prefix.length,incomingLength:incoming.length,...(firstDiffIndex!==undefined?{firstDiffIndex}:{}),...(differences[0]||{}),differences});
}
module.exports={historyDetail};
