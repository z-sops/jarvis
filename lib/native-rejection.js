"use strict";
// Diagnostic data is fixed vocabulary, never arbitrary exception/request content.
const CODES = new Set(['request_too_large','invalid_json','model_id_mismatch','unsupported_request_field','unsupported_n','invalid_message_list','unsupported_message_role','non_string_content','unsupported_message_field','invalid_function_call','unsupported_tool_shape','unsupported_tool_choice','invalid_output_limit','invalid_sampling_option','client_metadata_missing','history_conflict','request_budget_exhausted','state_bound_reached','state_save_failed','run_aborted','unclassified_validation']);
const VALUES = new Set(['unknown_field','unknown_role','array','object','number','boolean','undefined','string_other','required','function','other','non_integer','zero_or_negative','out_of_range','not_finite','<=256K','<=512K','<=1M','>1M','model','messages','tools','tool_choice','stream','stream_options','metadata','user','parallel_tool_calls','max_completion_tokens','max_tokens','temperature','top_p','role','content','tool_calls','tool_call_id','name','id','arguments','type','user-agent','x-opencode-session','x-opencode-request']);
const KNOWN_REQUEST_FIELDS=new Set(['store','reasoning_effort','prompt_cache_key','safety_identifier','service_tier','stop','seed','frequency_penalty','presence_penalty','logit_bias','logprobs','top_logprobs','response_format','modalities','audio','prediction','web_search_options','verbosity','top_k','thinking','reasoning']);
const NUMBERS = new Set(['count','requestedLength','expectedLength','limit']);
const BOOLEANS = new Set(['sameWhenTrimmed','sameWhenLowercased','hasExtraKey']);
const STRINGS = new Set(['field','contentKind','kind','toolType','bytesBucket']);
function detail(value) {
 const out={}; if(!value||typeof value!=='object')return out;
 for(const [k,v] of Object.entries(value)){
  if(k==='unknownCount'&&Number.isSafeInteger(v)&&v>=0&&v<=20)out[k]=v;
  else if(k==='nameHash'&&typeof v==='string'&&/^[a-f0-9]{12}$/.test(v))out[k]=v;
  else if(k==='valueType'&&['string','number','boolean','object','array','null'].includes(v))out[k]=v;
  else if(k==='field'&&KNOWN_REQUEST_FIELDS.has(v))out[k]=v;
  else if(NUMBERS.has(k)&&Number.isSafeInteger(v)&&v>=0&&v<=1048577)out[k]=v;
  else if(BOOLEANS.has(k)&&typeof v==='boolean')out[k]=v;
  else if(STRINGS.has(k)&&VALUES.has(v))out[k]=v;
  else if(k==='missingHeaders'&&Array.isArray(v))out[k]=v.filter(x=>['user-agent','x-opencode-session','x-opencode-request'].includes(x)).slice(0,3);
 }
 return out;
}
class Reject extends Error {
 constructor(code,message,value){super(message);this.rejectCode=CODES.has(code)?code:'unclassified_validation';this.rejectDetail=detail(value);}
}
function diagnostic(e,step){return {rejectCode:CODES.has(e?.rejectCode)?e.rejectCode:e?.name==='AbortError'?'run_aborted':step==='reservation_save'?'state_save_failed':'unclassified_validation',rejectDetail:detail(e?.rejectDetail)};}
function requestField(body,fields){const name=fields[0],v=body[name];return {field:KNOWN_REQUEST_FIELDS.has(name)?name:'unknown_field',valueType:v===null?'null':Array.isArray(v)?'array':typeof v,unknownCount:Math.min(20,fields.length),nameHash:require('crypto').createHash('sha256').update(name).digest('hex').slice(0,12)};}
module.exports={Reject,diagnostic,requestField};
