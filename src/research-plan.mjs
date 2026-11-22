// Local-only follow-up planner. This neither fetches pages nor authorizes outreach.
const canonical=value=>{try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;u.hash='';return u.href.replace(/\/$/,'');}catch{return null;}};
const host=value=>{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}};
export function planEvidenceReads(pages,{failedUrls=[],maximum=3}={}){
 if(!Number.isInteger(maximum)||maximum<0||maximum>3)throw Error('READ_BOUND_INVALID');
 const home=pages[0],ownHost=host(home?.source_url);
 if(!ownHost)return [];
 const seen=new Set([...pages.map(p=>p.source_url),...failedUrls].map(canonical).filter(Boolean));
 const options=new Map();
 for(const page of pages){
  if(host(page.source_url)!==ownHost||page.listing_or_directory)continue;
  for(const link of [...(page.followup_links??[]),...(page.action_links??[])]){
   const url=canonical(link.url),anchor=String(link.anchor??'');
   if(!url||host(url)!==ownHost||seen.has(url))continue;
   // Cancellation/destructive routes are not research page reads.
   if(/\b(?:logout|unsubscribe|delete|cancel)\b/i.test(new URL(url).pathname+new URL(url).search))continue;
   const text=anchor+' '+new URL(url).pathname;
   const kind=/contact/i.test(text)?'CONTACT':/book|appointment|reserv|order|menu|services?|treatments?/i.test(text)?'SERVICE_ACTION':/about|team|location|news|announcement/i.test(text)?'BUSINESS_CONTEXT':null;
   if(!kind)continue;
   if(!options.has(url))options.set(url,{url,kind,anchor,discoveredOn:page.source_url,observed:page.observed_at,reason:'Follow an actual first-party published link; never synthesize a route.'});
  }
 }
 const rank={CONTACT:0,SERVICE_ACTION:1,BUSINESS_CONTEXT:2};
 const ranked=[...options.values()].sort((a,b)=>rank[a.kind]-rank[b.kind]||a.url.localeCompare(b.url)),chosen=[];
 for(const kind of Object.keys(rank)){const first=ranked.find(p=>p.kind===kind);if(first&&chosen.length<maximum)chosen.push(first);}
 return [...chosen,...ranked.filter(p=>!chosen.includes(p))].slice(0,maximum);
}
export function researchActionPlan(row,lanes,reads){
 const questions=[];
 for(const lane of lanes?.lanes??[]){
  if(lane.lane==='PHONE_BOOKING_PROCESS')questions.push({type:'BOOKING_PROCESS',question:row.bookingDetected?'Which services use the existing request link, and which need a phone call?':'Would an optional appointment-request form help, or is phone-only scheduling intentional?',source:lane.source,observed:lane.observed});
  if(lane.lane==='SERVICE_AVAILABILITY_REVIEW')questions.push({type:'AVAILABILITY_CONTEXT',question:'Is the published pause intentional, capacity-related or a technical problem?',source:lane.source,observed:lane.observed});
  if(lane.lane==='PHONE_ORDERING_PROCESS')questions.push({type:'ORDERING_PROCESS',question:row.orderingDetected?'Which orders use the existing online option, and which require a phone call?':'Would an online order-request option help, or are phone orders intentional?',source:lane.source,observed:lane.observed});
  if(lane.lane==='BUSINESS_CHANGE')questions.push({type:'CHANGE_CONTEXT',question:lane.published?'Does the dated business change require a specific website update?':'When did this change happen, and is it still relevant?',source:lane.source,observed:lane.observed});
 }
 return {next:reads.length?'READ_PUBLISHED_PAGES':questions.length?'VERIFY_BUSINESS_PROCESS':'NO_SPECIFIC_NEED_ESTABLISHED',reads,questions,sendingAuthorized:false,automaticQueueing:false};
}
