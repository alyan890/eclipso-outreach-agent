// Evidence-based research decisions. No database writes, model, SMTP or sender.
import {createHash} from 'node:crypto';
import {inspectWebsite,nonPrimaryBusinessSource,publishedContactOffer} from './business-evidence.mjs';
import {evidenceSubject,qualifyLead,publicEvidenceURL} from './qualification.mjs';
import {prepareDraftHandoff} from './draft-handoff.mjs';
import {HISTORY_ENDPOINT} from './history-contract.mjs';
import {matchesResearchIdentity} from './discovery-diagnostics.mjs';
import {opportunityLanes} from './opportunity-lanes.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const normal=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const business=value=>normal(String(value??'').replace(/['’]s\b/gi,'')).replace(/\b(llc|inc|incorporated|corporation|corp|pllc|pc)\b/g,'').replace(/\s+/g,' ').trim();
const shortStreet=value=>normal(value).replace(/\b(north|south|east|west|street|avenue|road|boulevard|drive|lane|court|place)\b/g,s=>({north:'n',south:'s',east:'e',west:'w',street:'st',avenue:'ave',road:'rd',boulevard:'blvd',drive:'dr',lane:'ln',court:'ct',place:'pl'}[s]));
const email=value=>String(value??'').trim().toLowerCase();
const md5=value=>createHash('md5').update(value).digest('hex');
const stateNames=Object.fromEntries([
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],
]);
export const historyBusinessKey=record=>String(record.business_name??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function matchesBusiness(record,page){
  if(nonPrimaryBusinessSource(page))return {name:false,address:false,matched:false};
  const text=page.visible_text??page.excerpt??'',name=business(record.business_name);
  const canonicalStreet=shortStreet(record.address);
  const street=canonicalStreet.match(/^(\d+\s+(?:[a-z0-9]+\s+){0,5}?(?:st|ave|rd|blvd|dr|ln|ct|pl|pkwy|ter|way))\b/)?.[1]??canonicalStreet.split(' ').filter(t=>!/^\d{5,9}$/.test(t)).slice(0,3).join(' ');
  const pageText=normal(text);
  const zip=String(record.address??'').match(/\b(\d{5})(?:\d{4})?\b(?!.*\b\d{5}\b)/)?.[1];
  const fullStreet=shortStreet(text);
  const stateName=stateNames[record.state];
  const stateMatch=!!stateName&&(new RegExp(`\\b${record.state}\\b`,'i').test(text)||new RegExp(`\\b${stateName}\\b`,'i').test(text));
  const nameMatch=name.length>=4&&(' '+business(text)+' ').includes(' '+name+' ');
  const addressMatch=street.length>=6&&fullStreet.includes(street)&&normal(record.city).length>1&&
    pageText.includes(normal(record.city))&&stateMatch&&(!zip||new RegExp(`\\b${zip}\\b`).test(text));
  return {name:nameMatch,address:addressMatch,matched:nameMatch&&addressMatch};
}
function window(text,needle){const at=text.toLowerCase().indexOf(needle.toLowerCase());return at>=0?text.slice(Math.max(0,at-80),at+320):text.slice(0,350);}
function observation(record,page,kind,details,quote){
  const subject=evidenceSubject(record);
  return {id:'web:'+hash(JSON.stringify({subject,url:page.source_url,at:page.observed_at,kind,details})).slice(0,32),
    subject,kind,url:page.source_url,observed_at:page.observed_at,observation:quote.length>=20?quote:'Observed business page: '+quote,...details};
}
export function historyState(record,history,{now=new Date().toISOString(),duplicate=false}={}){
  const at=Date.parse(history?.observed_at),clock=Date.parse(now),target=email(record.public_email);
  if(history?.status!=='HISTORY_SNAPSHOT'||history.complete!==true||!Number.isFinite(at)||at>clock||clock-at>2*3600000||
    !Array.isArray(history.scope_emails)||!history.scope_emails.map(email).includes(target)||
    !Array.isArray(history.scope_business_names)||!history.scope_business_names.includes(historyBusinessKey(record))||
    !['contacts','sends','queue','leads'].every(k=>Array.isArray(history[k])&&history.counts?.[k]===history[k].length)||
    !publicEvidenceURL(history.source_url)||!(history.source_url.startsWith('https://supabase.com/dashboard/project/your-project-ref/sql/')||history.source_url===HISTORY_ENDPOINT&&history.scope_lead_ids?.includes(record.lead_id))||
    history.contacts.some(c=>typeof c.suppressed!=='boolean'||typeof c.held!=='boolean'))return null;
  const digest=md5(target);
  const known=history.leads.filter(l=>l.email_hash===digest||l.business_key===historyBusinessKey(record));
  const leadIDs=new Set(known.map(l=>l.lead_id)),knownEmails=new Set([digest,...known.map(l=>l.email_hash)]);
  const contacts=history.contacts.filter(c=>knownEmails.has(c.email_hash));
  const sends=history.sends.filter(s=>knownEmails.has(s.email_hash)||leadIDs.has(s.lead_id));
  const pending=history.queue.some(q=>(knownEmails.has(q.email_hash)||leadIDs.has(q.lead_id))&&['QUEUED','PENDING','RUNNING','UNKNOWN'].includes(q.state));
  return {lead_id:record.lead_id,email:target,checked_at:history.observed_at,
    suppressed:contacts.some(c=>c.suppressed===true),held:contacts.some(c=>c.held===true)||pending,
    priorAttempt:sends.length>0,duplicate:duplicate||known.some(l=>l.lead_id!==record.lead_id)};
}
export async function assessResearch(record,pages,{history,now=new Date().toISOString(),duplicate=false,issues=[]}={}){
  const recent=pages.filter(p=>publicEvidenceURL(p.source_url)&&Number.isFinite(Date.parse(p.observed_at))&&Date.parse(p.observed_at)<=Date.parse(now)&&Date.parse(now)-Date.parse(p.observed_at)<=7*86400000);
  const owned=recent.filter(p=>matchesResearchIdentity(record,p,recent)),identity=owned[0];
  const contact=owned.flatMap(p=>(p.published_emails??[]).filter(e=>!p.contact_contexts?.find(c=>c.email===e)?.unrelated_credit).map(e=>({email:email(e),page:p})))
    .sort((a,b)=>Number(!/@(?:gmail|yahoo|outlook|hotmail|aol|icloud)\.com$/.test(a.email))-Number(!/@(?:gmail|yahoo|outlook|hotmail|aol|icloud)\.com$/.test(b.email)))[0];
  const {quality_assessment:oldAssessment,research_pages:oldPages,contact_observations:oldContacts,search_discovery:oldSearch,retrieval_attempts:oldAttempts,...identityRecord}=record;
  const current={...identityRecord,public_email:contact?.email??''},observations=[];
  const checks={identity:!!identity,us_location:!!identity&&current.country==='US',active_offer:false,contact:!!contact,opportunity:false,history:false};
  if(identity){
    const text=identity.visible_text??identity.excerpt;
    observations.push(observation(current,identity,'IDENTITY',{basis:'BUSINESS_OWNED_PAGE',business_name_match:true},window(text,current.business_name)));
    observations.push(observation(current,identity,'LOCATION',{country:'US',state:current.state,city:current.city,operating_location:true},window(text,current.city)));
    const active=(/\b(?:our (?:services|menu)|walk[- ]?ins|book|appointment|order|opening hours|hours|we (?:offer|provide|serve)|call (?:us|to)|dining|restaurant|salon|dental care)\b/i.test(text)||publishedContactOffer(text))&&! /\b(?:permanently closed|business is closed|not yet open)\b/i.test(text);
    if(active){checks.active_offer=true;observations.push(observation(current,identity,'ACTIVITY',{basis:'CURRENT_BUSINESS_OFFER',active:true},window(text,text.match(/hours|appointment|our services|restaurant|salon|dental care/i)?.[0]??current.business_name)));}
  }
  if(contact)observations.push(observation(current,contact.page,'CONTACT',{basis:'BUSINESS_PUBLISHED_CONTACT',business_name_match:true,email:contact.email},window(contact.page.visible_text??contact.page.excerpt,contact.email)));
  const pageIssues=issues.filter(issue=>! /^(?:HISTORY_|SEARCH_|DRAFT_)/.test(String(issue)));
  const websiteEvidence=inspectWebsite(recent,pageIssues),gap=websiteEvidence.state==='PLACEHOLDER_ONLY'&&owned.some(p=>p.source_url===websiteEvidence.noticeSource)?{page:owned.find(p=>p.source_url===websiteEvidence.noticeSource),statement:websiteEvidence.notice}:null;
  if(gap){checks.opportunity=true;observations.push(observation(current,gap.page,'WEBSITE_GAP',{
    gap:'PLACEHOLDER_SITE',basis:'OBSERVED_PLACEHOLDER_PAGE',site_url:gap.page.source_url,site_linked_from_business_page:true},window(gap.page.visible_text??gap.page.excerpt,gap.statement)));}
  const state=historyState(current,history,{now,duplicate});checks.history=!!state;
  const targeting=opportunityLanes({business:current.business_name,category:current.category,website:current.website_url,country:current.country,identityMatched:checks.identity,activeOffer:checks.active_offer,contacts:contact?[contact]:[],history:state?{suppressed:state.suppressed,held:state.held,priorAttempts:state.priorAttempt?1:0}:{},websiteEvidence,bookingDetected:owned.some(p=>p.booking_widget_detected||(p.action_links??[]).some(l=>/book|appointment|reserv/i.test(l.anchor+' '+l.url))),orderingDetected:owned.some(p=>p.ordering_widget_detected||(p.action_links??[]).some(l=>/order|delivery|takeout/i.test(l.anchor+' '+l.url)))},owned,{now:Date.parse(now)});
  const process=targeting.lanes.find(l=>['PHONE_BOOKING_PROCESS','PHONE_ORDERING_PROCESS'].includes(l.lane)&&l.priority==='VERIFY');
  const processGap=process?(process.lane==='PHONE_BOOKING_PROCESS'?'PUBLISHED_PHONE_BOOKING':'PUBLISHED_PHONE_ORDERING'):null;
  if(process){checks.opportunity=true;observations.push(observation(current,owned.find(p=>p.source_url===process.source),'WEBSITE_GAP',{gap:processGap,basis:'EXPLICIT_BUSINESS_STATEMENT',statement_current:true},process.quote));}
  const reasons=[];
  if(!identity)reasons.push('BUSINESS_NAME_AND_ADDRESS_NOT_MATCHED');
  if(!checks.active_offer)reasons.push('CURRENT_BUSINESS_OFFER_NOT_VERIFIED');
  if(!contact)reasons.push('BUSINESS_PUBLISHED_CONTACT_NOT_VERIFIED');
  if(!gap&&!process)reasons.push('NO_VERIFIED_WEBSITE_GAP');
  if(!state)reasons.push('FRESH_CONTACT_HISTORY_REQUIRED');
  let qualification=null,handoff=null;
  if(contact){qualification=qualifyLead(current,{observations,now,contact:state??{},priorAttempt:state?.priorAttempt??false,duplicate:state?.duplicate??duplicate});}
  // A missing snapshot cannot silently mean a clear outreach history.
  const decision=qualification?.decision==='EXCLUDED'? 'EXCLUDED':qualification?.decision==='QUALIFIED'&&state?'QUALIFIED':'NEEDS_RESEARCH';
  if(decision==='QUALIFIED')handoff=await prepareDraftHandoff(current,{observations,contactState:state,now});
  const actionLinks=owned.flatMap(p=>(p.action_links??[]).map(l=>({...l,source_url:p.source_url,observed_at:p.observed_at})));
  return {policy:'ECLIPSO_RESEARCH_QUALITY_V2',websiteEvidence,history_coverage:state?'EMAIL_AND_EXACT_BUSINESS_NAME':'UNVERIFIED',history_checked_at:state?.checked_at??null,history_source_url:state?history.source_url:null,record:current,decision,reason:decision==='QUALIFIED'?(gap?'Verified placeholder site and business contact; clear history; draft review only':'Published phone-based process and business contact; clear history; optional-service draft review only'):
    decision==='EXCLUDED'?qualification.reasons.join('; '):reasons.join('; '),checks,observations,qualification,handoff,
    targeting,published_action_links:actionLinks,deliverability:'UNVERIFIED',sending_authorized:false,
    opportunity:gap?{type:'PLACEHOLDER_SITE',source_url:gap.page.source_url,observation:gap.statement}:process?{type:processGap,source_url:process.source,observation:process.quote,note:'Published business process, not a defect or expressed buying intent. Existing placeholder wording does not apply.'}:
      {type:'UNVERIFIED',note:actionLinks.length?'Published booking/ordering links observed; do not claim these features are absent':'No supported website-gap evidence found in the checked pages'}};
}
