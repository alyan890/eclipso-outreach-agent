// Scout-style bounded reading. Transport still enforces DNS, robots and access gates.
export async function collectSitePages(home,plan,reader){
 const maxPages=Math.min(6,Math.max(1,Number(plan.max_pages)||1)),maxFetches=Math.min(10,Math.max(1,Number(plan.max_fetches)||1));
 const origin=new URL(home.source_url).hostname,canonical=u=>new URL(u).href.replace(/\/$/,'');
 const published=new Set((home.followup_links??[]).map(l=>canonical(l.url)));
 // Published service/contact links take precedence over guessed fallback paths.
 const planned=plan.links??[];
 const links=[...new Set([...planned.filter(u=>published.has(canonical(u))),...(home.followup_links??[]).map(l=>l.url),...planned.filter(u=>!published.has(canonical(u)))])].filter(url=>{try{return canonical(url)!==canonical(home.source_url)&&new URL(url).hostname===origin;}catch{return false;}});
 const pages=[home],issues=[],bodies=new Set([home.visible_text]),seen=new Set([canonical(home.source_url)]);let fetches=1;
 for(const url of links){
  if(pages.length>=maxPages||fetches>=maxFetches-1)break;fetches++;
  try{
   const page=await reader(url),key=canonical(page.source_url);
   if(new URL(page.source_url).hostname!==origin){issues.push('CROSS_HOST_REDIRECT_HELD');continue;}
   if(seen.has(key)||bodies.has(page.visible_text)){if(published.has(canonical(url)))issues.push('PUBLISHED_FOLLOWUP_ALIASES_EXISTING_CONTENT');continue;}
   seen.add(key);bodies.add(page.visible_text);pages.push(page);
  }catch(error){
   // An absent guessed fallback is expected; a broken published link is not.
   if(!published.has(canonical(url))&&/^page_http_(404|410)$/.test(error.message))continue;
   issues.push('PAGE_HELD:'+String(error.message).slice(0,100));
  }
 }
 return {pages,issues,pageReads:fetches};
}
