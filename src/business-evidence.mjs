// Shared, deterministic research policy. Observations never establish buying intent.
export const DATA_QUALITY_VERSION = 'business-evidence-v2';
// A business can affirm its current offer with a direct invitation to contact
// it about its own products/services, even on a short construction page.
export const publishedContactOffer=text=>/\b(?:contact|call|email)\s+(?:us|our (?:team|office))\b.{0,140}\bour (?:products?|services?)\b/i.test(String(text??''));
export function nonPrimaryBusinessSource(page){
 if(page.listing_or_directory)return true;
 try{return /(?:^|\.)(?:healthdataatlas\.com|npino\.com|npidb\.org|npiprofile\.com|opennpi\.com|healthcare4ppl\.com|yelp\.com|yellowpages\.com|chamberofcommerce\.com|npiregistry\.cms\.hhs\.gov)$/.test(new URL(page.source_url).hostname.toLowerCase());}catch{return true;}
}
const noticePattern = /\b(?:(?:web\s*site|site)\s*(?:is\s*)?(?:under construction|coming soon)|(?:under construction|coming soon)\s*(?:web\s*site|site)|this domain (?:is |has been )?parked|domain (?:is )?for sale|future home of)\b/i;
const beCanonical = value => { try { const u=new URL(value);u.hash='';return u.href.replace(/\/$/,''); } catch { return ''; } };
const beSameHost = (a,b) => { try { return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,''); } catch { return false; } };
export function interpretSignal(signal){
 const code=signal.code??signal.signal_code,value=signal.value??(signal.value_text?.trim()?signal.value_text:signal.value_num);
 if(/^RUNNING_.*ADS$/.test(code??''))return value===1||value==='1'? 'Advertising tag detected; campaign activity and spending unverified':value===0||value==='0'?'Advertising tag not detected in checked pages; actual advertising unknown':'Advertising detection unknown';
 if(code==='NO_ONLINE_BOOKING')return 'Homepage booking-hint check only; absence of a detected link does not prove no booking system';
 if(code==='SITE_PAGE_COUNT')return 'Discovered page count only; not a complete website inventory';
 if(code==='BLOG_STALE')return 'Blog freshness observation; not evidence of a website defect or buying intent';
 return 'Upstream observation; business need not established';
}
export function inspectWebsite(pages=[],issues=[]){
 const evidence=pages.map(p=>{
  const text=String(p.visible_text??''),words=text.split(/\s+/).filter(Boolean).length;
  const prices=(text.match(/(?:\$\s*\d+(?:\.\d{2})?|\d+\.\d{2}\s*\$)/g)??[]).length;
  const offerDetail=/\b(?:menu|services?|treatment|entrees?|breakfast|lunch|dinner|repair|installation|haircut|coloring|dentures|implants)\b/i.test(text);
  const substantial=words>=180||(words>=45&&prices>=3)||(words>=90&&offerDetail);
  return {source:p.source_url,observed:p.observed_at,words,substantial,notice:text.match(noticePattern)?.[0]??null,actions:(p.action_links??[]).length+(p.booking_widget_detected||p.ordering_widget_detected?1:0),truncated:p.visible_text_truncated===true};
 });
 const home=evidence.find(p=>{try{return ['/','/index.html','/index.php'].includes(new URL(p.source).pathname);}catch{return false;}});
 const seen=new Set(evidence.map(p=>beCanonical(p.source)));
 const unchecked=[...new Set(pages.flatMap(p=>p.followup_links??[]).filter(l=>beSameHost(l.url,home?.source??pages[0]?.source_url)).map(l=>beCanonical(l.url)).filter(u=>!seen.has(u)))];
 const substantial=evidence.filter(p=>p.substantial),incomplete=issues.length>0||unchecked.length>0||evidence.some(p=>p.truncated);
 const state=!home?'UNKNOWN':home.notice&&substantial.length?'CONFLICTING_NOTICE':home.notice&&home.words<=120&&!evidence.some(p=>p.actions)&&!incomplete?'PLACEHOLDER_ONLY':home.notice?'NOTICE_REQUIRES_REVIEW':substantial.length?'FUNCTIONAL_CONTENT_OBSERVED':'INSUFFICIENT_COVERAGE';
 return {version:DATA_QUALITY_VERSION,state,coverage:incomplete?'INCOMPLETE':'CHECKED_LINKS_ONLY',checkedPages:evidence.length,uncheckedLinks:unchecked.length,noticeSource:home?.notice?home.source:null,noticeObserved:home?.notice?home.observed:null,notice:home?.notice??null,functionalSources:substantial.map(p=>({source:p.source,observed:p.observed})),pages:evidence};
}
export function websiteOpportunities(site,matched){
 if(!matched||!site.notice)return [];
 const supported=site.state==='PLACEHOLDER_ONLY';
 return [{type:supported?'WEBSITE_COMPLETION':site.state==='CONFLICTING_NOTICE'?'CONFLICTING_WEBSITE_NOTICE':'WEBSITE_NOTICE_REVIEW',strength:supported?'VERIFIED_GAP':'RESEARCH_SIGNAL',reason:supported?'Only a brief placeholder was observed in the checked pages. No functional content or action was found in that bounded check; vendor relationship and buying intent remain unknown.':site.state==='CONFLICTING_NOTICE'?'The homepage notice conflicts with substantial website content. Do not describe the whole website as unfinished.':'A website notice was observed, but coverage is insufficient to establish a missing website.',source:site.noticeSource,observed:site.noticeObserved}];
}
export function verifiedOpportunity(row,now=Date.now()){
 const site=row.websiteEvidence;
 if(site?.version!==DATA_QUALITY_VERSION)return false;
 const fresh=t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=now+60000&&now-Date.parse(t)<=72*3600000;
 return (row.opportunities??[]).some(o=>{
  if(o.strength!=='VERIFIED_GAP'||!fresh(o.observed))return false;
  if(o.type==='WEBSITE_COMPLETION')return site.state==='PLACEHOLDER_ONLY'&&site.coverage==='CHECKED_LINKS_ONLY'&&!site.functionalSources?.length&&beCanonical(o.source)===beCanonical(site.noticeSource)&&o.observed===site.noticeObserved;
  // Existing sites remain eligible for a specific, directly recorded failure.
  // A missing hint or generic industry assumption cannot create this evidence.
  if(!['BOOKING_FLOW_FAILURE','ORDERING_FLOW_FAILURE'].includes(o.type))return false;
  return (row.functionalChecks??[]).some(c=>c.type===o.type&&c.result==='FAILURE_OBSERVED'&&c.identityMatched===true&&c.expectedActionPublished===true&&typeof c.observation==='string'&&c.observation.length>=20&&fresh(c.observed)&&c.observed===o.observed&&beCanonical(c.source)===beCanonical(o.source)&&beSameHost(c.source,row.website));
 });
}
