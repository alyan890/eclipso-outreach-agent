import {researchCloudCopy,RESEARCH_SYNC_URL} from './research-sync.mjs';
export function createResearchSync({token,request=fetch}={}){
  return async snapshot=>{
    if(!/^[a-f0-9]{64}$/.test(token??''))throw new Error('RESEARCH_SYNC_KEY_REQUIRED');
    const body=JSON.stringify(researchCloudCopy(snapshot));
    let response;try{response=await request(RESEARCH_SYNC_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});}catch{throw new Error('RESEARCH_SYNC_UNAVAILABLE');}
    if(!response.ok)throw new Error(response.status===401?'RESEARCH_SYNC_ACCESS_REQUIRED':response.status===409?'RESEARCH_SYNC_NEWER_COPY_EXISTS':'RESEARCH_SYNC_UNAVAILABLE');
    const result=await response.json();if(result.status!=='RESEARCH_SYNCED'||result.sending_enabled!==false||result.collected_at!==snapshot.finished_at||!Number.isFinite(Date.parse(result.synced_at)))throw new Error('RESEARCH_SYNC_INVALID_RESPONSE');
    return {status:'CONNECTED',synced_at:result.synced_at,rows:result.rows};
  };
}
