import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDiscoverySite,matchesResearchIdentity,refreshDiscoveryIdentity} from '../src/discovery-diagnostics.mjs';
import {matchesBusiness} from '../src/research-quality.mjs';
import {nativeResearchResult} from '../src/native-data-quality.mjs';
import {assessmentDecision,assessmentBasis} from '../src/research-assessment.mjs';
import {nativeDataCopy,copyDiscoveryAudit} from '../src/native-data-contract.mjs';
const at='2026-10-26T08:00:00.000Z';
const page=(text,extra={})=>({source_url:'https://example.org/',observed_at:at,site_name:'Example Renovations',title:'Example Renovations',visible_text:text,published_emails:[],...extra});
test('actual first-party service corrects the query category, without requiring ZIP or street',()=>{
 const pages=[page('Example Renovations. Serving Pinellas County, Florida. We provide remodeling. Our services: home renovations.')];
 const d=analyzeDiscoverySite(pages,{category:'PLUMBING'});
 assert.equal(d.disposition,'BUSINESS_RESEARCH');assert.equal(d.category,'CONSTRUCTION');assert.equal(d.categoryCorrected,true);
 assert.equal(d.record.state,'FL');assert.equal(d.record.address,'');assert.equal(d.record.research_identity.scope,'SERVICE_AREA');
 assert.equal(matchesBusiness(d.record,pages[0]).matched,false,'mail qualification must remain strict');
 assert.equal(matchesResearchIdentity(d.record,pages[0],pages),true);
 const r=nativeResearchResult(d.record,pages,{});assert.equal(r.identityMatched,true);assert.equal(r.status,'CONTACT_RESEARCH');assert.equal(r.sendingAuthorized,false);
});
test('US state in query and a city embedded in a domain cannot establish location',()=>{
 const pages=[page('Le Bella Salon & Medspa is open and welcoming clients in Scottsdale.',{site_name:'',title:'Website Coming Soon - Le Bella Salon & Medspa',source_url:'https://www.lebellascottsdale.com/'})];
 const d=analyzeDiscoverySite(pages,{category:'AESTHETICS',state:'AZ'});assert.equal(d.reason,'US_STATE_OR_OPERATING_LOCALITY_UNCONFIRMED');assert.equal(d.business,'Le Bella Salon & Medspa');assert.equal(d.record,null);assert.ok(d.partial);
});
test('structured town and US state establish research locality without a postal address',()=>{
 const p=page('Example Renovations. Our services: remodeling.',{business_entities:[{name:'Example Renovations',address:{addressLocality:'Clearwater',addressRegion:'Florida',addressCountry:'US'}}]});
 const d=analyzeDiscoverySite([p],{category:'CONSTRUCTION'});assert.equal(d.record.city,'Clearwater');assert.equal(d.record.state,'FL');assert.equal(d.record.address,'');assert.equal(d.record.source_observed_at,at);
 assert.equal(matchesResearchIdentity(d.record,p,[p]),true);
 const gb=structuredClone(p);gb.business_entities[0].address.addressCountry='GB';assert.equal(analyzeDiscoverySite([gb],{category:'CONSTRUCTION'}).record,null);
});
test('branch lists are retained at brand scope instead of inventing a single business address',()=>{
 const p=page('Elm Street Diner. Our menu. Order now. Stamford location 463 Elm St Stamford CT 06902. Norwalk location 515 West Ave Unit P2 Norwalk CT 06850.',{site_name:'Elm Street Diner',title:'Landing Page - Elm Street Diner'});
 const d=analyzeDiscoverySite([p],{category:'PLUMBING'});assert.equal(d.category,'RESTAURANT');assert.equal(d.record.research_identity.scope,'BRAND_NOT_SINGLE_BRANCH');assert.equal(d.record.research_identity.locations.length,2);assert.equal(d.record.address,'');
 assert.equal(matchesResearchIdentity(d.record,p,[p]),true);assert.equal(matchesBusiness(d.record,p).matched,false);
 const r=nativeResearchResult(d.record,[p],{});assert.equal(r.identityMatched,true);assert.equal(r.contacts.length,0);assert.notEqual(assessmentDecision(r).tier,'EVIDENCE_BACKED_PROSPECT');
});
test('ambiguous addresses without branch linkage remain held',()=>{
 const p=page('Example Renovations. Our services. 123 Main St Hartford CT 06103. A client mentioned 456 Other Rd Dallas TX 75001.');
 assert.equal(analyzeDiscoverySite([p],{category:'CONSTRUCTION'}).reason,'AMBIGUOUS_MULTIPLE_LOCATIONS');
});
test('phone suffixes never become street numbers; repeated branch entries deduplicate and retain units',()=>{
 const p=page('Elm Street Diner. Our menu. Stamford location Call us 203-325-1141 463 Elm St Stamford, CT 06902. Norwalk location 203-683-4863 515 West Ave Unit P2 Norwalk, CT 06850. Locations 203-325-1141 Call us 203-683-4863 463 Elm St Stamford, CT 06902. 515 West Ave Unit P2 Norwalk, CT 06850.',{site_name:'Elm Street Diner'});
 const d=analyzeDiscoverySite([p],{category:'PLUMBING'});assert.equal(d.record.research_identity.locations.length,2);
 assert.deepEqual(d.record.research_identity.locations.map(l=>l.address),['463 Elm St','515 West Ave Unit P2']);
});
test('later contact-page evidence upgrades locality proof while preserving the research record ID',()=>{
 const home=page('Example Renovations. Serving Pinellas County, Florida. We provide renovations.'),record=analyzeDiscoverySite([home],{category:'PLUMBING'}).record;
 const contact=page('Example Renovations. Contact us: 2071 Belleair Road Clearwater FL 33764.',{source_url:'https://example.org/contact'});
 const updated=refreshDiscoveryIdentity(record,[home,contact]);assert.equal(updated.lead_id,record.lead_id);assert.equal(updated.research_identity.scope,'SINGLE_LOCATION');assert.equal(updated.city,'Clearwater');assert.equal(matchesResearchIdentity(updated,contact,[home,contact]),true);
 assert.equal(refreshDiscoveryIdentity(record,[{...contact,site_name:'Other Renovations',visible_text:'Other Renovations. 2071 Belleair Road Clearwater FL 33764.'}]),record);
});
test('matching research proof cannot be copied to another identity, location or website',()=>{
 const p=page('Example Renovations. Serving Pinellas County, Florida. We provide renovations.'),d=analyzeDiscoverySite([p],{category:'CONSTRUCTION'});
 assert.equal(matchesResearchIdentity({...d.record,state:'TX'},p,[p]),false);
 assert.equal(matchesResearchIdentity(d.record,{...p,source_url:'https://other.org/'},[p]),false);
 assert.equal(matchesResearchIdentity(d.record,{...p,visible_text:'Someone else serving Texas.'},[p]),false);
 const tampered=structuredClone(d.record);tampered.research_identity.locations[0].quote='invented';assert.equal(matchesResearchIdentity(tampered,p,[p]),false);
});
test('access failures are not interpreted as missing sites; query hints do not identify sponsors',()=>{
 for(const issue of ['robots_unavailable_http_503','page_http_403','request_timeout']){
  const d=analyzeDiscoverySite([],{category:'ROOFING',issues:[issue]});assert.equal(d.disposition,'ACCESS_HOLD');assert.equal(d.detail,issue);assert.equal(d.record,null);
 }
 for(const extra of [{site_name:'Community Impact Newspaper'},{site_name:'Salon Service Directory'},{heading:'Log In',visible_text:'Username Password Restaurant'}])assert.equal(analyzeDiscoverySite([page('Restaurant mentions',extra)],{category:'RESTAURANT'}).disposition,'OFF_TARGET');
 const sponsor=page('Example Sports. Our corporate sponsors include a roofing contractor.',{site_name:'Example Sports',title:'Example Sports'});assert.equal(analyzeDiscoverySite([sponsor],{category:'ROOFING'}).record,null);
});
test('published email is retained separately from need; footer agency contact is rejected',()=>{
 const p=page('Example Renovations. Serving Pinellas County, Florida. Our services: remodeling. Email team@example.org.',{published_emails:['team@example.org','designer@agency.org'],contact_contexts:[{email:'designer@agency.org',unrelated_credit:true}]});
 const d=analyzeDiscoverySite([p],{category:'CONSTRUCTION'}),r=nativeResearchResult(d.record,[p],{contacts:[{email:'team@example.org'},{email:'designer@agency.org'}]});
 assert.deepEqual(r.contacts.map(c=>c.email),['team@example.org']);assert.equal(r.contacts[0].observed,at);assert.equal(r.sendingAuthorized,false);assert.notEqual(assessmentDecision(r).tier,'EVIDENCE_BACKED_PROSPECT');
 const copy=nativeDataCopy({mode:'research_only',sendingAuthorized:false,revision:'a'.repeat(40),rows:[r]});assert.equal(copy.rows[0].identityScope,'SERVICE_AREA');assert.equal(copy.rows[0].locationEvidence[0].observed,at);assert.deepEqual(nativeDataCopy(copy),copy);
 const edited=structuredClone(copy.rows[0]);edited.locationEvidence[0].quote='changed';assert.notEqual(assessmentBasis(edited),assessmentBasis(copy.rows[0]));
});
test('a directory repeating an exact legal name and address cannot become first-party identity/contact proof',()=>{
 const p=page('Example Renovations. Our services: remodeling. 123 Main St Hartford CT 06103. Email office@example.org.',{source_url:'https://healthdataatlas.com/organizations/example',listing_or_directory:false,published_emails:['office@example.org']});
 const record={lead_id:'directory-1',business_name:'Example Renovations',category:'CONSTRUCTION',address:'123 Main St 06103',city:'Hartford',state:'CT',country:'US',website_url:p.source_url,source_url:p.source_url,source_observed_at:at};
 assert.equal(matchesBusiness(record,p).matched,false);assert.equal(analyzeDiscoverySite([p],{category:'CONSTRUCTION'}).disposition,'OFF_TARGET');
 const row=nativeResearchResult(record,[p],{contacts:[{email:'office@example.org'}]});assert.equal(row.identityMatched,false);assert.equal(row.contacts.length,0);assert.equal(assessmentDecision(row).rank,0);
});
test('private discovery audit retains actionable outcomes while dropping unlisted fields and unsafe sources',()=>{
 const d={homepage:'https://example.org/',source:'https://example.org/contact',business:'Example Renovations',disposition:'BUSINESS_RESEARCH',queryCategory:'PLUMBING',category:'CONSTRUCTION',categoryCorrected:true,reason:'BUSINESS_AND_LOCATION_MATCHED',detail:'Published service area matched.',next:'Verify unmet need.',sourceObserved:at,retrievalAttemptedAt:at,secret:'not allowed',pages:['not allowed']};
 const audit=copyDiscoveryAudit({batchId:'saved-batch',replayedAt:at,queryCount:4,diagnostics:[d,{...d},{...d,homepage:'file:///private'},{...d,homepage:'https://other.org',disposition:'SEND_NOW'}]});
 assert.equal(audit.diagnostics.length,1);assert.equal(audit.counts.BUSINESS_RESEARCH,1);assert.equal(audit.diagnostics[0].sourceObserved,at);assert.doesNotMatch(JSON.stringify(audit),/not allowed|SEND_NOW|file:/);assert.deepEqual(copyDiscoveryAudit(audit),audit);
});
