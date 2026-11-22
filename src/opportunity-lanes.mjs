// Reused from Eclipso opportunity-lanes pilot; connected to public research only.
import {nonPrimaryBusinessSource,verifiedOpportunity} from './business-evidence.mjs';
export const BROADER_TARGETING_VERSION='ECLIPSO_BROADER_TARGETING_V1';
const time=v=>Number.isFinite(Date.parse(v))?Date.parse(v):null;
const sameHost=(a,b)=>{try{return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'');}catch{return false;}};
const sourceQuote=(pages,re)=>{for(const p of pages){const match=(p.visible_text??'').match(re);if(match)return {source:p.source_url,observed:p.observed_at,quote:match[0]};}return null;};
export function opportunityLanes(row,pages,{now=Date.now()}={}){
 const result={business:row.business,status:'RESEARCH_ONLY',lanes:[],canUseExistingTemplate:false,sendingAuthorized:false};
 if(row.history?.suppressed||row.history?.held||row.history?.priorAttempts>0)return {...result,status:'HISTORY_HOLD'};
 if(!row.website)return {...result,status:'WEBSITE_LOOKUP_REQUIRED',next:'Search the exact business and locality. An empty listing URL does not establish website absence.'};
 if(!row.identityMatched||row.country!=='US'||!row.activeOffer)return {...result,status:'BUSINESS_IDENTITY_OR_ACTIVITY_HOLD'};
 const own=pages.filter(p=>!nonPrimaryBusinessSource(p)&&sameHost(p.source_url,row.website)&&time(p.observed_at)!==null&&time(p.observed_at)<=now&&now-time(p.observed_at)<=72*3600000);
 if(!own.length)return {...result,status:'CURRENT_PRIMARY_EVIDENCE_REQUIRED'};
 const capacity=sourceQuote(own,/\b(?:not accepting new (?:clients|patients|customers)|fully booked|book(?:ed)? out.{0,35}\b(?:weeks|months)|intentionally (?:paused|disabled))\b/i);
 const existing=verifiedOpportunity(row,now);
 if(existing)result.lanes.push({lane:'VERIFIED_WEBSITE_GAP',strength:'SUPPORTED_OPPORTUNITY',source:row.opportunities.find(o=>o.strength==='VERIFIED_GAP')?.source,observed:row.opportunities.find(o=>o.strength==='VERIFIED_GAP')?.observed,next:'Confirm scope, vendor relationship and buying interest. Check current contact history before outreach.'});
 result.canUseExistingTemplate=existing&&row.websiteEvidence?.state==='PLACEHOLDER_ONLY';
 const noWebsite=sourceQuote(own,/\bwe (?:currently )?(?:do not|don't) have (?:a|our own) (?:web ?site)\b/i);
 if(noWebsite)result.lanes.push({lane:'NO_WEBSITE_REVIEW',strength:'RESEARCH_SIGNAL',...noWebsite,priority:row.websiteEvidence?.state==='FUNCTIONAL_CONTENT_OBSERVED'?'LOW':'VERIFY',next:row.websiteEvidence?.state==='FUNCTIONAL_CONTENT_OBSERVED'?'The published statement conflicts with current functional website content. Verify whether it is outdated.':'Verify the business’s current web presence and whether the statement still applies. A listing without a website URL alone is not evidence of absence.'});
 const unavailable=sourceQuote(own,/\b(?:online (?:booking|ordering)|delivery ordering).{0,45}\b(?:unavailable|not available|paused|disabled)\b/i);
 if(unavailable)result.lanes.push({lane:'SERVICE_AVAILABILITY_REVIEW',strength:'RESEARCH_SIGNAL',...unavailable,priority:capacity?'LOW':'VERIFY',next:capacity?'Published capacity or intentional-pause context exists. Do not sell additional demand or claim the website is broken.':'Ask whether this is an intentional pause, opening-hours rule or technical problem. Do not claim a failure from this notice alone.',...(capacity?{counterEvidence:capacity}:{})});
 const phone=sourceQuote(own,/\b(?:appointments? (?:are (?:currently )?(?:made )?|can (?:only )?be made |must be (?:made|booked) )only by phone|all (?:appointments?|booking).{0,55}(?:over the phone|by phone|in[- ]person)|we (?:do not|don't|currently do not) (?:offer|have|provide) online (?:booking|appointment scheduling))\b/i);
 if(phone&&['DENTAL','CLINIC','AESTHETICS'].includes(row.category))result.lanes.push({lane:'PHONE_BOOKING_PROCESS',strength:'RESEARCH_SIGNAL',...phone,priority:capacity||row.bookingDetected?'LOW':'VERIFY',next:row.bookingDetected?'An existing booking system/link was also detected. Confirm which clients or services use each route.':'Explore whether an optional request form would help. Phone booking alone is not a defect or buying intent.'});
 const phoneOrders=sourceQuote(own,/\b(?:orders? (?:are (?:currently )?(?:taken |accepted )?|can (?:only )?be placed |must be placed )only by phone|all (?:takeout |takeaway )?orders?.{0,40}(?:over the phone|by phone)|we (?:do not|don't|currently do not) (?:offer|have|provide) online ordering)\b/i);
 if(phoneOrders&&['RESTAURANT','CAFE'].includes(row.category))result.lanes.push({lane:'PHONE_ORDERING_PROCESS',strength:'RESEARCH_SIGNAL',...phoneOrders,priority:capacity||row.orderingDetected?'LOW':'VERIFY',next:row.orderingDetected?'An online ordering link was also detected. Confirm which orders use each method.':'Explore whether an order-request option fits the business. Phone ordering is not a confirmed defect or buying intent.'});
 for(const p of own){
  const match=(p.visible_text??'').match(/\b(?:we (?:have |are )?(?:moved|relocated|relocating|rebranding)|our new (?:location|office|branch)|(?:salon|practice|office|business|clinic|restaurant) (?:has |is )?(?:relocated|relocating|rebranding)|has relocated and expanded (?:her|his|our|their) (?:salon|practice|business)|(?:our )?grand opening)\b/i);if(!match)continue;
  const published=time(p.published_at),dated=published!==null&&published<=now&&now-published<=90*86400000;
  result.lanes.push({lane:'BUSINESS_CHANGE',strength:'RESEARCH_SIGNAL',source:p.source_url,observed:p.observed_at,quote:match[0],published:dated?p.published_at:null,priority:dated?'VERIFY':'LOW',next:dated?'Verify the announced change and whether a website update is useful. It does not establish a budget or purchase decision.':'Announcement date unconfirmed. Do not describe this business or location as newly opened.'});break;
 }
 if(!result.lanes.length)result.status='NO_SUPPORTED_OPPORTUNITY_YET';
 else if(!row.contacts?.length)result.status='CONTACT_RESEARCH';
 return result;
}
const terms={RESTAURANT:'restaurant',CAFE:'cafe',DENTAL:'dental practice',CLINIC:'medical clinic',AESTHETICS:'salon',ROOFING:'roofing contractor',HVAC:'HVAC contractor',PLUMBING:'plumber',LANDSCAPING:'landscaping company',CONSTRUCTION:'construction contractor'};
export function proposedLaneQuery({category,stateName,lane}){
 const codes='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
 if(!terms[category]||!(codes.includes(stateName)||/^[A-Za-z ]{4,25}$/.test(stateName??'')))throw Error('QUERY_SCOPE_INVALID');
 if(lane==='BOOKING_PROCESS'&&!['DENTAL','CLINIC','AESTHETICS'].includes(category))throw Error('BOOKING_LANE_NOT_APPLICABLE');
 if(lane==='ORDERING_PROCESS'&&!['RESTAURANT','CAFE'].includes(category))throw Error('ORDERING_LANE_NOT_APPLICABLE');
 const suffix={WEBSITE_REVIEW:'official website contact',BOOKING_PROCESS:'("appointments by phone" OR "call to book") contact',ORDERING_PROCESS:'("orders by phone" OR "call to order") contact',BUSINESS_CHANGE:'("new location" OR "relocated" OR "now open") contact'}[lane];
 if(!suffix)throw Error('QUERY_LANE_INVALID');
 return {category,stateName,lane,query:`${terms[category]} "${stateName}" ${suffix} -site:facebook.com -site:instagram.com -filetype:pdf`,discoveryHintOnly:true};
}
export const PROPOSED_DAILY_ALLOCATION=Object.freeze({WEBSITE_REVIEW:8,BOOKING_PROCESS:4,ORDERING_PROCESS:4,BUSINESS_CHANGE:4});

// Reuse the pilot's evidence classifier in both research paths. These are
// reviewable targeting facts/questions, not new sending permission or defects.
export function laneOpportunities(result){
 return (result?.lanes??[]).filter(l=>l.source&&l.lane!=='VERIFIED_WEBSITE_GAP').map(l=>({type:l.lane,strength:'RESEARCH_SIGNAL',reason:[`Published evidence: “${l.quote}”.`,l.counterEvidence?`Context: “${l.counterEvidence.quote}”.`:'',l.next].filter(Boolean).join(' '),source:l.source,observed:l.observed}));
}
