import test from 'node:test';import assert from 'node:assert/strict';
import {opportunityLanes,proposedLaneQuery,PROPOSED_DAILY_ALLOCATION} from '../src/opportunity-lanes.mjs';
const now=Date.now(),at=new Date(now).toISOString(),row=()=>({business:'Example Salon',category:'AESTHETICS',website:'https://example.org/',country:'US',identityMatched:true,activeOffer:true,history:{},contacts:[{email:'example@gmail.com'}],opportunities:[]}),page=text=>({source_url:'https://example.org/book',observed_at:at,visible_text:text});
test('a published unavailable notice is a question to verify, not a confirmed broken system',()=>{const r=opportunityLanes(row(),[page('Online booking is currently unavailable. Please call.')],{now});assert.equal(r.lanes[0].strength,'RESEARCH_SIGNAL');assert.equal(r.canUseExistingTemplate,false);assert.equal(r.sendingAuthorized,false);});
test('capacity and intentional pauses lower priority without deleting the business',()=>{const r=opportunityLanes(row(),[page('Online booking is currently unavailable. I am booked out on average 15 weeks.')],{now});assert.equal(r.lanes[0].priority,'LOW');assert.match(r.lanes[0].counterEvidence.quote,/15 weeks/);});
test('phone-only booking retains contradictory evidence about an existing booking system',()=>{const r=opportunityLanes({...row(),bookingDetected:true},[page('Appointments are currently made only by PHONE.')],{now});assert.equal(r.lanes[0].lane,'PHONE_BOOKING_PROCESS');assert.match(r.lanes[0].next,/existing booking/);});
test('an undated grand-opening banner does not establish a recent opening',()=>{const r=opportunityLanes(row(),[page('Grand opening October 20')],{now});assert.equal(r.lanes[0].published,null);assert.equal(r.lanes[0].priority,'LOW');const fresh=opportunityLanes(row(),[{...page('Our new location'),published_at:at}],{now});assert.equal(fresh.lanes[0].priority,'VERIFY');});
test('missing website or email remains research, not fabricated absence or rejected business',()=>{assert.equal(opportunityLanes({...row(),website:null},[],{now}).status,'WEBSITE_LOOKUP_REQUIRED');assert.equal(opportunityLanes({...row(),contacts:[]},[page('Appointments are currently made only by phone.')],{now}).status,'CONTACT_RESEARCH');});
test('only current first-party evidence can establish research lanes',()=>{for(const p of [{...page('Online booking is unavailable'),source_url:'https://healthdataatlas.com/example'},{...page('Online booking is unavailable'),source_url:'https://other.org/book'},{...page('Online booking is unavailable'),observed_at:'2000-01-01'}])assert.equal(opportunityLanes(row(),[p],{now}).status,'CURRENT_PRIMARY_EVIDENCE_REQUIRED');});
test('history holds take precedence, and generic missing-link detections establish no need',()=>{assert.equal(opportunityLanes({...row(),history:{suppressed:true}},[page('Online booking is unavailable')],{now}).status,'HISTORY_HOLD');assert.equal(opportunityLanes({...row(),bookingDetected:false},[page('We offer haircuts.')],{now}).status,'NO_SUPPORTED_OPPORTUNITY_YET');});
test('query proposals use explicit locality and keep the current 20-query daily total',()=>{assert.equal(Object.values(PROPOSED_DAILY_ALLOCATION).reduce((a,b)=>a+b),20);const q=proposedLaneQuery({category:'AESTHETICS',stateName:'Georgia',lane:'BOOKING_PROCESS'});assert.match(q.query,/"Georgia"/);assert.equal(q.discoveryHintOnly,true);assert.throws(()=>proposedLaneQuery({category:'ROOFING',stateName:'Georgia',lane:'BOOKING_PROCESS'}));});
test('restaurant phone ordering is separate from appointment booking and retains an online ordering alternative',()=>{
 const r=opportunityLanes({...row(),category:'RESTAURANT',orderingDetected:true},[page('All takeout orders are taken by phone.')],{now});
 assert.equal(r.lanes[0].lane,'PHONE_ORDERING_PROCESS');assert.equal(r.lanes[0].strength,'RESEARCH_SIGNAL');assert.match(r.lanes[0].next,/online ordering link/);assert.equal(r.canUseExistingTemplate,false);
 assert.match(proposedLaneQuery({category:'RESTAURANT',stateName:'New York',lane:'ORDERING_PROCESS'}).query,/call to order/);
 assert.throws(()=>proposedLaneQuery({category:'DENTAL',stateName:'New York',lane:'ORDERING_PROCESS'}));
});
test('phone cancellation requirements do not become phone-only booking or ordering',()=>{
 const r=opportunityLanes({...row(),category:'AESTHETICS'},[page('For cancellations phone calls are required. Please do not email a cancellation.')],{now});
 assert.equal(r.lanes.length,0);
});
test('generic client marketing does not become the company announcing a business change',()=>{
 const r=opportunityLanes(row(),[page('84% of clients say they would follow their barber to a new location.')],{now});assert.equal(r.lanes.length,0);
 const own=opportunityLanes(row(),[page('We have relocated to our new location.')],{now});assert.equal(own.lanes[0].lane,'BUSINESS_CHANGE');assert.equal(own.lanes[0].priority,'LOW');
});
