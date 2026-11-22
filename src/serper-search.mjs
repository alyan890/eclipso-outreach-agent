// Fixed HTTPS destination; keys never follow redirects or appear in errors.
import https from 'node:https';
import {publicEvidenceURL} from './qualification.mjs';
export async function serperSearch(apiKey,query){
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(apiKey??'')||typeof query!=='string'||query.length>500)throw new Error('SEARCH_CONFIGURATION_REQUIRED');
  const body=JSON.stringify({q:query,gl:'us',hl:'en',num:10});
  return new Promise((resolve,reject)=>{
    const req=https.request('https://google.serper.dev/search',{method:'POST',agent:false,headers:{'X-API-KEY':apiKey,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let size=0;const chunks=[];
      res.on('data',b=>{size+=b.length;if(size>250000)res.destroy(new Error('SEARCH_RESPONSE_TOO_LARGE'));else chunks.push(b);});
      res.on('error',()=>reject(new Error('SEARCH_TRANSPORT_FAILURE')));
      res.on('end',()=>{
        if(res.statusCode!==200){reject(new Error([401,403].includes(res.statusCode)?'SEARCH_ACCESS_REQUIRED':[402,429].includes(res.statusCode)?'SEARCH_QUOTA_OR_RATE_LIMIT':'SEARCH_PROVIDER_UNAVAILABLE'));return;}
        try{const data=JSON.parse(Buffer.concat(chunks));if(!Array.isArray(data.organic)&&!data.searchParameters)throw new Error();
          resolve((data.organic??[]).filter(r=>publicEvidenceURL(r.link)).slice(0,10).map(r=>({url:r.link,title:String(r.title??'').slice(0,180)})));
        }catch{reject(new Error('SEARCH_RESPONSE_INVALID'));}
      });
    });
    const timer=setTimeout(()=>req.destroy(new Error('SEARCH_TIMEOUT')),20000);req.on('close',()=>clearTimeout(timer));
    req.on('error',()=>reject(new Error('SEARCH_TRANSPORT_OUTCOME_UNKNOWN')));req.end(body);
  });
}
