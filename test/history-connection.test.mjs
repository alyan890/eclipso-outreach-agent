import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {HISTORY_ENDPOINT,historyScope,validateHistorySnapshot} from '../src/history-contract.mjs';
import {createHistoryReader} from '../src/history-client.mjs';
import {historyHandler} from '../src/history-service.mjs';
import {historyState} from '../src/research-quality.mjs';
const token='a'.repeat(64),now=Date.now(),stamp=new Date(now).toISOString();
const records=[{lead_id:'synthetic:cafe',business_name:'Synthetic Cafe',public_email:'syntheticfixture@gmail.com'}];
const scope=historyScope(records),md5=value=>createHash('md5').update(value).digest('hex');
const snapshot=()=>({status:'HISTORY_SNAPSHOT',complete:true,source_url:HISTORY_ENDPOINT,observed_at:stamp,
  scope_emails:scope.p_emails,scope_business_names:scope.p_business_keys,scope_lead_ids:scope.p_lead_ids,
  leads:[],contacts:[],sends:[],queue:[],counts:{leads:0,contacts:0,sends:0,queue:0}});
const env=name=>({ECLIPSO_RESEARCH_HISTORY_SECRET:token,SUPABASE_URL:'https://your-project-ref.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-platform-only-service-key'})[name];
const req=(overrides={})=>new Request(HISTORY_ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({records}),...overrides});
test('history server authenticates before any database read and rejects non-POST calls',async()=>{
  let calls=0;const handle=historyHandler({env,request:async()=>{calls++;}});
  assert.equal((await handle(req({headers:{Authorization:'Bearer invalid','Content-Type':'application/json'}}))).status,401);
  assert.equal((await handle(new Request(HISTORY_ENDPOINT))).status,405);assert.equal(calls,0);
});
test('missing server secret fails closed; arbitrary database URL cannot be supplied',async()=>{
  let calls=0;const request=async()=>{calls++;};
  assert.equal((await historyHandler({env:()=>null,request})(req())).status,503);
  assert.equal((await historyHandler({env:name=>name==='SUPABASE_URL'?'https://unrelated.com':env(name),request})(req())).status,503);assert.equal(calls,0);
});
test('reader returns scoped hashes and never exposes its platform credential',async()=>{
  const handle=historyHandler({env,clock:()=>now,request:async(url,options)=>{
    assert.equal(url,'https://your-project-ref.supabase.co/rest/v1/rpc/eclipso_research_history_v1');
    assert.deepEqual(JSON.parse(options.body),scope);return Response.json(snapshot());
  }});
  const result=await handle(req()),text=await result.text();assert.equal(result.status,200);
  assert.doesNotMatch(text,/synthetic-platform-only-service-key/);assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.equal(validateHistorySnapshot(JSON.parse(text),scope,{now}).complete,true);
});
test('oversized, invalid and more-than-25 scopes are rejected before database reads',async()=>{
  let calls=0;const handle=historyHandler({env,request:async()=>{calls++;}});
  for(const body of [JSON.stringify({records:Array(26).fill(records[0])}),JSON.stringify({records:[{...records[0],public_email:'not-an-email'}]}),'x'.repeat(25000)])assert.equal((await handle(req({body}))).status,400);
  assert.equal(calls,0);
});
test('partial snapshots, count mismatches, wrong scope and unknown flags never become clear history',()=>{
  for(const value of [{...snapshot(),complete:false},{...snapshot(),scope_emails:['someoneelse@gmail.com']},{...snapshot(),counts:{...snapshot().counts,sends:1}},
    {...snapshot(),contacts:[{email_hash:md5(records[0].public_email),suppressed:null,held:false}],counts:{...snapshot().counts,contacts:1}},
    {...snapshot(),observed_at:new Date(now-3*3600000).toISOString()}])assert.throws(()=>validateHistorySnapshot(value,scope,{now}));
});
test('client uses only the fixed authenticated endpoint, caches fresh scope and rechecks after 15 minutes',async()=>{
  let clock=now,calls=0;const read=createHistoryReader({token,clock:()=>clock,request:async(url,options)=>{
    calls++;assert.equal(url,HISTORY_ENDPOINT);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);
    return Response.json({...snapshot(),observed_at:new Date(clock).toISOString()});
  }});
  await read(records);await read(records);assert.equal(calls,1);clock+=16*60000;await read(records);assert.equal(calls,2);
});
test('client retains no clear fallback after authorization or network failures',async()=>{
  let calls=0;const read=createHistoryReader({token,clock:()=>now,request:async()=>{calls++;return Response.json({error:token},{status:401});}});
  await assert.rejects(read(records),/HISTORY_ACCESS_REQUIRED/);await assert.rejects(read(records),/HISTORY_CONNECTION_COOLDOWN/);assert.equal(calls,1);
  await assert.rejects(createHistoryReader() (records),/HISTORY_CONNECTION_REQUIRED/);
});

test('client waits out bounded server clock skew without changing evidence timestamps',async()=>{
  let clock=now,waited=0;
  const observed_at=new Date(now+1500).toISOString();
  const read=createHistoryReader({token,clock:()=>clock,wait:async ms=>{waited+=ms;clock+=ms;},request:async()=>Response.json({...snapshot(),observed_at})});
  const result=await read(records);
  assert.equal(result.observed_at,observed_at);assert.equal(waited,1501);
  assert.ok(historyState(records[0],result,{now:new Date(clock).toISOString()}));
  let excessiveWait=false;
  const invalid=createHistoryReader({token,clock:()=>now,wait:async()=>{excessiveWait=true;},request:async()=>Response.json({...snapshot(),observed_at:new Date(now+5001).toISOString()})});
  await assert.rejects(invalid(records),/HISTORY_RESPONSE_INVALID/);assert.equal(excessiveWait,false);
  const stuck=createHistoryReader({token,clock:()=>now,wait:async()=>{},request:async()=>Response.json({...snapshot(),observed_at})});
  await assert.rejects(stuck(records),/HISTORY_RESPONSE_INVALID/);
});
test('new API snapshots preserve alternate-email business opt-outs and prior attempts',()=>{
  const h=snapshot(),email_hash=md5('older-business-contact@gmail.com');
  h.leads=[{lead_id:'older:business',email_hash,business_key:'syntheticcafe'}];h.counts.leads=1;
  h.contacts=[{email_hash,suppressed:true,held:false}];h.counts.contacts=1;
  h.sends=[{email_hash,lead_id:'older:business',state:'FAILED'}];h.counts.sends=1;
  const state=historyState(records[0],h,{now:stamp});assert.equal(state.suppressed,true);assert.equal(state.priorAttempt,true);assert.equal(state.duplicate,true);
  assert.equal(historyState({...records[0],lead_id:'changed:id'},h,{now:stamp}),null);
});
