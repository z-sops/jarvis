'use strict';
// Fixed official API destinations. Counts are policy capabilities, not model marketing claims.
const providers=Object.freeze({
 gemini:{count:'exact',catalog:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'},
 openai:{count:'exact',catalog:'https://api.openai.com/v1/models'},
 anthropic:{count:'exact',catalog:'https://api.anthropic.com/v1/models?limit=1000'},
 kimi:{count:'estimated',catalog:'https://api.moonshot.ai/v1/models',chat:'https://api.moonshot.ai/v1/chat/completions',estimate:'https://api.moonshot.ai/v1/tokenizers/estimate-token-count'},
 deepseek:{count:'unavailable',catalog:'https://api.deepseek.com/models',chat:'https://api.deepseek.com/chat/completions'},
 qwen:{count:'unavailable',catalog:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',chat:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'}
});
function get(provider){if(!Object.hasOwn(providers,provider))throw Error('Unsupported provider adapter.');return providers[provider];}
function headers(provider,key){get(provider);return {'Content-Type':'application/json',...(provider==='gemini'?{'x-goog-api-key':key}:provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key})};}
function requireExact(provider){if(get(provider).count!=='exact')throw Error('This provider has no verified exact pre-submission count adapter. Strict token/cost execution is refused; estimates are not budget evidence.');}
module.exports={providers,get,headers,requireExact};
