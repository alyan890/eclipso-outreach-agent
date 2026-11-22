import {HISTORY_ENDPOINT,historyScope,validateHistorySnapshot} from './history-contract.mjs';
export function createHistoryReader({token,request=fetch,clock=()=>Date.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const cache=new Map();let blockedUntil=0;
  return async(records,{fresh=false}={})=>{
    if(!/^[a-f0-9]{64}$/.test(token??''))throw new Error('HISTORY_CONNECTION_REQUIRED');
    const scope=historyScope(records),key=JSON.stringify(scope),prior=cache.get(key),now=clock();
    if(!fresh&&prior&&now-prior.receivedAt<15*60000)return validateHistorySnapshot(prior.snapshot,scope,{now});
    if(now<blockedUntil)throw new Error('HISTORY_CONNECTION_COOLDOWN');
    try{
      const response=await request(HISTORY_ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({records:records.map(r=>({lead_id:r.lead_id,business_name:r.business_name,public_email:r.public_email}))})});
      if(!response.ok)throw new Error([401,403].includes(response.status)?'HISTORY_ACCESS_REQUIRED':response.status===429?'HISTORY_RATE_LIMIT':'HISTORY_SOURCE_UNAVAILABLE');
      if(Number(response.headers.get('content-length')??0)>256000)throw new Error('HISTORY_RESPONSE_INVALID');
      const reader=response.body.getReader(),parts=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw new Error('HISTORY_RESPONSE_INVALID');}parts.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      const value=JSON.parse(new TextDecoder().decode(bytes));
      // A slightly slow PC clock must not reject a valid server observation.
      // Wait at most five seconds for the actual timestamp, then apply the
      // unchanged contract. Never rewrite evidence or accept a future result.
      const ahead=Date.parse(value?.observed_at)-clock();
      if(ahead>5000)throw new Error('HISTORY_RESPONSE_INVALID');
      if(ahead>0)await wait(Math.ceil(ahead)+1);
      const snapshot=validateHistorySnapshot(value,scope,{now:clock()});
      if(Date.parse(snapshot.observed_at)>clock())throw new Error('HISTORY_RESPONSE_INVALID');
      cache.set(key,{snapshot,receivedAt:clock()});if(cache.size>50)cache.delete(cache.keys().next().value);return snapshot;
    }catch(error){blockedUntil=clock()+5*60000;const safe=['HISTORY_ACCESS_REQUIRED','HISTORY_RATE_LIMIT','HISTORY_SOURCE_UNAVAILABLE','HISTORY_RESPONSE_INVALID','HISTORY_SCOPE_MISMATCH'];throw new Error(safe.includes(error.message)?error.message:'HISTORY_SOURCE_UNAVAILABLE');}
  };
}
