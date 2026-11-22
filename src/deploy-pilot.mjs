// Official API fallback for the stalled dashboard editor. Fixed resource only.
export const PILOT_SCRIPT_API='https://api.cloudflare.com/client/v4/accounts/ffbfd0d3824ebcaf4c99934f094f8dae/workers/scripts/eclipso-email-agent-pilot';
export function pilotUploadMetadata(settings){
  if(!Array.isArray(settings?.bindings)||!/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date??''))throw new Error('DEPLOY_SETTINGS_NOT_VERIFIED');
  const byName=new Map(settings.bindings.map(b=>[b.name,b]));
  const expected={MODULE1_ENABLED:'true',FREE_PLAN_CONFIRMED:'true',AGENT_MODE:'draft_only',DAILY_MODEL_CALL_LIMIT:'1',DRAFT_REVIEW_ENABLED:'true'};
  if(Object.entries(expected).some(([name,value])=>byName.get(name)?.type!=='plain_text'||byName.get(name).text!==value)||byName.get('AI')?.type!=='ai'||byName.get('PILOT_DB')?.type!=='d1'||byName.get('PILOT_DB')?.id!=='bd232478-6deb-4733-9af5-a85664e2386e'||byName.get('DRAFT_REVIEW_SECRET')?.type!=='secret_text')throw new Error('DEPLOY_BINDINGS_NOT_VERIFIED');
  const metadata={main_module:'worker.mjs',bindings:settings.bindings.map(b=>({name:b.name,type:'inherit'})),annotations:{'workers/message':'Add capped review-only AI writer; preserve synthetic pilot'}};
  for(const field of ['compatibility_date','compatibility_flags','observability','limits','logpush','usage_model'])if(settings[field]!==undefined)metadata[field]=settings[field];
  return metadata;
}
export async function uploadPilot({token,source,request=fetch,backup}={}){
  if(!/^[A-Za-z0-9_-]{20,300}$/.test(token??'')||typeof source!=='string'||source.length>250000||!source.includes("'/review-draft'")||!source.includes('REVIEW_PILOT_LIMIT=5')||typeof backup!=='function')throw new Error('DEPLOY_INPUT_INVALID');
  const headers={Authorization:'Bearer '+token};
  const get=async path=>{
    const response=await request(PILOT_SCRIPT_API+path,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error([401,403].includes(response.status)?'DEPLOY_ACCESS_REQUIRED':'DEPLOY_READ_FAILED');return response;
  };
  const settingsEnvelope=await(await get('/settings')).json();if(settingsEnvelope.success!==true)throw new Error('DEPLOY_READ_FAILED');
  const metadata=pilotUploadMetadata(settingsEnvelope.result);
  const previous=await(await get('')).text();if(previous.length>2000000||!previous.includes('m1_runs')||!previous.includes('synthetic_fixture_required'))throw new Error('DEPLOY_SOURCE_NOT_VERIFIED');
  await backup(previous);
  const body=new FormData();body.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));body.append('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  const response=await request(PILOT_SCRIPT_API+'?bindings_inherit=strict',{method:'PUT',headers,body,redirect:'error',signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok||result.success!==true)throw new Error('DEPLOY_UPLOAD_FAILED');
  return {status:'PILOT_CODE_UPLOADED',observed_at:new Date().toISOString(),version_id:result.result?.version_id??result.result?.deployment_id??null,preserved_bindings:metadata.bindings.map(b=>b.name)};
}
