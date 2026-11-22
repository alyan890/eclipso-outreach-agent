// Business research intake only. This never relaxes the mail qualification contract.
import {createHash} from 'node:crypto';
import {candidateFromPage} from './local-discovery.mjs';
import {discoveryOrganizationHold} from './focused-discovery.mjs';
import {matchesBusiness} from './research-quality.mjs';
import {nonPrimaryBusinessSource} from './business-evidence.mjs';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).normalize('NFKC').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const stateEntries='AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia'.split('|').map(s=>s.split(':'));
const stateCode=v=>stateEntries.find(([code,name])=>[code.toLowerCase(),name.toLowerCase()].includes(clean(v).toLowerCase()))?.[0];
const statePattern=stateEntries.map(([code,name])=>name+'|'+code).join('|');
const sectors=[['AESTHETICS',/\b(?:salon|medspa|aesthetic|beauty|skin care)\b/i],['DENTAL',/\b(?:dentist|dental clinic|dentistry)\b/i],['CLINIC',/\b(?:clinic|medical practice|healthcare practice)\b/i],['CAFE',/\b(?:café|cafe|coffeehouse|coffee shop)\b/i],['RESTAURANT',/\b(?:restaurant|diner|bistro|tavern|eatery|our menu)\b/i],['ROOFING',/\broof(?:ing|er|ers)\b/i],['HVAC',/\b(?:hvac|heating|air conditioning)\b/i],['PLUMBING',/\bplumb(?:ing|er|ers)\b/i],['LANDSCAPING',/\blandscap(?:ing|er|ers)\b/i],['CONSTRUCTION',/\b(?:construction|renovations?|general contractor|remodel(?:ing|s)?)\b/i]];
function businessName(page){
 const parts=clean(page.site_name||page.title||page.heading).split(/\s(?:[|–—]|- |&mdash;)\s*/).map(clean);
 const generic=/^(?:home|landing page|website (?:coming soon|under construction)|coming soon|contact(?: us)?|about(?: us)?|welcome|just a moment)$/i;
 return parts.find(s=>s.length>=4&&s.length<=150&&!generic.test(s))??'';
}
function namedPage(name,page){return norm(page.visible_text??page.excerpt).includes(norm(name))&&norm(name).length>=4;}
function sourceType(page){
 const existing=discoveryOrganizationHold(page);if(existing)return existing;
 const primary=clean([page.site_name,page.title,page.heading].join(' '));
 if(/\b(?:angel investment network|entrepreneurs? (?:and|&) (?:angel )?investors?)\b/i.test(primary))return 'INVESTMENT_PLATFORM_NOT_A_LOCAL_SERVICE_BUSINESS';
 if(/\b(?:sportfishing trade show|trade exhibition)\b/i.test(primary))return 'TRADE_SHOW_NOT_A_SERVICE_CONTRACTOR';
 if(/\b(?:volleyball performance|sports club|sports academy)\b/i.test(primary))return 'SPORTS_ORGANIZATION_NOT_A_ROOFING_CONTRACTOR';
 if(/\bindustrial safety solutions\b/i.test(primary))return 'INDUSTRIAL_SAFETY_PROVIDER_NOT_A_PLUMBER';
 const text=page.visible_text??'';
 if(/\b(?:premier fundraising event|organized by the .{0,40}foundation)\b/i.test(text)&&/tickets|drawing|fundraising/i.test(text))return 'FUNDRAISING_EVENT_NOT_A_RESTAURANT';
 if(/\byour cart\b/i.test(text)&&/\b(?:estimated total|check out)\b/i.test(text)&&/\b(?:products|product sinks|faucets)\b/i.test(text))return 'PRODUCT_SUPPLIER_NOT_A_SERVICE_CONTRACTOR';
 return null;
}
function locationsFor(page,name){
 if(!namedPage(name,page))return [];
 const out=[],text=page.visible_text??page.excerpt??'';
 for(const entity of page.business_entities??[]){
  const a=entity.address??{},state=stateCode(a.addressRegion);
  if(norm(entity.name)!==norm(name)||!state||!a.addressLocality||(a.addressCountry&&!/^(?:US|USA|United States(?: of America)?)$/i.test(a.addressCountry)))continue;
  out.push({basis:'STRUCTURED_US_LOCATION',city:clean(a.addressLocality),state,address:clean(a.streetAddress),postalCode:clean(a.postalCode),quote:clean([a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode].filter(Boolean).join(' ')),source:page.source_url,observed:page.observed_at});
 }
 // A full street/ZIP is useful evidence, but not mandatory for a service-area business.
 const street=/(?<![\d.-])(\d{1,6}\s+(?:(?:N|S|E|W|North|South|East|West)\s+)?(?:(?:[A-Za-z][A-Za-z0-9.'’–-]*|\d+(?:st|nd|rd|th))\s+){0,6}?(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Parkway|Pkwy|Circle|Way|Place|Pl)\.?)(?:\s*[,•]?\s*(?:(?:Suite\.?|Ste\.?|Unit|Room\.?|Space\.?|#)\s*[A-Za-z0-9-]+|[FV]C-?\d+)(?:,?\s*Mailbox\s*\d+)?)?\s*[,•]?\s*([A-Za-z][A-Za-z .'-]{1,35}?)\s*,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/gi;
 for(const m of text.matchAll(street)){const state=stateCode(m[3]);if(state)out.push({basis:'PUBLISHED_STREET_ADDRESS',city:clean(m[2]),state,address:clean(m[0].slice(0,m[0].lastIndexOf(m[2]))).replace(/[,•]$/,'').trim(),postalCode:m[4],quote:m[0],source:page.source_url,observed:page.observed_at});}
 const area=new RegExp('\\b(?:serving|based in|located in|welcoming clients in|business here in)\\s+([A-Za-z][A-Za-z .\'-]{1,45}?),\\s*('+statePattern+')\\b','gi');
 for(const m of text.matchAll(area)){const state=stateCode(m[2]);if(state)out.push({basis:'PUBLISHED_SERVICE_AREA',city:clean(m[1]),state,address:'',postalCode:'',quote:m[0],source:page.source_url,observed:page.observed_at});}
 return out;
}
export function analyzeDiscoverySite(pages,{category:queryCategory,issues=[]}={}){
 const base={version:1,queryCategory,category:null,categoryCorrected:false,record:null,sendingAuthorized:false};
 if(!pages.length)return {...base,disposition:'ACCESS_HOLD',reason:'SOURCE_NOT_READABLE',detail:issues.find(s=>/robots|http|timeout|not_html/i.test(s))??'No readable primary page was collected.',next:'Retry an ordinary public read later or verify manually; do not treat access failure as a missing website.'};
 const home=pages[0],hold=sourceType(home);
 if(nonPrimaryBusinessSource(home)||hold)return {...base,disposition:'OFF_TARGET',reason:hold??'DIRECTORY_NOT_A_BUSINESS',detail:'The source represents a different organization type, not the service business sought by this discovery cohort.',next:'Keep the source in the audit; do not create an outreach lead from its mentions or sponsors.'};
 const name=businessName(home);
 if(!name)return {...base,disposition:'IDENTITY_HOLD',reason:'BUSINESS_NAME_NOT_EXTRACTED',detail:'The readable primary page did not establish a business name.',next:'Verify the business name from its own source.'};
 const primary=clean([name,home.heading,home.title].join(' '));
 let category=sectors.find(([,re])=>re.test(primary))?.[0];
 if(!category){
  // Only a first-party service statement can supplement primary headings. Sponsor/client mentions cannot.
  const offer=(home.visible_text??'').match(/\b(?:we (?:are|offer|provide|serve)|what we do|our (?:menu|services|work focuses on))\b.{0,220}/gi)?.join(' ')??'';
  category=sectors.find(([,re])=>re.test(offer))?.[0];
  if(!category&&/\b(?:food is prepared|we prepare (?:food|meals)|our (?:salads|sandwiches))\b/i.test(home.visible_text??'')&&/\border now\b/i.test(home.visible_text??''))category='RESTAURANT';
 }
 const common={...base,business:name,category:category??null,categoryCorrected:!!category&&category!==queryCategory};
 if(!category)return {...common,disposition:'CATEGORY_HOLD',reason:'PRIMARY_SERVICE_CATEGORY_NOT_ESTABLISHED',detail:'The query category was not established by the business’s own name, headings or service statement.',next:'Check the actual first-party offer; do not classify from isolated keywords in client stories.'};
 const host=new URL(home.source_url).hostname.replace(/^www\./,'');
 const own=pages.filter(p=>{try{return new URL(p.source_url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
 const locations=own.flatMap(p=>locationsFor(p,name)),unique=[...new Map(locations.map(l=>[norm(l.address||l.city).replace(/\b(?:street|road|avenue|boulevard|drive)\b/g,v=>({street:'st',road:'rd',avenue:'ave',boulevard:'blvd',drive:'dr'}[v]))+'|'+norm(l.city)+'|'+l.state,l])).values()];
 // A service area repeated beside a street address is not a second physical branch.
 const streets=unique.filter(l=>l.address),selected=streets.length?streets:unique;
 if(selected.length>1&&!/\b(?:locations?|headquarters|office|branches)\b/i.test(home.visible_text??''))return {...common,disposition:'LOCATION_HOLD',reason:'AMBIGUOUS_MULTIPLE_LOCATIONS',detail:'Different locations were found without a primary statement linking them as branches of this business.',next:'Resolve which locations belong to the business; do not pick the first address.'};
 if(!selected.length)return {...common,disposition:'LOCATION_HOLD',reason:'US_STATE_OR_OPERATING_LOCALITY_UNCONFIRMED',detail:'Business and category found, but checked primary pages lack a source-backed US state/locality pair. A city in the domain or a state in the search query is insufficient.',next:'Confirm the US operating locality; preserve the business for research. A street address and ZIP are optional.',partial:{business:name,category,source:home.source_url,observed:home.observed_at}};
 const states=[...new Set(selected.map(l=>l.state))],multi=selected.length>1;
 const legacy=own.map(p=>candidateFromPage({...p,site_name:name},{category})).find(Boolean);
 const first=selected[0],record={...(legacy??{}),lead_id:(multi?undefined:legacy?.lead_id)??'site:'+createHash('sha256').update(host+'|'+norm(name)).digest('hex').slice(0,24),business_name:name,category,
  address:multi?'':first.address+(first.postalCode?' '+first.postalCode:''),city:multi?'Multiple published locations':first.city,state:states.length===1?states[0]:'',country:'US',
  source_url:home.source_url,source_observed_at:home.observed_at,source_dataset:'Business-owned website discovered by Serper',website_url:home.source_url,published_emails:[],public_email:'',sending_authorized:false,
  research_identity:{basis:multi?'PUBLISHED_BRAND_LOCATIONS':first.basis,scope:multi?'BRAND_NOT_SINGLE_BRANCH':first.address?'SINGLE_LOCATION':'SERVICE_AREA',locations:selected.slice(0,24),queryCategory,categoryCorrected:category!==queryCategory}};
 return {...common,disposition:'BUSINESS_RESEARCH',reason:multi?'PUBLISHED_BRANCHES_PRESERVED':first.address?'BUSINESS_AND_LOCATION_MATCHED':'BUSINESS_AND_SERVICE_AREA_MATCHED',detail:multi?`${selected.length} location entries extracted from the published branch list; no arbitrary branch selected. List extraction may be incomplete.`:first.address?'Business identity and published location matched.':'Business identity and published US service area matched; street and ZIP remain unknown.',next:'Check a specific unmet need and business contact separately; a valid business is not automatically an email-ready lead.',record};
}
export function matchesResearchIdentity(record,page,pages){
 if(nonPrimaryBusinessSource(page))return false;
 if(!record.research_identity)return matchesBusiness(record,page).matched;
 const proof=record.research_identity;
 if(!['SINGLE_LOCATION','SERVICE_AREA','BRAND_NOT_SINGLE_BRANCH'].includes(proof.scope)||record.country!=='US'||!namedPage(record.business_name,page))return false;
 try{if(new URL(record.website_url).hostname.replace(/^www\./,'')!==new URL(page.source_url).hostname.replace(/^www\./,''))return false;}catch{return false;}
 // Re-extract proofs from supplied primary evidence; never trust a stored quote/identity flag alone.
 const actual=analyzeDiscoverySite(pages,{category:record.category}).record;
 if(!actual||norm(actual.business_name)!==norm(record.business_name)||actual.category!==record.category||['city','state','country','address'].some(k=>norm(actual[k])!==norm(record[k])))return false;
 return JSON.stringify(actual.research_identity.locations)===JSON.stringify(proof.locations)&&actual.research_identity.scope===proof.scope;
}
export function refreshDiscoveryIdentity(record,pages){
 if(!record.research_identity)return record;
 const current=analyzeDiscoverySite(pages,{category:record.research_identity.queryCategory}).record;
 if(!current||norm(current.business_name)!==norm(record.business_name))return record;
 try{if(new URL(current.website_url).hostname.replace(/^www\./,'')!==new URL(record.website_url).hostname.replace(/^www\./,''))return record;}catch{return record;}
 return {...record,...current,lead_id:record.lead_id};
}
