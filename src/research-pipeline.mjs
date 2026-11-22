// Scout's known-company/profile-first approach, connected to the existing evidence gates.
import {assessResearch} from './research-quality.mjs';
import {refreshDiscoveryIdentity} from './discovery-diagnostics.mjs';
const stamp=()=>new Date().toISOString();
export async function saveResearchEvidence(state,record,pages,{issues=[],history=null,now=stamp()}={}){
 const current=refreshDiscoveryIdentity(record,pages);
 const q=await assessResearch(current,pages,{history,now,issues});
 const result={...q.record,website_url:current.website_url,research_pages:pages,
  research_issues:[...new Set(issues)],research_finished_at:now,quality_assessment:q,
  qualification:q.decision,research_exclusion:q.decision==='EXCLUDED'?q.reason:null,
  contact_observations:q.observations.filter(o=>o.kind==='CONTACT').map(o=>({email:o.email,source_url:o.url,observed_at:o.observed_at,association:'BUSINESS_OWNED_PAGE_MATCHED'})),
  next_checks:q.reason.split('; '),sending_authorized:false};
 state.putRecord(q.record,result);return result;
}
export function researchPriority(q){
 const c=q.checks??{};
 if(q.decision==='EXCLUDED')return -1;
 return Number(c.identity)*20+Number(c.us_location)*10+Number(c.active_offer)*15+Number(c.contact)*20+Number(c.opportunity)*40+Number(q.targeting?.lanes?.some(l=>l.source&&l.priority!=='LOW'))*20;
}
export async function researchWindow(items,{limit=25,now=stamp()}={}){
 const assessed=await Promise.all(items.map(async item=>{
  const record=item.result??item.record,pages=record.research_pages??[];
  const q=await assessResearch(record,pages,{now,issues:record.research_issues??[]});
  const prior=record.quality_assessment?.qualification?.reasons??[];
  return {...item,preliminary:q,previouslyContacted:prior.some(r=>['PRIOR_CONTACT_ATTEMPT','SUPPRESSED_CONTACT'].includes(r))};
 }));
 const emails=new Map();for(const item of assessed){const email=item.preliminary.record.public_email?.toLowerCase();if(email)emails.set(email,(emails.get(email)??0)+1);}
 for(const item of assessed)item.duplicate=(emails.get(item.preliminary.record.public_email?.toLowerCase())??0)>1;
 // Keep good public evidence visible. A stream of new empty registry rows must
 // not evict it. Reserve a small rotating slice for less-complete businesses.
 const score=item=>item.previouslyContacted?-1:researchPriority(item.preliminary);
 const ranked=assessed.sort((a,b)=>score(b)-score(a)||String(b.researched_at??'').localeCompare(String(a.researched_at??'')));
 const best=ranked.slice(0,Math.max(0,limit-5)),used=new Set(best.map(r=>r.record.lead_id));
 const rest=assessed.filter(r=>!used.has(r.record.lead_id)).sort((a,b)=>String(b.researched_at??'').localeCompare(String(a.researched_at??'')));
 return [...best,...rest.slice(0,limit-best.length)];
}
export function planKnownCompanyReads(state,{now=Date.now(),limit=4}={}){
 const day=new Date(now).toISOString().slice(0,10),due=state.records(500).filter(item=>{
  const r=item.result??item.record;if(!r.website_url||(r.quality_assessment?.qualification?.reasons??[]).some(v=>['PRIOR_CONTACT_ATTEMPT','SUPPRESSED_CONTACT'].includes(v)))return false;
  const pages=r.research_pages??[],last=Math.max(0,...pages.map(p=>Date.parse(p.observed_at)||0));
  return !pages.length||now-last>=24*3600000;
 }).sort((a,b)=>researchPriority(b.result?.quality_assessment??{})-researchPriority(a.result?.quality_assessment??{})||String(a.researched_at??'').localeCompare(String(b.researched_at??'')));
 let added=0;
 for(const item of due){
  const r=item.result??item.record;
  const existing=state.db.prepare("SELECT 1 FROM jobs WHERE kind='profile' AND state IN ('pending','running') AND json_extract(payload,'$.record_id')=?").get(r.lead_id);
  if(existing)continue;
  if(state.enqueue('profile',{record_id:r.lead_id,urls:[r.website_url]},{id:'refresh-profile:'+r.lead_id+':'+day}))added++;
  if(added>=limit)break;
 }
 return added;
}
export function nativeResearchWindow(rows,{limit=50,now=Date.now()}={}){
 const score=r=>(r.history?.suppressed||r.history?.held||r.history?.priorAttempts>0)?-1:Number(r.history?.status==='CLEAR')*15+Number(r.identityMatched)*20+Number(r.activeOffer)*15+Number(r.contacts?.length>0)*15+Number(r.opportunities?.some(o=>o.strength==='VERIFIED_GAP'&&now-Date.parse(o.observed)<=48*3600000))*40+Number(r.opportunities?.some(o=>['PHONE_BOOKING_PROCESS','PHONE_ORDERING_PROCESS','SERVICE_AVAILABILITY_REVIEW','BUSINESS_CHANGE','NO_WEBSITE_REVIEW'].includes(o.type)&&now-Date.parse(o.observed)<=72*3600000))*20;
 return [...rows].sort((a,b)=>score(b)-score(a)||String(b.researchedAt??'').localeCompare(String(a.researchedAt??''))).slice(0,limit);
}
export function planIncompleteDiscoveryReads(state,{limit=2}={}){
 // One versioned read-only recovery for older single-page identity holds.
 // Access refusals/challenges and uncertain paid searches are never replayed.
 const jobs=state.db.prepare("SELECT id,payload,result FROM jobs WHERE kind='profile' AND state='done' AND id NOT LIKE 'followup-v2:%' AND json_extract(payload,'$.record_id') IS NULL AND json_extract(result,'$.outcome') IN ('IDENTITY_HOLD','LOCATION_HOLD','CATEGORY_HOLD') ORDER BY rowid DESC LIMIT 200").all();
 let added=0;
 for(const job of jobs){const payload=JSON.parse(job.payload);if(state.enqueue('profile',payload,{id:'followup-v2:'+job.id}))added++;if(added>=limit)break;}
 return added;
}
