import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createImportHandler} from '../import-service/server.mjs';
import {createAskHandler} from '../ai-service/server.mjs';

// Exactly one instance owns the import queue. Do not cluster or autoscale this gateway.
export function createServer({importService,askService}={}) {
  const imports=createImportHandler(importService?{service:importService}:{});
  const ask=createAskHandler(askService?{service:askService}:{});
  const server=http.createServer(async(request,response)=>{
    const send=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body));};
    try {
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname==='/health' && request.method==='GET'){send(200,{status:'ok'});return;}
      // Dispatch before reading a byte. Each handler owns only its own body and errors.
      if(pathname.startsWith('/v1/imports/') && await imports(request,response))return;
      if((pathname==='/v1/ask'||pathname.startsWith('/v1/ask/')) && await ask(request,response))return;
      send(404,{error:{code:'not_found',message:'This endpoint does not exist.'}});
    }catch{
      // No request bodies, credentials or provider diagnostics enter logs/responses.
      if(!response.headersSent)send(500,{error:{code:'internal_error',message:'The request could not be completed. Check its status before retrying.'}});
      else response.destroy();
    }
  });
  server.requestTimeout=45000;server.headersTimeout=10000;return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const host=process.env.KITTY_SERVICE_HOST??'127.0.0.1';
  const port=Number(process.env.KITTY_SERVICE_PORT??process.env.PORT??8787);
  createServer().listen(port,host,()=>process.stdout.write(`Kitty service listening on ${host}:${port}\n`));
}
