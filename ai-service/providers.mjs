import {AskError,assert} from './core.mjs';
const MAX_RESPONSE_BYTES=128*1024;
async function responseJSON(fetchImpl,url,init,timeoutMS){
  let response;
  try{response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(timeoutMS)});}
  catch{throw new AskError('ai_unavailable','The AI provider did not finish. Your Sheet was not changed.',503);}
  assert(response.ok,'ai_unavailable',response.status===429?'The AI provider is busy. Try again shortly.':'The AI provider could not answer. Your Sheet was not changed.',response.status===429?429:502);
  const declared=Number(response.headers?.get('content-length')??0);
  assert(declared<=MAX_RESPONSE_BYTES,'answer_too_large','The AI response was too large to verify.',502);
  let text='';
  if(response.body){
    const reader=response.body.getReader();let size=0;const decoder=new TextDecoder();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new AskError('answer_too_large','The AI response was too large to verify.',502);}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
  }else{text=await response.text();assert(Buffer.byteLength(text)<=MAX_RESPONSE_BYTES,'answer_too_large','The AI response was too large to verify.',502);}
  try{return JSON.parse(text);}catch{throw new AskError('answer_unverified','The AI response could not be read. Please try a narrower question.',502);}
}
function parseOutput(text){
  assert(typeof text==='string'&&text.length<20000,'answer_unverified','The AI returned no complete answer.',502);
  try{return JSON.parse(text);}catch{throw new AskError('answer_unverified','The AI response did not match the expected format.',502);}
}
function configured(key,model){return typeof key==='string'&&key.length>0&&typeof model==='string'&&model.length>0&&model.length<=150&&!/[\s\u0000-\u001f]/.test(model);}
export function providersFromEnvironment({env=process.env,fetchImpl=fetch,timeoutMS=25000}={}){
  const providers={};
  if(configured(env.OPENAI_API_KEY,env.KITTY_OPENAI_MODEL))providers.openai={async generate({system,input,schema}){
    const result=await responseJSON(fetchImpl,'https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},
      body:JSON.stringify({model:env.KITTY_OPENAI_MODEL,store:false,max_output_tokens:1400,
        instructions:system,input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(input)}]}],
        text:{format:{type:'json_schema',name:'kitty_explanation',strict:true,schema}}})
    },timeoutMS);
    assert(result.status==='completed','answer_incomplete','The AI did not finish a complete answer. No records were changed.',502);
    const blocks=(result.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]);
    assert(!blocks.some(b=>b.type==='refusal'),'answer_refused','The AI could not answer that question. Try asking about a recorded figure.',422);
    return parseOutput(blocks.filter(b=>b.type==='output_text').map(b=>b.text??'').join(''));
  }};
  if(configured(env.ANTHROPIC_API_KEY,env.KITTY_CLAUDE_MODEL))providers.claude={async generate({system,input,schema}){
    const result=await responseJSON(fetchImpl,'https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':env.KITTY_ANTHROPIC_VERSION??'2026-10-21'},
      body:JSON.stringify({model:env.KITTY_CLAUDE_MODEL,max_tokens:1400,system,
        messages:[{role:'user',content:JSON.stringify(input)}],output_config:{format:{type:'json_schema',schema}}})
    },timeoutMS);
    assert(result.stop_reason==='end_turn','answer_incomplete','The AI did not finish a complete answer. No records were changed.',502);
    assert(!result.content?.some(b=>b.type==='refusal'),'answer_refused','The AI could not answer that question. Try asking about a recorded figure.',422);
    return parseOutput((result.content??[]).filter(b=>b.type==='text').map(b=>b.text??'').join(''));
  }};
  return providers;
}
