export const HISTORY_ENDPOINT='https://your-project-ref.supabase.co/functions/v1/eclipso-research-history';
export const HISTORY_RPC='eclipso_research_history_v1';
export const businessHistoryKey=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const email=value=>String(value??'').trim().toLowerCase();
export function historyScope(records){
  if(!Array.isArray(records)||!records.length||records.length>25)throw new Error('HISTORY_SCOPE_INVALID');
  const scope={p_emails:[],p_business_keys:[],p_lead_ids:[]};
  for(const row of records){
    const address=email(row.public_email),name=businessHistoryKey(row.business_name),id=row.lead_id;
    if(!/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[a-z]{2,}$/i.test(address)||address.length>254||!name||name.length>180||typeof id!=='string'||!id||id.length>150||/[\x00-\x1f]/.test(id))throw new Error('HISTORY_SCOPE_INVALID');
    scope.p_emails.push(address);scope.p_business_keys.push(name);scope.p_lead_ids.push(id);
  }
  for(const key of Object.keys(scope))scope[key]=[...new Set(scope[key])].sort();return scope;
}
export function validateHistorySnapshot(value,scope,{now=Date.now()}={}){
  const at=Date.parse(value?.observed_at);
  if(value?.status!=='HISTORY_SNAPSHOT'||value.complete!==true||value.source_url!==HISTORY_ENDPOINT||!Number.isFinite(at)||at>now+1000||now-at>2*3600000)throw new Error('HISTORY_RESPONSE_INVALID');
  for(const [output,input] of [['scope_emails','p_emails'],['scope_business_names','p_business_keys'],['scope_lead_ids','p_lead_ids']]){
    if(!Array.isArray(value[output])||JSON.stringify([...new Set(value[output])].sort())!==JSON.stringify(scope[input]))throw new Error('HISTORY_SCOPE_MISMATCH');
  }
  const digest=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
  for(const kind of ['leads','contacts','sends','queue']){
    const rows=value[kind];if(!Array.isArray(rows)||rows.length>500||value.counts?.[kind]!==rows.length||rows.some(row=>!digest(row.email_hash)))throw new Error('HISTORY_RESPONSE_INVALID');
    if(kind==='contacts'&&rows.some(row=>typeof row.suppressed!=='boolean'||typeof row.held!=='boolean'))throw new Error('HISTORY_RESPONSE_INVALID');
    if(kind==='leads'&&rows.some(row=>typeof row.lead_id!=='string'||typeof row.business_key!=='string'))throw new Error('HISTORY_RESPONSE_INVALID');
    if(['sends','queue'].includes(kind)&&rows.some(row=>typeof row.state!=='string'||typeof row.lead_id!=='string'))throw new Error('HISTORY_RESPONSE_INVALID');
  }
  return value;
}
