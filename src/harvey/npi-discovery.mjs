// Eclipso's additional free nationwide source, not a Harvey implementation.
// Organization records only; no authorized-official personal details retained.
import {validateUSMarket} from './us-markets.mjs';
export function npiQuery({state,category,limit=2}){
  validateUSMarket({name:'US state search',country:'US',state,lat:0,lon:0});
  if(!['DENTAL','CLINIC'].includes(category)||!Number.isInteger(limit)||limit<1||limit>10)throw new TypeError('Bounded healthcare query required');
  const url=new URL('https://npiregistry.cms.hhs.gov/api/');
  for(const [key,value] of Object.entries({version:'2.1',enumeration_type:'NPI-2',state,taxonomy_description:category==='DENTAL'?'Dentist':'Clinic/Center',limit:String(limit)}))url.searchParams.set(key,value);
  return url.href;
}
export function normalizeNPI(payload,{state,category,observedAt,queryUrl}){
  if(!Array.isArray(payload?.results)||payload.results.length>10||payload.Errors||!Number.isFinite(Date.parse(observedAt)))throw new TypeError('Valid bounded registry response required');
  const seen=new Set();
  return payload.results.flatMap(r=>{
    const address=r.addresses?.find(a=>a.address_purpose==='LOCATION'&&a.country_code==='US'&&a.state===state);
    const validTaxonomy=r.taxonomies?.some(t=>category==='DENTAL'?/^1223/.test(t.code):/^261Q/.test(t.code));
    if(r.enumeration_type!=='NPI-2'||r.basic?.status!=='A'||!r.basic.organization_name||!address||!validTaxonomy||!/^\d{10}$/.test(String(r.number))||seen.has(r.number))return [];
    seen.add(r.number);
    return [{lead_id:`npi:${r.number}`,business_name:r.basic.organization_name,category,
      category_basis:'NPPES_ORGANIZATION_TAXONOMY',city:address.city,state:address.state,country:'US',
      address:[address.address_1,address.address_2,address.postal_code].filter(Boolean).join(' '),phone:address.telephone_number??'',
      source_url:`https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
      source_dataset:'CMS NPPES NPI Registry — organization record',source_observed_at:observedAt,source_query_url:queryUrl,
      registry_last_updated:r.basic.last_updated,registry_enumerated:r.basic.enumeration_date,
      website_url:null,website_status:'UNKNOWN_SOURCE_HAS_NO_WEBSITE_FIELD',public_email:'',published_emails:[],
      contact_status:'CONTACT_RESEARCH_REQUIRED',operating_location_verified:false,active_business_verified:false,
      website_need_verified:false,sending_authorized:false}];
  });
}
