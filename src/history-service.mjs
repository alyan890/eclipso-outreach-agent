// Deploy only to the existing Supabase project. The platform's service key
// stays on that platform; the local caller receives a separate read-only token.
import {HISTORY_ENDPOINT,HISTORY_RPC,historyScope,validateHistorySnapshot} from './history-contract.mjs';
const sha=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
async function equalToken(received,expected){const [a,b]=await Promise.all([sha(received),sha(expected)]);let delta=0;for(let i=0;i<a.length;i++)delta|=a[i]^b[i];return delta===0;}
export function historyHandler({env,request=fetch,clock=()=>Date.now()}={}){
  return async req=>{
    const respond=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    if(req.method!=='POST')return respond({error:'METHOD_NOT_ALLOWED'},405);
    const secret=env('ECLIPSO_RESEARCH_HISTORY_SECRET');
    if(!/^[a-f0-9]{64}$/.test(secret??''))return respond({error:'HISTORY_NOT_CONFIGURED'},503);
    if(!(await equalToken(req.headers.get('authorization')??'','Bearer '+secret)))return respond({error:'UNAUTHORIZED'},401);
    if(!/^application\/json\b/i.test(req.headers.get('content-type')??''))return respond({error:'JSON_REQUIRED'},415);
    let input,scope;try{
      const reader=req.body?.getReader();if(!reader)throw new Error();const parts=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw new Error();}parts.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      input=JSON.parse(new TextDecoder().decode(bytes));scope=historyScope(input.records);
    }catch{return respond({error:'BOUNDED_HISTORY_SCOPE_REQUIRED'},400);}
    const project=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY');
    if(project!=='https://your-project-ref.supabase.co'||!service)return respond({error:'HISTORY_NOT_CONFIGURED'},503);
    try{
      const response=await request(project+'/rest/v1/rpc/'+HISTORY_RPC,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(scope)});
      if(!response.ok)throw new Error();const data=await response.json();
      const snapshot=validateHistorySnapshot({...data,source_url:HISTORY_ENDPOINT},scope,{now:clock()});
      return respond(snapshot);
    }catch{return respond({error:'COMPLETE_HISTORY_UNAVAILABLE'},503);}
  };
}
