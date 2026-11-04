import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {AskService,AskError} from './core.mjs';
import {GoogleFactsReader} from './google-facts.mjs';
import {providersFromEnvironment} from './providers.mjs';

const MAX_BODY=16*1024;
export function createAskHandler({service=new AskService({reader:new GoogleFactsReader(),providers:providersFromEnvironment(),previewSecret:process.env.KITTY_AI_PREVIEW_SECRET})}={}){
  const buckets=new Map();
  return async function handleAsk(request,response){
    const url=new URL(request.url,'http://localhost');
    if(!['/v1/ask','/v1/ask/preview','/v1/ask/capabilities','/health'].includes(url.pathname))return false;
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,payload)=>{response.writeHead(status);response.end(JSON.stringify(payload));};
    try{
      if(url.pathname==='/health'&&request.method==='GET'){send(200,{status:'ok'});return true;}
      if(request.headers.origin)throw new AskError('origin_not_allowed','Browser requests are not enabled.',403);
      const token=request.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
      if(!token)throw new AskError('unauthorized','Connect Google before asking.',401);
      const now=Date.now(),ip=request.socket.remoteAddress??'unknown';const bucket=buckets.get(ip);
      if(!bucket||now-bucket.at>=60000)buckets.set(ip,{at:now,count:1});
      else if(++bucket.count>12)throw new AskError('rate_limited','Please wait a moment before asking again.',429);
      if(buckets.size>10000)for(const[key,value]of buckets)if(now-value.at>=60000)buckets.delete(key);
      if(url.pathname==='/v1/ask/capabilities'&&request.method==='GET'){send(200,service.capabilities());return true;}
      if(request.method!=='POST')throw new AskError('method_not_allowed','Use POST for this operation.',405);
      if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new AskError('invalid_content_type','Send a JSON question.',415);
      const declared=Number(request.headers['content-length']??0);
      if(declared>MAX_BODY)throw new AskError('body_too_large','Ask a shorter question.',413);
      let bytes=0;const chunks=[];
      for await(const part of request){bytes+=part.length;if(bytes>MAX_BODY)throw new AskError('body_too_large','Ask a shorter question.',413);chunks.push(part);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AskError('invalid_json','The question could not be read.');}
      send(200,url.pathname==='/v1/ask/preview'?await service.preview(token,body):await service.ask(token,body));
    }catch(error){
      // Never log request bodies, bearer tokens, provider responses or secrets. Do not echo unknown errors.
      send(error instanceof AskError?error.status:500,{error:{code:error instanceof AskError?error.code:'internal_error',message:error instanceof AskError?error.message:'The answer could not be verified. Your Sheet was not changed.'}});
    }
    return true;
  };
}
export function createServer(options={}){
  const handler=createAskHandler(options);
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'not_found',message:'This endpoint does not exist.'}}));}});
  server.requestTimeout=45000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const host=process.env.KITTY_AI_HOST??'127.0.0.1',port=Number(process.env.KITTY_AI_PORT??8788);
  createServer().listen(port,host,()=>process.stdout.write(`Kitty Ask service listening on ${host}:${port}\n`));
}
