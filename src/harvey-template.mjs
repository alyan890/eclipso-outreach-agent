import {approvalHash,validateEditedEmail,approvedHarveyMessage,HARVEY_FOOTER} from './harvey-approval.mjs';
export const DEFAULT_HARVEY_WORDING={subject:'a website idea for {business_name}',body:'Hi,\n\nWe’re Eclipso Digital. We noticed your website is still under construction.\n\nCould we put together a quick homepage preview for {business_name}?\n\nWould you like us to send it over?\n\nEclipso Digital'};
export async function normalizeHarveyTemplate(input){
  const {subject,body}=validateEditedEmail(input?.subject,input?.body);
  if(!(subject+' '+body).includes('{business_name}')||/[{}]/.test((subject+' '+body).replaceAll('{business_name}',''))||!/(under construction|coming soon|unfinished|placeholder)/i.test(body))throw new Error('HARVEY_TEMPLATE_INVALID');
  const value={scope:'PLACEHOLDER_SITE',subject,body,footer:HARVEY_FOOTER};
  return {...value,version:await approvalHash(JSON.stringify(value)),enabled:true};
}
export async function verifyHarveyTemplate(template){
  const verified=await normalizeHarveyTemplate(template);
  if(template?.enabled!==true||template.scope!==verified.scope||template.footer!==verified.footer||template.version!==verified.version)throw new Error('HARVEY_TEMPLATE_REAPPROVAL_REQUIRED');
  return verified;
}
export async function templateCandidate(row,{now=Date.now()}={}){
  const publicChecks=['identity','us_location','active_offer','contact','opportunity'];
  if(row?.status==='EXCLUDED'||row?.country!=='US'||row?.opportunity?.type!=='PLACEHOLDER_SITE'||!publicChecks.every(k=>row.qualityChecks?.some(c=>c.key===k&&c.met)))return null;
  const contacts=[...new Set((row.contacts??[]).filter(c=>c.association==='BUSINESS_OWNED_PAGE_MATCHED').map(c=>c.email.toLowerCase()))];
  if(contacts.length!==1)return null;
  const gap=(row.evidence??[]).find(e=>e.kind==='WEBSITE_GAP'&&Number.isFinite(Date.parse(e.observed))&&Date.parse(e.observed)<=now&&now-Date.parse(e.observed)<=48*3600000);
  if(!gap)return null;
  const facts={lead_id:row.id,business_name:row.business,email:contacts[0],source_url:gap.source,evidence_observed_at:gap.observed,scope:'PLACEHOLDER_SITE'};
  return {...facts,evidence_fingerprint:'shadow-draft-v1:'+await approvalHash(JSON.stringify(facts)),checked_at:new Date(now).toISOString()};
}
export async function renderHarveyTemplate(template,candidate,{now=Date.now()}={}){
  const t=await verifyHarveyTemplate(template);
  if(candidate?.scope!==t.scope)throw new Error('HARVEY_TEMPLATE_SCOPE_MISMATCH');
  const fill=text=>text.replaceAll('{business_name}',candidate.business_name);
  return {...await approvedHarveyMessage({...candidate,subject:fill(t.subject),body:fill(t.body),draft_id:'template-v1:'+await approvalHash(candidate.lead_id+'\n'+t.version)},{now,templateVersion:t.version}),template_scope:candidate.scope};
}
