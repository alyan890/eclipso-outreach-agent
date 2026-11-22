import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptExistingLead, evidenceSubject, qualifyLead, publicEvidenceURL } from '../src/qualification.mjs';

// ALL records/observations in this test are invented fixtures, not researched
// businesses, published observations, deliverable contacts or sales results.
const NOW = '2026-10-23T16:00:00.000Z';
const base = {
  lead_id: 'ct:SYNTHETIC1', business_name: 'Synthetic Example Cafe LLC',
  public_email: 'synthetic.fixture@gmail.com', city: 'Hartford', state: 'CT',
  niche: 'Snack and Nonalcoholic Beverage Bars (722515)',
  registration_date: '2006-01-01',
  source_url: 'https://data.ct.gov/resource/n7gp-d28j.json',
};
function evidence(record = base) {
  const common = { subject: evidenceSubject(record), observed_at: '2026-10-23T14:00:00Z',
    url: 'https://synthetic-fixture-business.org/contact',
    observation: 'SYNTHETIC TEST ONLY: this observation is invented for a deterministic test.' };
  return [
    { ...common, id: 'fixture:identity', kind: 'IDENTITY', basis: 'BUSINESS_OWNED_PAGE', business_name_match: true },
    { ...common, id: 'fixture:location', kind: 'LOCATION', country: 'US', state: record.state,
      city: record.city, operating_location: true },
    { ...common, id: 'fixture:activity', kind: 'ACTIVITY', basis: 'CURRENT_BUSINESS_OFFER', active: true },
    { ...common, id: 'fixture:contact', kind: 'CONTACT', basis: 'BUSINESS_PUBLISHED_CONTACT',
      business_name_match: true, email: record.public_email },
    { ...common, id: 'fixture:gap', kind: 'WEBSITE_GAP', gap: 'OWNER_CONFIRMED_NO_ONLINE_ORDERING',
      basis: 'EXPLICIT_BUSINESS_STATEMENT', statement_current: true },
  ];
}
const run = (record = base, overrides = {}) => qualifyLead(record, { now: NOW, observations: evidence(record), ...overrides });

