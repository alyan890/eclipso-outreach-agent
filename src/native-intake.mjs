// Keep listing-first businesses, even without a website. Unknown never means no site.
export function businessIdentity(record){
 const clean=x=>String(x??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
 const name=clean(record.business_name),place=[record.address,record.city,record.state,record.country].map(clean).join('|');
 return name&&clean(place)?name+'|'+place:record.lead_id||record.external_id||'';
}
export function selectNativeCandidates(records){
 const seen=new Set(),groups=new Map();
 for(const record of records){const key=businessIdentity(record);if(!key||seen.has(key))continue;seen.add(key);const category=record.category??'UNKNOWN';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(record);}
 const selected=[];while([...groups.values()].some(v=>v.length))for(const values of groups.values())if(values.length)selected.push(values.shift());
 return selected;
}
export function nativeRefreshDue(previous,record,now=Date.now()){
 if(!previous)return true;
 if(!record.website_url)return previous.website!=null;
 const normalize=u=>String(u??'').replace(/\/$/,'').toLowerCase();
 if(normalize(previous.requestedWebsite??previous.website)!==normalize(record.website_url))return true;
 const age=now-Date.parse(previous.researchedAt),window=previous.opportunities?.some(o=>o.strength==='VERIFIED_GAP')?24*3600000:72*3600000;
 return !previous.website||previous.websiteEvidence?.version!=='business-evidence-v2'||!Number.isFinite(age)||age>=window;
}
