import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { ImportService, ImportError } from './core.mjs';
import { GoogleDriver } from './google-rest.mjs';
import { auditSources } from './source-audit.mjs';
const MAX_BODY=12*1024*1024;
export function createImportHandler({service=new ImportService({driver:new GoogleDriver(),auditSources})}={}) {
  const buckets=new Map();
  return async function handleImport(request,response) {
    const url=new URL(request.url,'http://localhost');
    const match=url.pathname.match(/^\/v1\/imports\/([A-Za-z0-9_-]{10,200})\/(commit|status|cancel)$/);
    if(!match && !['/health','/v1/imports/prepare','/v1/imports/provenance'].includes(url.pathname))return false;
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,payload)=>{response.writeHead(status);response.end(JSON.stringify(payload));};
    try {
      if(request.method==='GET' && url.pathname==='/health'){send(200,{status:'ok'});return true;}
      // This is a native app API. Do not expose bearer-auth financial endpoints to arbitrary web origins.
      if(request.headers.origin)throw new ImportError('origin_not_allowed','Browser requests are not enabled.',403);
      const bearer=request.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
      if(!bearer)throw new ImportError('unauthorized','Connect Google to continue.',401);
      const now=Date.now(),key=request.socket.remoteAddress??'unknown';
      const bucket=buckets.get(key);
      if(!bucket || now-bucket.start>60000)buckets.set(key,{start:now,count:1});
      else if(++bucket.count>60)throw new ImportError('rate_limited','Too many requests. Try again shortly.',429);
      if(buckets.size>10000)for(const [k,b] of buckets)if(now-b.start>60000)buckets.delete(k);
      let bytes=0,parts=[];
      for await(const part of request){bytes+=part.length;if(bytes>MAX_BODY)throw new ImportError('body_too_large','Import fewer or smaller files.',413);parts.push(part);}
      let body={};
      if(parts.length){try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new ImportError('invalid_json','The import request could not be read.');}}
      if(!body || Array.isArray(body) || typeof body!=='object')throw new ImportError('invalid_json','The request must be a JSON object.');
      if(request.method==='POST' && url.pathname==='/v1/imports/prepare'){send(200,await service.prepare(bearer,body));return true;}
      if(request.method==='GET' && url.pathname==='/v1/imports/provenance'){send(200,await service.provenance(bearer,{sheetId:url.searchParams.get('sheetId'),...(url.searchParams.has('protocolVersion')?{protocolVersion:Number(url.searchParams.get('protocolVersion'))}:{}),...(url.searchParams.has('periodEnd')?{periodEnd:url.searchParams.get('periodEnd')}:{})}));return true;}
      if(match && match[2]==='commit' && request.method==='POST'){send(200,await service.commit(bearer,match[1],body));return true;}
      if(match && match[2]==='cancel' && request.method==='POST'){send(200,await service.cancel(bearer,match[1],body));return true;}
      if(match && match[2]==='status' && request.method==='GET'){send(200,await service.status(bearer,match[1],{sheetId:url.searchParams.get('sheetId')}));return true;}
      throw new ImportError('not_found','This endpoint does not exist.',404);
    }catch(error){send(error instanceof ImportError?error.status:500,{error:{code:error instanceof ImportError?error.code:'internal_error',message:error instanceof ImportError?error.message:'The import could not be completed. Your existing records have not been confirmed changed.',...(error instanceof ImportError && error.recovery?{recovery:error.recovery}:{}),...(error instanceof ImportError && error.issues?{issues:error.issues}:{})}});}
    return true;
  };
}
export function createServer(options={}) {
  const handler=createImportHandler(options);
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'not_found',message:'This endpoint does not exist.'}}));}});
  server.requestTimeout=45000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.KITTY_IMPORT_PORT??8787);
  const host=process.env.KITTY_IMPORT_HOST??'127.0.0.1';
  const server=createServer();
  server.requestTimeout=45000;server.headersTimeout=10000;
  server.listen(port,host,()=>process.stdout.write(`Kitty import service listening on ${host}:${port}\n`));
}
