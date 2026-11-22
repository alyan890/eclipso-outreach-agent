import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteD1} from './support/sqlite-d1.mjs';
import {AgentState} from '../src/local-agent-state.mjs';
import {profilePage} from '../src/harvey/profile.mjs';
import {assessResearch,historyState,historyBusinessKey} from '../src/research-quality.mjs';
import {reviewFetch,reviewIdentity,reviewInput,validateReviewDraft,REVIEW_ENDPOINT,REVIEW_MODEL} from '../src/review-draft.mjs';
import {createLocalDraftWriter} from '../src/local-drafts.mjs';
const token='b'.repeat(64);
async function fixture(n=1){
  const now=new Date().toISOString(),record={lead_id:'synthetic:writer'+n,business_name:'Synthetic Salon '+n,address:'42 Main St 85016',city:'Phoenix',state:'AZ',country:'US',category:'AESTHETICS',public_email:`syntheticwriter${n}@gmail.com`,source_url:'https://fixture.org/',source_observed_at:now,sending_authorized:false};
  const page=profilePage(`<h1>${record.business_name}</h1><p>Website coming soon. Call us to book an appointment. Hours Monday to Friday. 42 Main St Phoenix AZ 85016. ${record.public_email}</p>`,{url:record.source_url,observedAt:now});
  const history={status:'HISTORY_SNAPSHOT',complete:true,source_url:'https://supabase.com/dashboard/project/your-project-ref/sql/synthetic-writing-test',observed_at:now,scope_emails:[record.public_email],scope_business_names:[historyBusinessKey(record)],leads:[],sends:[],queue:[],contacts:[],counts:{leads:0,sends:0,queue:0,contacts:0}};
  const quality=await assessResearch(record,[page],{history});assert.equal(quality.decision,'QUALIFIED');
  return {record,quality,history,payload:{record,observations:quality.observations,contact_state:historyState(record,history)}};
}
const makeEnv=(db,run)=>({DRAFT_REVIEW_ENABLED:'true',DRAFT_REVIEW_SECRET:token,FREE_PLAN_CONFIRMED:'true',PILOT_DB:db,AI:{run}});
const post=payload=>new Request(REVIEW_ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
function modelStub(_model,input){
  const data=JSON.parse(input.messages[1].content),gap=data.untrusted_observations.find(e=>e.kind==='WEBSITE_GAP');
  return {response:JSON.stringify({subject:'quick question about your website',body:`Hi ${data.business_name} team, I noticed the coming-soon notice on your website. We’re Eclipso Digital, and we can help finish a mobile-friendly site for your business. Would you like me to send a couple of ideas?`,evidence_ids:[gap.id]})};
}
test('new real-business endpoint is disabled by default and unauthorized requests touch neither DB nor AI',async t=>{
  const db=new SqliteD1();t.after(()=>db.close());let calls=0;const env=makeEnv(db,()=>{calls++;});
  assert.equal((await reviewFetch(post({}),{...env,DRAFT_REVIEW_ENABLED:'false'})).status,503);
  assert.equal((await reviewFetch(new Request(REVIEW_ENDPOINT,{method:'POST',body:'{}'}),env)).status,401);
  assert.equal(calls,0);assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='m3_draft_reviews'").get().n,0);
});
test('real writing uses grounded evidence, removes contact data from the model context and persists review-only output',async t=>{
  const f=await fixture(),db=new SqliteD1();t.after(()=>db.close());let calls=0;
  const result=await reviewFetch(post(f.payload),makeEnv(db,(model,input)=>{calls++;assert.equal(model,REVIEW_MODEL);assert.deepEqual(input.chat_template_kwargs,{enable_thinking:false});assert.equal(input.max_completion_tokens,1500);assert.doesNotMatch(input.messages[1].content,/syntheticwriter1@gmail.com/);assert.ok(!JSON.parse(input.messages[1].content).untrusted_observations.some(e=>e.kind==='CONTACT'));return modelStub(model,input);}));
  const value=await result.json();assert.equal(value.status,'draft_needs_review');assert.equal(value.draft.review_required,true);assert.equal(value.draft.sending_authorized,false);assert.equal(calls,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM m1_runs').get().n,0);
});
test('repeated and overlapping requests for the same identity never repeat inference',async t=>{
  const f=await fixture(),db=new SqliteD1();t.after(()=>db.close());let calls=0;
  const env=makeEnv(db,(...args)=>{calls++;return modelStub(...args);});
  await Promise.all([reviewFetch(post(f.payload),env),reviewFetch(post(f.payload),env)]);await reviewFetch(post(f.payload),env);assert.equal(calls,1);
  const read=await reviewFetch(new Request(REVIEW_ENDPOINT+'?id='+await reviewIdentity(f.record),{headers:{Authorization:'Bearer '+token}}),env);
  assert.equal((await read.json()).status,'draft_needs_review');assert.equal(calls,1);
});
test('the real-writing pilot caps total attempts at five without changing synthetic budgets',async t=>{
  const db=new SqliteD1();t.after(()=>db.close());let calls=0;const env=makeEnv(db,(...args)=>{calls++;return modelStub(...args);});
  for(let i=0;i<6;i++){const f=await fixture(i);const r=await reviewFetch(post(f.payload),env);assert.equal(r.status,i<5?200:429);}
  assert.equal(calls,5);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM m3_draft_reviews').get().n,5);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM m1_budget').get().n,0);
});
test('missing, stale, suppressed or previously contacted identities stop before inference',async t=>{
  const f=await fixture(),db=new SqliteD1();t.after(()=>db.close());let calls=0;const env=makeEnv(db,()=>{calls++;});
  for(const contact of [null,{...f.payload.contact_state,checked_at:'2020-01-01'},{...f.payload.contact_state,suppressed:true},{...f.payload.contact_state,priorAttempt:true}])assert.equal((await reviewFetch(post({...f.payload,contact_state:contact}),env)).status,409);
  assert.equal(calls,0);
});
test('truncated and failed model calls are held and never replayed; raw provider secrets are not returned',async t=>{
  for(const [n,run] of [[1,()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})],[2,()=>{throw new Error('synthetic-private-provider-message');}]]){
    const f=await fixture(n),db=new SqliteD1();t.after(()=>db.close());let calls=0;const env=makeEnv(db,()=>{calls++;return run();});
    const response=await reviewFetch(post(f.payload),env),text=await response.text();assert.equal(JSON.parse(text).status,'held');assert.doesNotMatch(text,/synthetic-private-provider-message/);
    await reviewFetch(post(f.payload),env);assert.equal(calls,1);
  }
});
test('copy validation rejects invented evidence, prices, guarantees and false missing-booking claims',async()=>{
  const f=await fixture(),handoff=f.quality.handoff,good=JSON.parse(modelStub(REVIEW_MODEL,reviewInput(handoff)).response);
  for(const value of [{...good,evidence_ids:['invented']},{...good,body:good.body+' Guaranteed clients?'},{...good,body:good.body+' Only $500?'},{...good,body:good.body+' You have no online ordering?'}])assert.throws(()=>validateReviewDraft({response:value},handoff));
});
test('local writer rechecks live history, stores once and cannot approve or send',async t=>{
  const f=await fixture(),state=new AgentState(':memory:');t.after(()=>state.close());let calls=0,checks=0;
  const write=createLocalDraftWriter({state,history:async(_records,options)=>{assert.equal(options.fresh,true);checks++;return f.history;},generate:async()=>{calls++;return {id:await reviewIdentity(f.record),status:'draft_needs_review',model:REVIEW_MODEL,evidence_fingerprint:f.quality.handoff.job.id,generated_at:new Date().toISOString(),draft:validateReviewDraft(modelStub(REVIEW_MODEL,reviewInput(f.quality.handoff)),f.quality.handoff),sending_authorized:false};}});
  const rows=[{...f.record,quality_assessment:f.quality}];await write(rows);await write(rows);
  assert.equal(calls,1);assert.equal(checks,1);assert.equal(rows[0].review_draft.status,'draft_needs_review');assert.equal(rows[0].review_draft.sending_authorized,false);
});
test('opt-outs arriving after qualification and interrupted local writing remain held',async t=>{
  const f=await fixture(),state=new AgentState(':memory:');t.after(()=>state.close());let calls=0;
  const changed={...f.history,contacts:[{email_hash:'943b98e355344d03e122d706e1984717',suppressed:true,held:false}],counts:{...f.history.counts,contacts:1}};
  // Make the suppression apply to the actual synthetic contact.
  const {createHash}=await import('node:crypto');changed.contacts[0].email_hash=createHash('md5').update(f.record.public_email).digest('hex');
  const write=createLocalDraftWriter({state,history:async()=>changed,generate:async()=>{calls++;}});
  const rows=[{...f.record,quality_assessment:f.quality}];await write(rows);assert.equal(calls,0);assert.equal(rows[0].review_draft.status,'held');
  const id=await reviewIdentity(f.record);state.db.prepare("INSERT INTO local_drafts(id,lead_id,status,started_at) VALUES(?,?,'running',?)").run(id,f.record.lead_id,new Date().toISOString());
  const recovered=createLocalDraftWriter({state,history:async()=>f.history,generate:async()=>{calls++;}});await recovered(rows);assert.equal(rows[0].review_draft.status,'unknown');assert.equal(calls,0);
});
