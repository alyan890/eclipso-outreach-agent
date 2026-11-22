import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotUploadMetadata,uploadPilot,PILOT_SCRIPT_API} from '../src/deploy-pilot.mjs';
const settings=()=>({compatibility_date:'2026-10-23',compatibility_flags:[],observability:{enabled:true},bindings:[
  ...Object.entries({MODULE1_ENABLED:'true',FREE_PLAN_CONFIRMED:'true',AGENT_MODE:'draft_only',DAILY_MODEL_CALL_LIMIT:'1',DRAFT_REVIEW_ENABLED:'true'}).map(([name,text])=>({name,text,type:'plain_text'})),
  {name:'AI',type:'ai'},{name:'PILOT_DB',type:'d1',id:'bd232478-6deb-4733-9af5-a85664e2386e'},{name:'DRAFT_REVIEW_SECRET',type:'secret_text'}]});
const source="const REVIEW_PILOT_LIMIT=5; if(path==='/review-draft'){}";
test('API upload preserves all bindings by strict inheritance and does not contain secrets',()=>{
  const original=settings(),metadata=pilotUploadMetadata(original);assert.equal(metadata.bindings.length,original.bindings.length);assert.ok(metadata.bindings.every(b=>b.type==='inherit'));
  assert.deepEqual(metadata.observability,original.observability);assert.equal(metadata.compatibility_date,original.compatibility_date);
  const wrong=settings();wrong.bindings.find(b=>b.name==='FREE_PLAN_CONFIRMED').text='false';assert.throws(()=>pilotUploadMetadata(wrong));
});
test('official API uploader is fixed to this Worker and backs up before its one PUT',async()=>{
  let backedUp=false,puts=0;
  const result=await uploadPilot({token:'synthetic-deployment-token-fixture',source,backup:async text=>{assert.match(text,/m1_runs/);backedUp=true;},request:async(url,options)=>{
    assert.ok(url.startsWith(PILOT_SCRIPT_API));assert.equal(options.redirect,'error');
    if(url.endsWith('/settings'))return Response.json({success:true,result:settings()});
    if(options.method==='PUT'){assert.equal(backedUp,true);puts++;assert.match(url,/bindings_inherit=strict/);const metadata=JSON.parse(await options.body.get('metadata').text());assert.ok(metadata.bindings.every(b=>b.type==='inherit'));return Response.json({success:true,result:{version_id:'synthetic-version'}});}
    return new Response('m1_runs synthetic_fixture_required');
  }});
  assert.equal(puts,1);assert.equal(result.version_id,'synthetic-version');
});
test('failed backup or access check prevents upload',async()=>{
  let puts=0;const request=async(url,options)=>{
    if(options.method==='PUT')puts++;
    return url.endsWith('/settings')?Response.json({success:true,result:settings()}):new Response('m1_runs synthetic_fixture_required');
  };
  await assert.rejects(uploadPilot({token:'synthetic-deployment-token-fixture',source,request,backup:async()=>{throw new Error('backup unavailable');}}));assert.equal(puts,0);
});
