// Owner-approved local validation cohort. Does not change the regular discovery policy.
export const FOCUSED_QUERY_LIMIT=4;
export const focusedQueries=[
 {category:'AESTHETICS',state:'AZ',query:'salon ("website coming soon" OR "website under construction") Arizona contact -site:facebook.com -site:instagram.com'},
 {category:'RESTAURANT',state:'TX',query:'restaurant ("website coming soon" OR "website under construction") Texas contact -site:facebook.com -site:instagram.com'},
 {category:'PLUMBING',state:'FL',query:'plumbing ("website coming soon" OR "website under construction") Florida contact -site:facebook.com -site:instagram.com'},
 {category:'ROOFING',state:'NC',query:'roofing ("website coming soon" OR "website under construction") "North Carolina" contact -site:facebook.com -site:instagram.com'},
];
export function discoveryOrganizationHold(page){
 const name=[page.site_name,page.title,page.heading].filter(Boolean).join(' ');
 if(/\b(?:association|federation|chamber of commerce|business directory|trade body|call for entry)\b/i.test(name))return 'ASSOCIATION_OR_DIRECTORY_NOT_A_TARGET_SERVICE_BUSINESS';
 if(/\b(?:newspaper|hyperlocal news|news media|service directory|tenant directory)\b/i.test(name))return 'PUBLISHER_OR_DIRECTORY_NOT_THE_SERVICE_BUSINESS';
 if(/^(?:log in|login|sign in)$/i.test(String(page.heading??'').trim())&&/username|password|account/i.test(page.visible_text??''))return 'AUTHENTICATED_PORTAL_NOT_A_PUBLIC_SERVICE_BUSINESS';
 return null;
}
export function distinctDiscoverySites(searches,excluded=new Set(),limit=20){
 const seen=new Set(),groups=[];
 for(const search of searches){const candidates=[];for(const business of search.businesses??[]){
  try{const u=new URL(business.website),domain=u.hostname.replace(/^www\./,'');if(u.protocol!=='https:'||u.username||u.password||seen.has(domain)||excluded.has(domain))continue;seen.add(domain);candidates.push({...business,category:search.category,queryId:search.queryId,discoveredAt:search.finishedAt,entryURL:u.href,homepage:new URL('/',u).href});}catch{}
 }groups.push(candidates);}
 const out=[];while(out.length<limit&&groups.some(v=>v.length))for(const group of groups)if(group.length&&out.length<limit)out.push(group.shift());return out;
}
