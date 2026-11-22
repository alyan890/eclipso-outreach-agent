// Read the actual company root and its published contact/about/service links
// before declaring identity/location missing. Never cross a host/access gate.
import {collectSitePages} from './site-research.mjs';
import {planEvidenceReads} from './research-plan.mjs';
const key=url=>{const u=new URL(url);u.hash='';return u.href.replace(/\/$/,'');};
export async function discoveryPages(entry,readPage){
 const issues=[],cache=new Map([[key(entry.source_url),entry]]);let home=entry;
 const url=new URL(entry.source_url);
 if(!['/','/index.html','/index.php'].includes(url.pathname)){
  try{home=await readPage(new URL('/',url).href);cache.set(key(home.source_url),home);}
  catch(error){issues.push('HOMEPAGE_HELD:'+String(error.message).slice(0,100));}
 }
 const host=new URL(home.source_url).hostname;
 const guided=planEvidenceReads([home,entry],{maximum:3});
 const links=[...guided,...(home.followup_links??[]),...(entry.followup_links??[])].filter(l=>{try{return new URL(l.url).hostname===host;}catch{return false;}});
 const plan={links:[...(entry===home?[]:[entry.source_url]),...links.map(l=>l.url)],max_pages:4,max_fetches:6};
 const result=await collectSitePages(home,plan,async url=>{const prior=cache.get(key(url));if(prior)return prior;const page=await readPage(url);cache.set(key(url),page);return page;});
 return {...result,issues:[...issues,...result.issues]};
}
