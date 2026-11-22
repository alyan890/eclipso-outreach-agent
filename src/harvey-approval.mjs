// Shared contract for the owner approval API and existing single mail worker.
export const HARVEY_FOOTER="Eclipso Digital | Digital Agency\neclipsodigital@gmail.com\n\nMailing address: [your mailing address]\nThis is a commercial introduction. To receive no further emails, reply 'no thanks'.";
export const approvalHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function validateEditedEmail(subject,body){
  if(typeof subject!=='string'||subject.trim().length<3||subject.length>120||/[\r\n\x00-\x1f]/.test(subject)||typeof body!=='string'||body.trim().length<70||body.length>1800||body.trim().split(/\s+/).length>=80||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body))throw new Error('HARVEY_INVALID_COPY');
  if(!/Eclipso Digital/i.test(body)||/\bAlyan\b|\bguarantee\w*\b|award.winning|certified|rank #?1/i.test(subject+' '+body))throw new Error('HARVEY_UNSUPPORTED_COPY');
  return {subject:subject.trim(),body:body.trim()};
}
export async function approvedHarveyMessage(input,{now=Date.now(),templateVersion=null}={}){
  const copy=validateEditedEmail(input?.subject,input?.body),email=input?.email;
  const draftPattern=templateVersion?/^template-v1:[a-f0-9]{64}$/:/^review-v1:[a-f0-9]{64}$/;
  if(templateVersion&&!/^[a-f0-9]{64}$/.test(templateVersion))throw new Error('HARVEY_TEMPLATE_INVALID');
  if(typeof input.lead_id!=='string'||!input.lead_id||input.lead_id.length>150||typeof input.business_name!=='string'||!input.business_name.trim()||input.business_name.length>180||/[\r\n]/.test(input.business_name)||typeof email!=='string'||email!==email.trim().toLowerCase()||!/^[^\s@]+@(gmail\.com|googlemail\.com|yahoo\.com|ymail\.com|outlook\.com|hotmail\.com|live\.com|msn\.com|aol\.com|icloud\.com|me\.com|protonmail\.com|proton\.me)$/.test(email)||!draftPattern.test(input.draft_id??'')||!/^shadow-draft-v1:[a-f0-9]{64}$/.test(input.evidence_fingerprint??''))throw new Error('HARVEY_INVALID_IDENTITY');
  let url;try{url=new URL(input.source_url);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{throw new Error('HARVEY_INVALID_SOURCE');}
  const at=Date.parse(input.evidence_observed_at),checked=Date.parse(input.checked_at);
  if(!Number.isFinite(at)||at>now+1000||now-at>48*3600000||!Number.isFinite(checked)||checked>now+1000||now-checked>120000)throw new Error('HARVEY_REFRESH_REQUIRED');
  const id='harvey:'+await approvalHash(input.lead_id),body=copy.body+'\n\n'+HARVEY_FOOTER;
  return {id,lead_id:input.lead_id,business_name:input.business_name,email,source_url:url.href,evidence_observed_at:new Date(at).toISOString(),checked_at:new Date(checked).toISOString(),draft_id:input.draft_id,evidence_fingerprint:input.evidence_fingerprint,subject:copy.subject,body:copy.body,approval_mode:templateVersion?'TEMPLATE':'MANUAL',template_version:templateVersion,draft_json:{subject:copy.subject,body,format:'plain',variant_id:templateVersion?'HARVEY_TEMPLATE_'+templateVersion.slice(0,12):'HARVEY_OWNER_EDIT_V1',copy_version:'HARVEY_OWNER_APPROVED_V1',message_sha256:await approvalHash(copy.subject+'\n'+body+'\n')}};
}
