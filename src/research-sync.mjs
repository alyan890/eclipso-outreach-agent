// Private view-only cloud copy. No sender, model or production-mail access.
import {publicEvidenceURL} from './qualification.mjs';
import {nativeDataCopy,copyWebsiteEvidence} from './native-data-contract.mjs';
export const RESEARCH_SYNC_URL='https://your-worker.example.workers.dev/research-sync';
export const RESEARCH_READ_URL='https://your-worker.example.workers.dev/research';
export const RESEARCH_COPY_LIMIT=500000;
const rsText=(v,n=240)=>typeof v==='string'?v.slice(0,n):'';
const rsURL=v=>publicEvidenceURL(v)?v:null;
const rsStamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const rsHash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export function researchCloudCopy(input,{now=Date.now()}={}){
  const finished=Date.parse(input?.finished_at);
  if(input?.mode!=='research_only'||input.sending_enabled!==false||!Array.isArray(input.rows)||input.rows.length>25||!Number.isFinite(finished)||finished>now+60000||now-finished>7*86400000)throw new Error('RESEARCH_COPY_INVALID');
  const ids=new Set();
  const rows=input.rows.map(r=>{
    if(typeof r.lead_id!=='string'||!r.lead_id||r.lead_id.length>150||ids.has(r.lead_id)||!r.business_name||r.business_name.length>180||!rsURL(r.source_url)||!rsStamp(r.source_observed_at)||r.sending_authorized!==false)throw new Error('RESEARCH_COPY_INVALID');
    ids.add(r.lead_id);const q=r.quality_assessment??{},h=q.handoff,job=h?.job,d=r.review_draft;
    if(q.sending_authorized===true||h?.sending_authorized===true)throw new Error('RESEARCH_COPY_INVALID');
    const copy={lead_id:r.lead_id,business_name:r.business_name,address:rsText(r.address),city:rsText(r.city,100),state:rsText(r.state,20),country:rsText(r.country,10),category:rsText(r.category,40),source_url:r.source_url,source_observed_at:r.source_observed_at,source_dataset:rsText(r.source_dataset,140),website_url:rsURL(r.website_url),research_exclusion:rsText(r.research_exclusion,600)||null,sending_authorized:false,
      quality_assessment:{policy:rsText(q.policy,80),decision:rsText(q.decision,30),reason:rsText(q.reason,600),history_coverage:rsText(q.history_coverage,80),history_checked_at:rsStamp(q.history_checked_at),history_source_url:rsURL(q.history_source_url),sending_authorized:false,
        websiteEvidence:copyWebsiteEvidence(q.websiteEvidence),
        checks:Object.fromEntries(['identity','us_location','active_offer','contact','opportunity','history'].map(k=>[k,q.checks?.[k]===true])),
        qualification:q.qualification?{decision:rsText(q.qualification.decision,30),qualified_for:rsText(q.qualification.qualified_for,40),evaluated_at:rsStamp(q.qualification.evaluated_at)}:null,
        handoff:h?{status:rsText(h.status,40),sending_authorized:false,job:job?{id:rsText(job.id,110),contact_state_checked_at:rsStamp(job.contact_state_checked_at)}:null}:null,
        observations:(q.observations??[]).slice(0,15).map(e=>({id:rsText(e.id,160),kind:rsText(e.kind,40),url:rsURL(e.url),observed_at:rsStamp(e.observed_at)})).filter(e=>e.url),
        opportunity:q.opportunity?{type:rsText(q.opportunity.type,80),observation:rsText(q.opportunity.observation,350),note:rsText(q.opportunity.note,350),source_url:rsURL(q.opportunity.source_url)}:null},
      research_pages:(r.research_pages??[]).slice(0,2).map(p=>({source_url:rsURL(p.source_url),title:rsText(p.title,180),booking_signal:rsText(p.booking_signal,100),ordering_signal:rsText(p.ordering_signal,100),technologies:(p.technologies??[]).slice(0,30).map(t=>rsText(t,80))})).filter(p=>p.source_url),
      contact_observations:(r.contact_observations??[]).slice(0,10).filter(c=>typeof c.email==='string'&&/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email)&&rsURL(c.source_url)).map(c=>({email:rsText(c.email,254),source_url:c.source_url,association:rsText(c.association,100)})),
      research_issues:(r.research_issues??[]).slice(0,10).map(v=>rsText(v,200)),next_checks:(r.next_checks??[]).slice(0,10).map(v=>rsText(v,240))};
    if(d&&d.sending_authorized===false){
      copy.review_draft={id:rsText(d.id,100),status:rsText(d.status,40),reason:rsText(d.reason,200),model:rsText(d.model,100),generated_at:rsStamp(d.generated_at),evidence_fingerprint:rsText(d.evidence_fingerprint,110),sending_authorized:false};
      if(d.status==='draft_needs_review'){
        const body=d.draft;
        if(!body||body.sending_authorized!==false||body.review_required!==true||typeof body.subject!=='string'||body.subject.length>120||/[\r\n]/.test(body.subject)||typeof body.body!=='string'||body.body.length>1800||body.body.trim().split(/\s+/).length>=80)throw new Error('RESEARCH_COPY_INVALID');
        copy.review_draft.draft={subject:body.subject,body:body.body,review_required:true,sending_authorized:false};
      }
    }
    return copy;
  });
  const result={version:1,mode:'research_only',batch_id:rsText(input.batch_id,160),finished_at:new Date(finished).toISOString(),execution:'local_awake_runner',service_area:'USA — all states',sending_enabled:false,total_records:Math.max(rows.length,Number.isSafeInteger(input.total_records)?input.total_records:rows.length),rows,
    attribution:{data:rsText(input.attribution?.data,200),url:rsURL(input.attribution?.url)},native_data:nativeDataCopy(input.native_data)};
  if(!result.batch_id||new TextEncoder().encode(JSON.stringify(result)).length>RESEARCH_COPY_LIMIT)throw new Error('RESEARCH_COPY_INVALID');
  return result;
}
const rsSchema="CREATE TABLE IF NOT EXISTS m4_research_snapshot (id TEXT PRIMARY KEY CHECK(id='latest'),collected_at TEXT NOT NULL,received_at TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL)";
export async function researchSyncFetch(req,env){
  const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  const read=new URL(req.url).pathname==='/research',readKey=env.RESEARCH_READ_SECRET,writeKey=env.RESEARCH_WRITE_SECRET;
  if(env.RESEARCH_SYNC_ENABLED!=='true'||env.FREE_PLAN_CONFIRMED!=='true'||!env.PILOT_DB?.prepare||![readKey,writeKey].every(k=>/^[a-f0-9]{64}$/.test(k??''))||readKey===writeKey||[readKey,writeKey].includes(env.DRAFT_REVIEW_SECRET))return respond({error:'RESEARCH_CONNECTION_NOT_CONFIGURED'},503);
  const [a,b]=await Promise.all([rsHash(req.headers.get('authorization')??''),rsHash('Bearer '+(read?readKey:writeKey))]);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);if(mismatch)return respond({error:'UNAUTHORIZED'},401);
  if(req.method!==(read?'GET':'POST'))return respond({error:'METHOD_NOT_ALLOWED'},405);
  let snapshot,text,digest;
  if(!read){
    try{
      if(Number(req.headers.get('content-length')??0)>RESEARCH_COPY_LIMIT)return respond({error:'RESEARCH_COPY_TOO_LARGE'},413);
      const reader=req.body?.getReader();if(!reader)throw new Error();const parts=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>RESEARCH_COPY_LIMIT){await reader.cancel();return respond({error:'RESEARCH_COPY_TOO_LARGE'},413);}parts.push(value);}
      const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
      snapshot=researchCloudCopy(JSON.parse(new TextDecoder().decode(bytes)));text=JSON.stringify(snapshot);digest=await rsHash(text);
    }catch{return respond({error:'RESEARCH_COPY_INVALID'},400);}
  }
  const db=env.PILOT_DB;await db.prepare(rsSchema).run();
  if(read){const row=await db.prepare("SELECT * FROM m4_research_snapshot WHERE id='latest'").first();if(!row)return respond({error:'RESEARCH_NOT_SYNCED'},404);return respond({...JSON.parse(row.payload),cloud_synced_at:row.received_at,storage:'private_cloud'});}
  await db.prepare("INSERT INTO m4_research_snapshot(id,collected_at,received_at,digest,payload) VALUES('latest',?,?,?,?) ON CONFLICT(id) DO UPDATE SET collected_at=excluded.collected_at,received_at=excluded.received_at,digest=excluded.digest,payload=excluded.payload WHERE excluded.collected_at>m4_research_snapshot.collected_at")
    .bind(snapshot.finished_at,new Date().toISOString(),digest,text).run();
  const saved=await db.prepare("SELECT * FROM m4_research_snapshot WHERE id='latest'").first();
  if(saved.digest!==digest)return respond({error:'RESEARCH_NEWER_COPY_EXISTS'},409);
  return respond({status:'RESEARCH_SYNCED',digest:saved.digest,collected_at:saved.collected_at,synced_at:saved.received_at,rows:snapshot.rows.length,sending_enabled:false});
}
