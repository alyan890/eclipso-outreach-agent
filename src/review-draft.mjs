// Real-business writing endpoint; no mailbox or production DB credentials.
import {evidenceSubject} from './qualification.mjs';
import {prepareDraftHandoff} from './draft-handoff.mjs';
export const REVIEW_MODEL='@cf/google/gemma-4-26b-a4b-it';
export const REVIEW_ENDPOINT='https://your-worker.example.workers.dev/review-draft';
export const REVIEW_PILOT_LIMIT=5;
const reviewHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function reviewIdentity(record){return 'review-v1:'+await reviewHash(JSON.stringify(evidenceSubject(record)));}
export function reviewInput(handoff){
  const facts=JSON.parse(handoff.job.request.messages[1].content);
  facts.untrusted_observations=facts.untrusted_observations.filter(e=>e.kind!=='CONTACT').map(e=>({...e,observation:e.observation.replace(/[^\s@]+@[^\s@]+/g,'[business contact omitted]')}));
  // Keep this short writing task from spending its completion budget on
  // internal thinking. Cloudflare documents this Gemma-specific setting.
  return {...handoff.job.request,chat_template_kwargs:{enable_thinking:false},messages:[handoff.job.request.messages[0],{role:'user',content:JSON.stringify(facts)}]};
}
export function validateReviewDraft(output,handoff){
  const choice=output?.choices?.[0];
  if(choice?.finish_reason==='length')throw new Error('DRAFT_COMPLETION_TRUNCATED');
  if(choice&&choice.finish_reason!=='stop'||choice?.message?.tool_calls?.length)throw new Error('DRAFT_COMPLETION_INVALID');
  let value=choice?.message?.content??output?.response;
  if(typeof value==='string'){
    if(value.length>6000)throw new Error('DRAFT_RESPONSE_INVALID');
    try{value=JSON.parse(value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw new Error('DRAFT_JSON_INVALID');}
  }
  if(!value||typeof value.subject!=='string'||typeof value.body!=='string'||value.subject.length<3||value.subject.length>120||/[\r\n]/.test(value.subject)||value.body.trim().split(/\s+/).length>=80||value.body.length<70||value.body.length>1800||!Array.isArray(value.evidence_ids)||!value.evidence_ids.length)throw new Error('DRAFT_RESPONSE_INVALID');
  if(!/Eclipso Digital/i.test(value.body)||!value.body.trim().endsWith('?')||/https?:|www\.|\b\w+@\w+\.\w+|\$|€|£|\b(?:guarantee\w*|guaranteed|rank #?1|increase (?:your )?(?:sales|leads)|award[- ]winning|certified|trusted by|we(?:'ve| have) helped|limited.time|urgent|based in|headquarters|patient records)\b/i.test(value.subject+' '+value.body))throw new Error('DRAFT_UNSUPPORTED_COPY');
  const selected=JSON.parse(handoff.job.request.messages[1].content).untrusted_observations;
  const gapIDs=selected.filter(e=>e.kind==='WEBSITE_GAP').map(e=>e.id);
  if(value.evidence_ids.some(id=>!handoff.job.evidence_ids.includes(id))||!value.evidence_ids.some(id=>gapIDs.includes(id)))throw new Error('DRAFT_EVIDENCE_INVALID');
  if(handoff.job.service==='WEBSITE'&&(/(?:no|without|missing|lack(?:s|ing)?)\s+(?:an?\s+)?(?:online\s+)?(?:booking|ordering|appointment|reservation)/i.test(value.body)))throw new Error('DRAFT_UNSUPPORTED_COPY');
  if(selected.some(e=>e.gap==='PLACEHOLDER_SITE')&&!/coming.soon|under construction|placeholder|unfinished|finish(?:ing)? (?:your |the )?(?:web)?site/i.test(value.body))throw new Error('DRAFT_GAP_NOT_REFERENCED');
  return {subject:value.subject.trim(),body:value.body.trim(),evidence_ids:[...new Set(value.evidence_ids)],review_required:true,sending_authorized:false};
}
const reviewSchema=`CREATE TABLE IF NOT EXISTS m3_draft_reviews (
 id TEXT PRIMARY KEY,utc_day TEXT NOT NULL,lead_id TEXT NOT NULL,status TEXT NOT NULL,
 started_at TEXT NOT NULL,finished_at TEXT,reason TEXT,draft_json TEXT,evidence_fingerprint TEXT NOT NULL,
 sending_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sending_enabled=0))`;
export async function reviewFetch(req,env){
  const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  const secret=env.DRAFT_REVIEW_SECRET;
  if(env.DRAFT_REVIEW_ENABLED!=='true'||env.FREE_PLAN_CONFIRMED!=='true'||!env.AI?.run||!env.PILOT_DB?.prepare||!/^[a-f0-9]{64}$/.test(secret??''))return respond({status:'held',reason:'DRAFT_CONNECTION_NOT_CONFIGURED',sending_authorized:false},503);
  const [a,b]=await Promise.all([reviewHash(req.headers.get('authorization')??''),reviewHash('Bearer '+secret)]);let delta=0;for(let i=0;i<a.length;i++)delta|=a.charCodeAt(i)^b.charCodeAt(i);if(delta)return respond({error:'UNAUTHORIZED'},401);
  if(!['GET','POST'].includes(req.method))return respond({error:'METHOD_NOT_ALLOWED'},405);
  let id,handoff,payload;
  if(req.method==='POST'){
    try{
      const reader=req.body?.getReader();if(!reader)throw new Error();const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();throw new Error();}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      payload=JSON.parse(new TextDecoder().decode(bytes));
      if(!payload.record||!Array.isArray(payload.observations)||payload.observations.length>25)throw new Error();
      handoff=await prepareDraftHandoff(payload.record,{observations:payload.observations,contactState:payload.contact_state});
      if(handoff.status!=='draft_request_ready')return respond({status:'held',reason:'reason' in handoff?handoff.reason:'DRAFT_NOT_READY',sending_authorized:false},409);
      id=await reviewIdentity(payload.record);
    }catch{return respond({status:'held',reason:'DRAFT_INPUT_INVALID',sending_authorized:false},400);}
  }else{id=new URL(req.url).searchParams.get('id');if(!/^review-v1:[a-f0-9]{64}$/.test(id??''))return respond({error:'INVALID_ID'},400);}
  const db=env.PILOT_DB;await db.prepare(reviewSchema).run();
  const previous=await db.prepare('SELECT * FROM m3_draft_reviews WHERE id=?').bind(id).first();
  const result=row=>({id:row.id,status:row.status,reason:row.reason,model:REVIEW_MODEL,evidence_fingerprint:row.evidence_fingerprint,generated_at:row.finished_at,draft:row.draft_json?JSON.parse(row.draft_json):null,sending_authorized:false});
  if(previous)return respond(result(previous));
  if(req.method==='GET')return respond({status:'not_found',sending_authorized:false},404);
  const now=new Date().toISOString(),day=now.slice(0,10);
  // One atomic claim enforces both deduplication and the five-attempt pilot cap.
  const claim=await db.prepare("INSERT OR IGNORE INTO m3_draft_reviews(id,utc_day,lead_id,status,started_at,evidence_fingerprint) SELECT ?,?,?,'running',?,? WHERE (SELECT count(*) FROM m3_draft_reviews) < ?")
    .bind(id,day,payload.record.lead_id,now,handoff.job.id,REVIEW_PILOT_LIMIT).run();
  if(claim.meta.changes!==1){const row=await db.prepare('SELECT * FROM m3_draft_reviews WHERE id=?').bind(id).first();return row?respond(result(row)):respond({status:'held',reason:'DRAFT_PILOT_BUDGET_REACHED',sending_authorized:false},429);}
  let timer;
  try{
    const output=await Promise.race([env.AI.run(REVIEW_MODEL,reviewInput(handoff)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DRAFT_PROVIDER_OUTCOME_UNKNOWN')),25000);})]);
    const draft=validateReviewDraft(output,handoff),finished=new Date().toISOString();
    await db.prepare("UPDATE m3_draft_reviews SET status='draft_needs_review',draft_json=?,finished_at=? WHERE id=? AND status='running'").bind(JSON.stringify(draft),finished,id).run();
  }catch(error){
    const reason=/^DRAFT_[A-Z_]+$/.test(error.message)?error.message:([401,403].includes(Number(error.status))?'DRAFT_PROVIDER_ACCESS_REQUIRED':Number(error.status)===429?'DRAFT_PROVIDER_LIMIT':'DRAFT_PROVIDER_FAILURE');
    await db.prepare("UPDATE m3_draft_reviews SET status='held',reason=?,finished_at=? WHERE id=? AND status='running'").bind(reason,new Date().toISOString(),id).run();
  }finally{clearTimeout(timer);}
  return respond(result(await db.prepare('SELECT * FROM m3_draft_reviews WHERE id=?').bind(id).first()));
}
