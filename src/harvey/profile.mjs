// Adapted from Harvey harvey/collectors/profile.py, pinned revision in discovery.mjs.
// Copyright (c) 2026 Ethan Rogers. MIT; see THIRD_PARTY_NOTICES.md.
// Reuses site fingerprints and booking hints as OBSERVATIONS, not buying intent.
import { safeWebsite } from './discovery.mjs';
export const MAX_PROFILE_BYTES = 1_500_000;
const TECH = {
  WordPress: [/wp-content\//i, /wp-includes\//i], Shopify: [/cdn\.shopify\.com/i, /myshopify\.com/i],
  Wix: [/static\.parastorage\.com/i], Squarespace: [/static1\.squarespace\.com/i],
  Webflow: [/assets\.website-files\.com/i, /data-wf-domain/i], Duda: [/irp\.cdn-website\.com/i],
  'GoDaddy Website Builder': [/img1\.wsimg\.com/i], HubSpot: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i],
  'Google Analytics': [/googletagmanager\.com\/gtag/i, /google-analytics\.com/i],
  'Google Tag Manager': [/googletagmanager\.com\/gtm\.js/i], Intercom: [/widget\.intercom\.io/i],
  Drift: [/js\.driftt\.com/i], Podium: [/connect\.podium\.com/i], Birdeye: [/birdeye\.com/i],
  Calendly: [/assets\.calendly\.com/i], ServiceTitan: [/servicetitan/i], Jobber: [/getjobber\.com/i],
  'Housecall Pro': [/housecallpro/i], CallRail: [/cdn\.callrail\.com/i], Stripe: [/js\.stripe\.com/i],
};
const BOOKING = /calendly\.com|acuityscheduling|schedulicity|squareup\.com\/appointments|setmore|book(?:ing)?[-_ ]?now|(?:book|schedule)[-_ ]?(?:an?[-_ ])?(?:appointment|estimate|consultation)|opentable\.com|resy\.com|housecallpro|getjobber\.com|servicetitan/i;
const ORDERING = /order\s+online|online\s+order|toasttab\.com|order\.online|chownow|square\.site|doordash\.com|ubereats\.com/i;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function visibleText(html) {
  return String(html).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? ' ';
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    }).replace(/\s+/g, ' ').trim();
}
export function isUnrelatedContact(context,email){
 const text=String(context??''),at=text.toLowerCase().indexOf(String(email).toLowerCase());
 const credit=/(?:website|site|web)\s*(?:design(?:ed)?|develop(?:ed|ment)?|built|powered)\s*(?:by)?|for project inquir|webmaster|hosting support/i;
 // A credit appearing AFTER a business inbox does not turn it into an agency inbox.
 return credit.test(at<0?text:text.slice(Math.max(0,at-130),at));
}
export function profilePage(html, { url, observedAt } = {}) {
  if (typeof html !== 'string' || html.length > MAX_PROFILE_BYTES || !safeWebsite(url) || !Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError('Bounded public page and actual source timestamp required');
  }
  const clean = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = visibleText(clean);
  // Structured data is only a candidate identity. Visible address/name matching
  // remains mandatory; a directory's embedded organization is not ownership.
  const businessEntities=[],publicationDates=[];
  const visit=(value,depth=0)=>{
    if(depth>6||businessEntities.length>30||!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const child of value.slice(0,50))visit(child,depth+1);return;}
    const types=[value['@type']].flat().join(' ');
    if(/Article|BlogPosting|NewsArticle|WebPage/.test(types)&&typeof value.datePublished==='string'&&Number.isFinite(Date.parse(value.datePublished)))publicationDates.push(new Date(value.datePublished).toISOString());
    if(/LocalBusiness|Restaurant|CafeOrCoffeeShop|Dentist|MedicalClinic|HealthAndBeautyBusiness|BeautySalon|HairSalon|RoofingContractor|HVACBusiness|Plumber|HomeAndConstructionBusiness|Organization/.test(types)&&typeof value.name==='string'&&value.address&&typeof value.address==='object'){
      const address={};for(const field of ['streetAddress','addressLocality','addressRegion','postalCode','addressCountry'])if(typeof value.address[field]==='string')address[field]=value.address[field].slice(0,180);
      businessEntities.push({name:visibleText(value.name).slice(0,180),address});
    }
    if(value['@graph'])visit(value['@graph'],depth+1);
  };
  for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    if(script[1].length>100000)continue;try{visit(JSON.parse(script[1]));}catch{/* Invalid markup supplies no evidence. */}
  }
  const siteName=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).find(m=>/property\s*=\s*["']og:site_name["']/i.test(m));
  for(const meta of html.matchAll(/<meta\b[^>]*>/gi)){if(!/(?:property|name)\s*=\s*["'](?:article:published_time|datePublished)["']/i.test(meta[0]))continue;const v=meta[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1];if(Number.isFinite(Date.parse(v)))publicationDates.push(new Date(v).toISOString());}
  const emailMatches = [
    ...(clean.matchAll(/href\s*=\s*["']mailto:([^"'?\s>]+)/gi)),
    ...(text.matchAll(/\b([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi)),
  ];
  const emails = [...new Set(emailMatches.map(m => m[1].toLowerCase()).filter(e =>
    e.length < 255 && !/^(?:example|test|yourname)@/i.test(e) && !/\.(png|jpg|svg|webp)$/i.test(e)))].slice(0, 10);
  const contactContexts = emails.map(email => {
    const at = text.toLowerCase().indexOf(email);
    const context = at >= 0 ? text.slice(Math.max(0, at - 180), at + email.length + 180) :
      visibleText(clean.slice(Math.max(0, clean.toLowerCase().indexOf(email) - 180), clean.toLowerCase().indexOf(email) + email.length + 180));
    return { email, context, unrelated_credit:isUnrelatedContact(context,email) };
  });
  const actionLinks = [...clean.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m => {
    try {
      const link = safeWebsite(new URL(m[1].replace(/&amp;/g, '&'), url).href), anchor = visibleText(m[2]).slice(0, 120);
      if (!link || !/book|appointment|reserv|order|consultation|schedule/i.test(anchor + ' ' + link)) return [];
      return [{ url: link, anchor }];
    } catch { return []; }
  }).filter((x,i,all)=>all.findIndex(y=>y.url===x.url)===i).slice(0,15);
  const links = [...clean.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .flatMap(m => {
      try {
        const link = new URL(m[1].replace(/&amp;/g, '&'), url);
        link.hash='';
        const anchor = visibleText(m[2]).slice(0, 100);
        const safe = safeWebsite(link.href);
        if (!safe || safe.replace(/\/$/,'')===String(url).split('#')[0].replace(/\/$/,'') || new URL(safe).hostname !== new URL(url).hostname ||
            !/contact|about|team|staff|owner|faq|f\.a\.q|booking|appointment|reserv|order|menu|service|news|announcement/i.test(anchor + ' ' + link.pathname)) return [];
        return [{ url: safe, anchor }];
      } catch { return []; }
    }).filter((x, i, all) => all.findIndex(y => y.url === x.url) === i).slice(0, 8);
  const parked = text.match(/\b(?:this domain (?:is |has been )?parked|domain (?:is )?for sale|website coming soon|website under construction|future home of)\b/i)?.[0] ?? null;
  // Tight visible role cards supplement upstream parsing. Founder prose is excluded.
  const blocks=[...clean.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(m=>visibleText(m[2])).filter(Boolean).slice(0,600);
  const humanName=s=>typeof s==='string'&&s.length<=90&&/^[\p{L}][\p{L}’'-]*(?:\s+[\p{L}][\p{L}’'-]*){1,3}$/u.test(s)&&! /\b(?:owner|staff|team|salon|contact|about|business|services|master|stylist|welcome|our|the)\b/i.test(s);
  const roleCards=[];
  for(let i=0;i<blocks.length;i++){
    const direct=blocks[i].match(/^((?:co[- ]?)?owner)\s+(.+)$/i),roleOnly=/^(?:co[- ]?)?owner(?:\s*(?:\/|and|&)\s*[\p{L} /&-]{2,60})?$/iu.test(blocks[i]);
    const directName=direct&&humanName(direct[2])?direct[2]:null,name=directName??(roleOnly&&humanName(blocks[i-1])?blocks[i-1]:null);
    if(name)roleCards.push({full_name:name.split(/\s+/).map(w=>w[0].toUpperCase()+w.slice(1)).join(' '),title:directName?'Owner':blocks[i],owner:true,source:'EXPLICIT_VISIBLE_ROLE_CARD',evidence:directName?blocks[i]:blocks[i-1]+' — '+blocks[i],evidence_url:url});
  }
  return {
    source_url: url, observed_at: observedAt,
    published_at:new Set(publicationDates).size===1?publicationDates[0]:null,
    business_entities:businessEntities,site_name:visibleText(siteName?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]??'').slice(0,180),
    listing_or_directory:/\b(?:business directory|find a dentist|business listings|provider directory)\b/i.test(text.slice(0,1000)),
    title: visibleText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 180),
    heading: visibleText(clean.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').slice(0, 180),
    technologies: Object.entries(TECH).filter(([, patterns]) => patterns.some(p => p.test(html))).map(([name]) => name).sort(),
    published_emails: emails, contact_contexts: contactContexts, followup_links: links, action_links: actionLinks,
    published_role_cards:roleCards.slice(0,8),
    booking_widget_detected: /(?:src|href)\s*=\s*["'][^"']*(?:calendly\.com|acuityscheduling|schedulicity|squareup\.com\/appointments|setmore|opentable\.com|resy\.com|housecallpro|getjobber\.com|servicetitan)/i.test(html),
    ordering_widget_detected: /(?:src|href)\s*=\s*["'][^"']*(?:toasttab\.com|order\.online|chownow|doordash\.com|ubereats\.com)/i.test(html),
    booking_signal: BOOKING.test(html) ? 'HINT_PRESENT_UNVERIFIED' : 'NOT_OBSERVED_NOT_PROOF_OF_ABSENCE',
    ordering_signal: ORDERING.test(html) ? 'HINT_PRESENT_UNVERIFIED' : 'NOT_OBSERVED_NOT_PROOF_OF_ABSENCE',
    parked_phrase: parked, parked_status: parked ? 'PHRASE_OBSERVED_IDENTITY_REVIEW_REQUIRED' : 'NOT_OBSERVED',
    excerpt: text.slice(0, 3500), visible_text: text.length>24000?text.slice(0,12000)+' [middle omitted] '+text.slice(-11980):text, visible_text_truncated: text.length > 24000,
    qualification: 'NEEDS_RESEARCH', sending_authorized: false,
  };
}
