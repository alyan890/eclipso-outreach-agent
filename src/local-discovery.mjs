import {createHash} from 'node:crypto';
import {matchesBusiness} from './research-quality.mjs';
import {discoveryOrganizationHold} from './focused-discovery.mjs';
import {nonPrimaryBusinessSource} from './business-evidence.mjs';
import {proposedLaneQuery} from './opportunity-lanes.mjs';
const states='CT TX GA AZ MA FL NC CA CO NY IL WA AL AK AR DE HI ID IN IA KS KY LA ME MD MI MN MS MO MT NE NV NH NJ NM ND OH OK OR PA RI SC SD TN UT VT VA WV WI WY DC'.split(' ');
const groups=[['RESTAURANT','restaurant'],['CAFE','cafe'],['DENTAL','dental clinic'],['CLINIC','medical clinic'],['AESTHETICS','beauty salon'],['ROOFING','roofing contractor'],['HVAC','HVAC'],['PLUMBING','plumber'],['LANDSCAPING','landscaping'],['CONSTRUCTION','construction']];
export function discoveryPlan(cursor){
  if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('DISCOVERY_CURSOR_INVALID');
  const state=states[cursor%states.length],round=Math.floor(cursor/5),slot=cursor%5;
  let [category,term]=groups[round%groups.length];
  if(slot===1)category=['DENTAL','CLINIC','AESTHETICS'][round%3];
  if(slot===2)category=['RESTAURANT','CAFE'][round%2];
  if(slot===4)return {state,category,lane:'APPROVED_OFFER_DISCOVERY',query:`${term} ${state} USA ("website coming soon" OR "website under construction") contact -site:facebook.com -site:instagram.com`};
  const lane=['WEBSITE_REVIEW','BOOKING_PROCESS','ORDERING_PROCESS','BUSINESS_CHANGE'][slot];
  return {state,category,lane,query:proposedLaneQuery({category,stateName:state,lane}).query};
}
export function registryPlan(cursor){return {state:states[cursor%states.length],category:cursor%2?'CLINIC':'DENTAL',skip:Math.floor(cursor/states.length)*5%1000};}
const generic=/coming soon|under construction|welcome|^home$|website|just a moment/i;
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
export function candidateFromPage(page,{category}={}){
  if(page.listing_or_directory||discoveryOrganizationHold(page))return null;
  const sector={RESTAURANT:/restaurant|dining|our menu/i,CAFE:/cafe|café|coffee/i,DENTAL:/dentist|dental/i,CLINIC:/clinic|medical|healthcare/i,AESTHETICS:/salon|aesthetic|beauty|medspa|skin care/i,ROOFING:/roof/i,HVAC:/hvac|heating|air conditioning/i,PLUMBING:/plumb/i,LANDSCAPING:/landscap/i,CONSTRUCTION:/construction|contractor|remodel/i};
  if(!sector[category]?.test(page.visible_text??page.excerpt??''))return null;
  const validState=s=>states.includes(s);
  const found=(page.business_entities??[]).filter(b=>b.name&&b.address?.streetAddress&&b.address?.addressLocality&&validState(b.address?.addressRegion)&&(!b.address.addressCountry||/^(US|USA|United States(?: of America)?)$/i.test(b.address.addressCountry))&&/^\d{5}(?:-?\d{4})?$/.test(b.address?.postalCode??''));
  let info=found.length===1?found[0]:null;
  if(!info){
    const text=page.visible_text??page.excerpt??'';
    const re=/(?<![\d.-])(\d{1,6}\s+(?:(?:N|S|E|W|North|South|East|West)\s+)?(?:(?:[A-Za-z][A-Za-z0-9.'’-]*|\d+(?:st|nd|rd|th))\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Parkway|Pkwy|Way|Place|Pl)\.?)(?:\s*(?:,|•)?\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?\s*[,•]?\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;
    const addresses=[...text.matchAll(re)].filter(m=>validState(m[3]));
    const distinct=[...new Map(addresses.map(m=>[m[1]+m[2]+m[3]+m[4],m])).values()];
    const name=clean(page.site_name||page.title||page.heading).split(/\s[|–—]\s/)[0];
    if(distinct.length!==1||name.length<4||name.length>150||generic.test(name))return null;
    const m=distinct[0];info={name,address:{streetAddress:m[1],addressLocality:m[2],addressRegion:m[3],postalCode:m[4]}};
  }
  if(generic.test(info.name)||!groups.some(g=>g[0]===category))return null;
  if(category==='DENTAL'&&/\blab(?:orator(?:y|ies))?\b/i.test(info.name))return null;
  const a=info.address;
  const record={lead_id:'site:'+createHash('sha256').update(new URL(page.source_url).hostname.replace(/^www\./,'')+info.name+a.streetAddress+a.postalCode).digest('hex').slice(0,24),
    business_name:info.name,category,address:[a.streetAddress,a.postalCode].join(' '),city:a.addressLocality,state:a.addressRegion,country:'US',
    source_url:page.source_url,source_observed_at:page.observed_at,source_dataset:'Business-owned website discovered by Serper',website_url:page.source_url,
    published_emails:[],public_email:'',sending_authorized:false};
  return matchesBusiness(record,page).matched?record:null;
}
export function isBusinessURL(url){
  if(nonPrimaryBusinessSource({source_url:url}))return false;
    try{return !/(?:^|\.)(google\.com|bing\.com|yelp\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|pinterest\.com|yellowpages\.com|npino\.com|guide\.md|chamberofcommerce\.com|wikipedia\.org|openpr\.com|deltadental\.com|toasttab\.com|localsearch\.com|data\.cityofchicago\.org|npiregistry\.cms\.hhs\.gov)$/i.test(new URL(url).hostname);}catch{return false;}
}
