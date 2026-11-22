// Standalone public research. No mailbox, model, queue writer or cloud credentials.
import {createHash} from 'node:crypto';
import {discoveryPlan,registryPlan,isBusinessURL} from './local-discovery.mjs';
import {analyzeDiscoverySite} from './discovery-diagnostics.mjs';
import {npiQuery,normalizeNPI} from './harvey/npi-discovery.mjs';
import {assessResearch} from './research-quality.mjs';
import {researchSearchQuery} from '../tools/qualify-research-batch.mjs';
import {researchWindow,planKnownCompanyReads,planIncompleteDiscoveryReads,saveResearchEvidence} from './research-pipeline.mjs';
import {discoveryPages} from './discovery-pages.mjs';
import {BROADER_TARGETING_VERSION} from './opportunity-lanes.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,28);
import {LIMITS} from './research-budget.mjs';
export {LIMITS} from './research-budget.mjs';
const day=()=>new Date().toISOString().slice(0,10);
const identity=r=>[r.business_name,r.address,r.city,r.state].join('|').toLowerCase().replace(/[^a-z0-9]/g,'');
const transientRead = /^(?:request_timeout|dns_timeout|connection_failed|(?:page_http_|robots_unavailable_http_)(?:500|502|503|504))$/;
const knownReadIssue = /^(?:robots_[a-z_0-9]+|page_http_\d{3}|request_timeout|dns_timeout|connection_failed|not_html|unsafe_or_unavailable_dns|unsafe_or_insecure_url|access_challenge_requires_attention|host_access_held|response_too_large)$/;
export class LocalResearchAgent{
  constructor({state,search,readPage,request,history=()=>null,checkpoint=async()=>{},limits=LIMITS}){Object.assign(this,{state,search,readPage,request,history,checkpoint,limits});}
  plan(){
    const state=this.state;if(state.get('paused',false))return;
    planKnownCompanyReads(state);
    planIncompleteDiscoveryReads(state);
    const pending=state.db.prepare("SELECT count(*) n FROM jobs WHERE state='pending'").get().n;
    if(pending>25)return;
    const registryCursor=state.get('registryCursor',0),registry=registryPlan(registryCursor);
    const planned=state.db.prepare("SELECT count(*) n FROM jobs WHERE kind='registry' AND state IN ('pending','running')").get().n;
    if(!planned){state.enqueue('registry',registry);state.set('registryCursor',registryCursor+1);}
    const count=state.db.prepare("SELECT count(*) n FROM jobs WHERE kind='search_discovery' AND state IN ('pending','running')").get().n;
    if(!count){const cursor=state.get('discoveryCursor',0);state.enqueue('search_discovery',discoveryPlan(cursor),{id:'discovery:'+cursor});state.set('discoveryCursor',cursor+1);}
  }
  add(record){
    const existing=this.state.db.prepare('SELECT record FROM records').all().some(r=>identity(JSON.parse(r.record))===identity(record));
    if(existing)return false;
    this.state.putRecord(record);
    if(record.website_url)this.state.enqueue('profile',{record_id:record.lead_id,urls:[record.website_url]},{id:'record-profile:'+record.lead_id});
    else this.state.enqueue('search_lookup',{record_id:record.lead_id,query:researchSearchQuery(record)},{id:'record-search:'+record.lead_id});
    return true;
  }
  async execute(job){
    const p=JSON.parse(job.payload);
    if(job.kind==='registry'){
      const url=new URL(npiQuery({...p,limit:5}));url.searchParams.set('skip',String(p.skip));
      const response=await this.request(url.href,{maxBytes:250000,timeoutMs:20000,accept:'application/json'});
      if(response.status!==200)throw new Error('REGISTRY_HTTP_'+response.status);
      const records=normalizeNPI(JSON.parse(response.body),{...p,observedAt:new Date().toISOString(),queryUrl:url.href});
      let added=0;for(const record of records)if(this.add(record))added++;
      return {source_url:url.href,received_at:new Date().toISOString(),records:records.length,added};
    }
    if(job.kind==='search_discovery'||job.kind==='search_lookup'){
      const results=await this.search(p.query);
      this.state.set('lastSearchSuccess',new Date().toISOString());
      const urls=[...new Set(results.map(r=>r.url).filter(isBusinessURL))].slice(0,5);
      if(job.kind==='search_lookup'){
        if(urls.length)this.state.enqueue('profile',{record_id:p.record_id,urls},{id:'record-profile:'+p.record_id});
      }else for(const url of urls)this.state.enqueue('profile',{url,category:p.category,discovery_lane:p.lane??'BROAD_BUSINESS_DISCOVERY'},{id:'site-profile:'+hash(url)});
      return {query:p.query,executed_at:new Date().toISOString(),result_urls:urls};
    }
    if(job.kind==='profile'){
      let record=p.record_id?this.state.record(p.record_id)?.record:null;
      let first,collected,preliminary;
      let failedRead;
      const entries=[...new Set([record?.website_url,...(p.urls??[]),p.url].filter(Boolean))].slice(0,3);
      if(!entries.length)throw Error('PROFILE_WEBSITE_REQUIRED');
      for(const entry of entries){
        try{first=await this.readPage(entry);}catch(error){
          const issue = knownReadIssue.test(error.message) ? error.message : 'PUBLIC_SOURCE_READ_HELD';
          if (!failedRead || transientRead.test(issue)) failedRead = {source_url:entry, detail:issue};
          continue;
        }
        collected=await discoveryPages(first,this.readPage);
        if(!record)break;
        preliminary=await assessResearch(record,collected.pages,{issues:collected.issues});
        if(preliminary.checks.identity)break;
      }
      if(!collected)return {outcome:'ACCESS_HOLD',reason:'SOURCE_NOT_READABLE',...failedRead};
      if(!record){
        const diagnostic=analyzeDiscoverySite(collected.pages,{category:p.category,issues:collected.issues});record=diagnostic.record;
        if(!record){const {record:unused,...detail}=diagnostic;return {source_url:first.source_url,observed_at:first.observed_at,outcome:diagnostic.disposition,...detail};}
        const existing=this.state.db.prepare('SELECT id,record FROM records').all().find(r=>identity(JSON.parse(r.record))===identity(record));
        if(existing)record={...record,lead_id:existing.id};
      }
      preliminary=await assessResearch(record,collected.pages,{issues:collected.issues});let history=null;
      if(preliminary.checks.identity)record={...record,website_url:collected.pages[0].source_url};
      if(preliminary.record.public_email){try{history=await this.history([preliminary.record],{fresh:true});}catch(error){collected.issues.push(/^HISTORY_[A-Z_]+$/.test(error.message)?error.message:'HISTORY_SOURCE_UNAVAILABLE');}}
      const result=await saveResearchEvidence(this.state,record,collected.pages,{history,issues:collected.issues});
      return {record_id:record.lead_id,decision:result.qualification,source_urls:result.research_pages.map(page=>page.source_url)};
    }
    throw new Error('UNKNOWN_RESEARCH_JOB');
  }
  async cycle({onJob=()=>{}}={}){
    this.plan();let attempted=0;
    for(let i=0;i<this.limits.cycleJobs;i++){
      if(this.state.get('paused',false))break;
      const job=this.state.next({preferDiscovery:i===0});if(!job)break;
      const isSearch=job.kind.startsWith('search_'),hold=this.state.get('searchHold');
      if(isSearch&&(hold||!this.search)){
        this.state.postpone(job,3600000,hold??'SEARCH_KEY_REQUIRED');continue;
      }
      const limit=isSearch?this.limits.searchDaily:job.kind==='registry'?this.limits.registryDaily:this.limits.profileDaily;
      const claimed=this.state.claim(job,{kind:isSearch?'serper':job.kind,limit,lifetime:isSearch?this.limits.searchLifetime:100000});
      if(!claimed){this.state.postpone(job,3600000,'LOCAL_QUERY_BUDGET_REACHED');continue;}
      attempted++;onJob({kind:job.kind,id:job.id});
      try{
        const result=await this.execute(job);
        if (job.kind === 'profile' && job.attempts === 0 && result.outcome === 'ACCESS_HOLD' && transientRead.test(result.detail)) {
          this.state.postpone(job,10*60000,'TRANSIENT_SITE_READ_RETRY');
          this.state.event('job_retry_scheduled',{id:job.id,kind:job.kind,detail:result.detail});
        } else {
          this.state.finish(job,'done',result);
          this.state.event('job_done',{id:job.id,kind:job.kind,...result});
        }
      }catch(error){
        // Never persist provider bodies or arbitrary exception strings.
        const raw=String(error?.message??''),reason=/^[A-Z][A-Z0-9_]{2,90}$/.test(raw)?raw:'PUBLIC_SOURCE_RESEARCH_HELD';
        if(isSearch&&['SEARCH_ACCESS_REQUIRED','SEARCH_QUOTA_OR_RATE_LIMIT'].includes(reason))this.state.set('searchHold',reason);
        this.state.finish(job,isSearch?'unknown':'held',null,reason);this.state.event('job_held',{id:job.id,kind:job.kind,reason});
      }
      await this.checkpoint();
    }
    this.state.set('lastCycle',{at:new Date().toISOString(),attempted,day:day()});await this.checkpoint();
    return {attempted,...this.state.counts(),search_hold:this.state.get('searchHold'),sending_enabled:false};
  }
  async snapshot(){
    const records=await researchWindow(this.state.records(500));let history=null,historyIssue=null;
    const historyRecords=records.map(item=>item.preliminary.record).filter(record=>record.public_email);
    if(historyRecords.length){try{history=await this.history(historyRecords);}catch(error){historyIssue=/^HISTORY_[A-Z_]+$/.test(error.message)?error.message:'HISTORY_SOURCE_UNAVAILABLE';}}
    const rows=[];
    for(const item of records){
      const record=item.result??item.record,pages=record.research_pages??[];
      const quality=await assessResearch(record,pages,{history,duplicate:item.duplicate,issues:record.research_issues??[]});
      // Save history outcome without re-dating a website read or discovery event.
      this.state.db.prepare('UPDATE records SET result=? WHERE id=?').run(JSON.stringify({...record,quality_assessment:quality,qualification:quality.decision,research_exclusion:quality.decision==='EXCLUDED'?quality.reason:null}),record.lead_id);
      rows.push({...quality.record,research_pages:pages.map(({visible_text,business_entities,contact_contexts,...page})=>page),
        quality_assessment:quality,qualification:quality.decision,research_exclusion:quality.decision==='EXCLUDED'?quality.reason:null,
        research_issues:[...new Set([...(record.research_issues??[]),...(historyIssue?[historyIssue]:[])])],next_checks:quality.reason.split('; '),
        contact_observations:quality.observations.filter(o=>o.kind==='CONTACT').map(o=>({email:o.email,source_url:o.url,observed_at:o.observed_at,association:'BUSINESS_OWNED_PAGE_MATCHED'})),sending_authorized:false});
    }
    return {version:1,mode:'research_only',batch_id:'local-agent-current',finished_at:new Date().toISOString(),
      execution:'local_awake_runner',targeting_version:BROADER_TARGETING_VERSION,service_area:'USA — all states',attribution:{data:'Business-owned pages, Serper search discovery and CMS NPPES organization registry',url:'https://npiregistry.cms.hhs.gov/'},
      sending_enabled:false,total_records:this.state.counts().records,history_connection:historyIssue??(history?'CONNECTED':'NO_VERIFIED_CONTACTS_TO_CHECK'),rows};
  }
}
