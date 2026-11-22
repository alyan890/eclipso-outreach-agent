import {REVIEW_ENDPOINT,reviewIdentity} from './review-draft.mjs';
export function createDraftProvider({token,request=fetch}={}){
  return async payload=>{
    if(!/^[a-f0-9]{64}$/.test(token??''))throw new Error('DRAFT_CONNECTION_REQUIRED');
    const id=await reviewIdentity(payload.record);
    let response;try{response=await request(REVIEW_ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});}catch{throw new Error('DRAFT_PROVIDER_OUTCOME_UNKNOWN');}
    const text=await response.text();if(text.length>12000)throw new Error('DRAFT_RESPONSE_INVALID');
    let result;try{result=JSON.parse(text);}catch{throw new Error('DRAFT_RESPONSE_INVALID');}
    if(!response.ok)throw new Error(response.status===401?'DRAFT_ACCESS_REQUIRED':/^DRAFT_[A-Z_]+$/.test(result.reason??'')?result.reason:'DRAFT_PROVIDER_UNAVAILABLE');
    if(result.id!==id||result.sending_authorized!==false||!['running','held','draft_needs_review'].includes(result.status))throw new Error('DRAFT_RESPONSE_INVALID');
    return result;
  };
}