test('existing backend adapter preserves field names and old registration dates', () => {
  const r = adaptExistingLead({ ...base, public_email: ' Synthetic.Fixture@Gmail.Com ' });
  assert.equal(r.registration_date, '2006-01-01');
  assert.equal(r.public_email, 'synthetic.fixture@gmail.com');
  assert.equal(r.lead_id, base.lead_id);
});
test('established cafe qualifies for ordering draft review, never sending', () => {
  const out = run();
  assert.equal(out.decision, 'QUALIFIED');
  assert.equal(out.service, 'ORDERING');
  assert.equal(out.registration_age_used, false);
  assert.equal(out.sending_authorized, false);
  assert.equal(out.production_review, null);
  assert.equal(out.deliverability, 'UNVERIFIED');
  assert.equal(out.qualified_for, 'DRAFT_REVIEW_ONLY');
  assert.equal(out.evidence_ids.length, 5);
});
test('new and old registrations receive identical evidence decisions', () => {
  assert.equal(run({ ...base, registration_date: '2026-10-22' }).decision, run().decision);
});
test('business type and registry email alone do not prove a gap or ownership', () => {
  const out = run(base, { observations: [] });
  assert.equal(out.decision, 'NEEDS_RESEARCH');
  assert.ok(out.reasons.includes('OPPORTUNITY_EVIDENCE_REQUIRED'));
  assert.ok(out.reasons.includes('BUSINESS_CONTACT_ASSOCIATION_REQUIRED'));
});
test('restaurants are retained instead of excluded as an unsupported niche', () => {
  const out = run({ ...base, niche: 'Full-Service Restaurants (722511)' });
  assert.equal(out.decision, 'QUALIFIED');
  assert.equal(out.industry, 'RESTAURANT');
});
for (const [label, code] of [['DENTAL', '621210'], ['CLINIC', '621111'], ['AESTHETICS', '812199']]) {
  test(`${label} can qualify for booking even when it already has a website`, () => {
    const record = { ...base, niche: `Practice (${code})`, known_website: 'https://synthetic-fixture-business.org' };
    const observations = evidence(record);
    observations[4].gap = 'OWNER_CONFIRMED_NO_ONLINE_BOOKING';
    assert.equal(run(record, { observations }).service, 'BOOKING');
  });
}
test('other US states are supported with operating-location evidence', () => {
  assert.equal(run({ ...base, state: 'IL', city: 'Naperville', country: 'US' }).decision, 'QUALIFIED');
});
test('registry billing address alone is insufficient operating-location evidence', () => {
  const observations = evidence();
  observations[1].operating_location = false;
  assert.ok(run(base, { observations }).reasons.includes('US_OPERATING_LOCATION_REQUIRED'));
});
test('suppression and previous attempts override all positive evidence', () => {
  assert.deepEqual(run(base, { contact: { suppressed: true } }).reasons, ['SUPPRESSED_CONTACT']);
  assert.deepEqual(run(base, { priorAttempt: true }).reasons, ['PRIOR_CONTACT_ATTEMPT']);
});
test('delivery holds and shared-email duplicates need review', () => {
  assert.equal(run(base, { contact: { held: true } }).decision, 'NEEDS_RESEARCH');
  assert.deepEqual(run(base, { duplicate: true }).reasons, ['DUPLICATE_IDENTITY_REVIEW']);
});
test('business-domain email exclusion is a targeting preference, not a website claim', () => {
  const r = { ...base, public_email: 'info@synthetic-fixture-business.org' };
  assert.deepEqual(run(r).reasons, ['CUSTOM_DOMAIN_CONTACT_PREFERENCE']);
  assert.equal(run(r, { freeProviderOnly: false }).decision, 'QUALIFIED');
});
test('non-US businesses are out of scope', () => {
  assert.deepEqual(run({ ...base, country: 'CA' }).reasons, ['NON_US_BUSINESS']);
});
test('changed business, email, city or niche invalidates previous evidence', () => {
  for (const change of [{ business_name: 'Another Clinic' }, { public_email: 'other@gmail.com' },
    { city: 'New Haven' }, { niche: 'Dentists (621210)' }]) {
    const out = run({ ...base, ...change }, { observations: evidence() });
    assert.deepEqual(out.reasons, ['STALE_CHANGED_OR_INVALID_EVIDENCE']);
  }
});
test('stale, malformed and future observations are held', () => {
  for (const timestamp of ['2026-10-15T14:00:00Z', '2026-10-24T14:00:00Z', 'not-a-time']) {
    const observations = evidence();
    observations[0].observed_at = timestamp;
    assert.equal(run(base, { observations }).decision, 'NEEDS_RESEARCH');
  }
});
test('stable IDs cannot be counted twice', () => {
  const observations = evidence();
  assert.deepEqual(run(base, { observations: [...observations, observations[0]] }).reasons,
    ['DUPLICATE_OR_INVALID_EVIDENCE_ID']);
});
test('conflicting evidence prevents automatic qualification', () => {
  const observations = evidence();
  observations.push({ ...observations[0], id: 'fixture:conflict', kind: 'CONTRADICTION' });
  assert.deepEqual(run(base, { observations }).reasons, ['CONFLICTING_EVIDENCE']);
});
test('missing homepage button or OSM website field is not a verified booking gap', () => {
  for (const basis of ['NO_BUTTON_ON_HOMEPAGE', 'OSM_WEBSITE_FIELD_MISSING', 'SEARCH_RESULT_ABSENT']) {
    const observations = evidence();
    observations[4].basis = basis;
    assert.ok(run(base, { observations }).reasons.includes('OPPORTUNITY_EVIDENCE_REQUIRED'));
  }
});
test('parked site must be associated with the business and exact observed gap', () => {
  const observations = evidence();
  Object.assign(observations[4], { gap: 'PARKED_DOMAIN', basis: 'OBSERVED_PARKED_PAGE',
    site_url: 'https://synthetic-fixture-business.org', site_linked_from_business_page: true });
  assert.equal(run(base, { observations }).service, 'WEBSITE');
  observations[4].basis = 'OBSERVED_SITE_FAILURE';
  assert.equal(run(base, { observations }).decision, 'NEEDS_RESEARCH');
  observations[4].basis = 'OBSERVED_PARKED_PAGE';
  observations[4].site_linked_from_business_page = false;
  assert.equal(run(base, { observations }).decision, 'NEEDS_RESEARCH');
});
test('single transient site failure cannot qualify; repeated 24h checks can', () => {
  const observations = evidence();
  Object.assign(observations[4], { gap: 'BROKEN_SITE', basis: 'OBSERVED_SITE_FAILURE',
    site_url: 'https://synthetic-fixture-business.org', site_linked_from_business_page: true });
  assert.deepEqual(run(base, { observations }).reasons, ['REPEATED_SITE_FAILURE_REQUIRED']);
  observations.push({ ...observations[4], id: 'fixture:gap:earlier', observed_at: '2026-10-22T13:00:00Z' });
  const out = run(base, { observations });
  assert.equal(out.decision, 'QUALIFIED');
  assert.ok(out.evidence_ids.includes('fixture:gap:earlier'));
});
test('irrelevant booking offer and unknown industry stay in research, not auto-rejected', () => {
  const r = { ...base, niche: '', category: 'ROOFING' };
  const observations = evidence(r);
  observations[4].gap = 'OWNER_CONFIRMED_NO_ONLINE_BOOKING';
  assert.deepEqual(run(r, { observations }).reasons, ['BOOKING_SERVICE_FIT_REQUIRED']);
  assert.deepEqual(run({ ...base, niche: '' }).reasons, ['INDUSTRY_FIT_UNCONFIRMED']);
});
test('evidence sources reject private, credentialed, IP and insecure URLs', () => {
  for (const url of ['http://site.org', 'https://127.0.0.1', 'https://[::1]', 'https://site.local',
    'https://site.internal', 'https://secret@site.org', 'https://site.org:8443', 'https://test.example']) {
    assert.equal(publicEvidenceURL(url), false, url);
  }
});
test('evaluation is deterministic and does not mutate evidence', () => {
  const observations = evidence();
  const before = structuredClone(observations);
  assert.deepEqual(run(base, { observations }), run(base, { observations }));
  assert.deepEqual(observations, before);
  assert.throws(() => run(base, { now: 'bad' }), /timestamp/);
});
