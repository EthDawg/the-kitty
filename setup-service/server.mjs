import {SetupService,SetupError} from './core.mjs';
import {GoogleSetupDriver} from './google-rest.mjs';

const MAX_BODY=64*1024;
export function createSetupHandler({service=new SetupService({driver:new GoogleSetupDriver()})}={}){
  const buckets=new Map();
  return async function handleSetup(request,response){
    const url=new URL(request.url,'http://localhost');
    const match=url.pathname.match(/^\/v1\/setup\/([A-Za-z0-9_-]{10,100})\/(begin|continue|status|cancel)$/);
    if(!match&&url.pathname!=='/v1/setup/reserve')return false;
    response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,body)=>{response.writeHead(status);response.end(JSON.stringify(body));};
    try{
      if(request.headers.origin)throw new SetupError('origin_not_allowed','Browser requests are not enabled.',403);
      const token=request.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];if(!token)throw new SetupError('unauthorized','Connect Google to continue.',401);
      const isStatus=match?.[2]==='status';if(request.method!==(isStatus?'GET':'POST'))throw new SetupError('not_found','This endpoint does not exist.',404);
      const now=Date.now(),key=request.socket?.remoteAddress??'unknown',old=buckets.get(key);
      if(!old||now-old.start>=60000)buckets.set(key,{start:now,count:1});else if(++old.count>60)throw new SetupError('rate_limited','Too many setup requests. Check this saved setup again shortly.',429);
      if(buckets.size>10000)for(const [key,value]of buckets)if(now-value.start>=60000)buckets.delete(key);
      if(!isStatus&&!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new SetupError('invalid_json','Send a JSON setup request.',400);
      let bytes=0;const chunks=[];for await(const part of request){bytes+=part.length;if(bytes>MAX_BODY)throw new SetupError('body_too_large','The household setup exceeds the request limit.',413);chunks.push(part);}
      if(isStatus&&bytes)throw new SetupError('invalid_json','A status check must not contain a body.',400);
      let body={};if(bytes){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SetupError('invalid_json','The setup request could not be read.',400);}}
      if(!body||Array.isArray(body)||typeof body!=='object')throw new SetupError('invalid_json','The setup request must be a JSON object.',400);
      if(!match){send(200,await service.reserve(token,body));return true;}
      const [,,action]=match;
      const query=isStatus?{proposalDigest:url.searchParams.get('proposalDigest')}:body;
      send(200,await service[action](token,match[1],query));
    }catch(error){send(error instanceof SetupError?error.status:500,{error:{code:error instanceof SetupError?error.code:'setup_unavailable',message:error instanceof SetupError?error.message:'Setup could not be verified. Preserve the saved setup identity and check its status before trying again.'}});}
    return true;
  };
}
