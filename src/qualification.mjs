// Module 2: shadow-only evaluation. No network, database, model or send calls.
// Evidence is supplied by a collector/reviewer; validating this contract cannot
// independently establish that an observation is true.
export const QUALIFICATION_POLICY = 'ECLIPSO_SHADOW_QUALIFICATION_V1';
const DAY = 86_400_000;
const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me',
]);
const US_STATES = new Set(('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC').split(' '));
const CODE_GROUPS = {
  RESTAURANT: ['722511', '722513', '722514'],
  CAFE: ['722515'],
  DENTAL: ['621210'],
  CLINIC: ['621111', '621112', '621491', '621493', '621498'],
  AESTHETICS: ['812111', '812112', '812113', '812199'],
  OTHER_BOOKING: ['713940', '541940', '812910'],
};
const SERVICE_CATEGORIES = new Set([
  'ROOFING', 'HVAC', 'PLUMBING', 'LANDSCAPING', 'CONSTRUCTION', 'CLEANING',
  'AUTO_REPAIR', 'LOCAL_RETAIL', 'PHOTOGRAPHY',
]);
const GAP_TYPES = new Set([
  'OWNER_REQUESTED_WEBSITE', 'OWNER_CONFIRMED_NO_WEBSITE',
  'PARKED_DOMAIN', 'PLACEHOLDER_SITE', 'BROKEN_SITE',
  'OWNER_CONFIRMED_NO_ONLINE_BOOKING', 'OWNER_CONFIRMED_NO_ONLINE_ORDERING',
  'PUBLISHED_PHONE_BOOKING', 'PUBLISHED_PHONE_ORDERING',
]);
const OBSERVED_GAPS = {
  PARKED_DOMAIN: 'OBSERVED_PARKED_PAGE',
  PLACEHOLDER_SITE: 'OBSERVED_PLACEHOLDER_PAGE',
  BROKEN_SITE: 'OBSERVED_SITE_FAILURE',
};

function email(value) { return String(value ?? '').trim().toLowerCase(); }
function key(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function industry(record) {
  const code = String(record.niche ?? '').match(/\((\d{6})\)/)?.[1]
    ?? (/^\d{6}$/.test(String(record.naics_code)) ? String(record.naics_code) : '');
  for (const [group, codes] of Object.entries(CODE_GROUPS)) {
    if (codes.includes(code)) return group;
  }
  const category = String(record.category ?? '').trim().toUpperCase();
  if (Object.hasOwn(CODE_GROUPS, category) || SERVICE_CATEGORIES.has(category)) return category;
  if (['23', '44', '45', '811', '5617', '54141', '54192'].some(p => code.startsWith(p))) return 'LOCAL_SERVICE';
  return null;
}

export function publicEvidenceURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password &&
      (!u.port || u.port === '443') &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(u.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|example|invalid|test)$/i.test(u.hostname);
  } catch { return false; }
}

// Adapter uses the verified deployed backend's actual business/contact fields.
// Registration date is retained for provenance, never used as an age cutoff.
export function adaptExistingLead(record) {
  return {
    lead_id: String(record.lead_id ?? ''),
    business_name: String(record.business_name ?? '').trim(),
    public_email: email(record.public_email),
    city: String(record.city ?? '').trim(),
    state: String(record.state ?? '').trim().toUpperCase(),
    country: String(record.country ?? '').trim().toUpperCase(),
    niche: String(record.niche ?? ''),
    naics_code: record.naics_code,
    category: record.category,
    registration_date: record.registration_date ?? null,
    source_dataset: record.source_dataset ?? null,
    source_url: record.source_url ?? null,
  };
}

export function evidenceSubject(record) {
  const r = adaptExistingLead(record);
  return {
    lead_id: r.lead_id, business_name: key(r.business_name),
    email: r.public_email, city: key(r.city), state: r.state,
    country: r.country, industry: industry(r),
  };
}

function subjectMatches(a, b) {
  return a && Object.keys(b).every(k => a[k] === b[k]);
}

/** Structured observations are NOT web-search results or proof of delivery.
 * Each observation needs a stable ID, source, true observed_at and bound subject.
 * A discovery module must obtain these facts, not invent them to pass checks.
 */
export function qualifyLead(record, {
  observations = [], now = new Date().toISOString(),
  contact = { suppressed: false, held: false }, priorAttempt = false, duplicate = false,
  freeProviderOnly = true,
} = {}) {
  const clock = Date.parse(now);
  if (!Number.isFinite(clock)) throw new TypeError('Valid evaluation timestamp required');
  const r = adaptExistingLead(record);
  const subject = evidenceSubject(r);
  const group = industry(r);
  const result = (decision, reasons, evidence = [], service = null) => ({
    policy: QUALIFICATION_POLICY, mode: 'shadow_only', evaluated_at: new Date(clock).toISOString(),
    lead_id: r.lead_id, decision, reasons, industry: group, service,
    registration_age_used: false, evidence_ids: evidence.map(e => e.id).sort(),
    sources: [...new Set(evidence.map(e => e.url))].sort(),
    qualified_for: decision === 'QUALIFIED' ? 'DRAFT_REVIEW_ONLY' : null,
    sending_authorized: false, deliverability: 'UNVERIFIED',
    production_review: null,
  });
  // These gates cannot be overridden by a model score or otherwise-good evidence.
  if (contact.suppressed) return result('EXCLUDED', ['SUPPRESSED_CONTACT']);
  if (priorAttempt) return result('EXCLUDED', ['PRIOR_CONTACT_ATTEMPT']);
  if (contact.held) return result('NEEDS_RESEARCH', ['CONTACT_OR_DELIVERY_HOLD']);
  if (duplicate) return result('NEEDS_RESEARCH', ['DUPLICATE_IDENTITY_REVIEW']);
  if (!r.lead_id || !r.business_name || r.business_name.length > 180 ||
      /[\x00-\x1f\x7f\ufffd]/.test(r.business_name)) {
    return result('NEEDS_RESEARCH', ['INVALID_LEAD_IDENTITY']);
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(r.public_email)) return result('EXCLUDED', ['INVALID_EMAIL']);
  if (freeProviderOnly && !FREE_PROVIDERS.has(r.public_email.split('@')[1])) {
    // Owner's targeting preference, not evidence of an existing working website.
    return result('EXCLUDED', ['CUSTOM_DOMAIN_CONTACT_PREFERENCE']);
  }
  if (r.country && r.country !== 'US') return result('EXCLUDED', ['NON_US_BUSINESS']);
  if (!group) return result('NEEDS_RESEARCH', ['INDUSTRY_FIT_UNCONFIRMED']);
  if (!Array.isArray(observations) || observations.length > 40) {
    return result('NEEDS_RESEARCH', ['INVALID_EVIDENCE_SET']);
  }
  const ids = observations.map(e => e?.id);
  if (ids.some(id => typeof id !== 'string' || !/^[\w:.-]{1,160}$/.test(id)) || new Set(ids).size !== ids.length) {
    return result('NEEDS_RESEARCH', ['DUPLICATE_OR_INVALID_EVIDENCE_ID']);
  }
  const invalid = observations.some(e => !subjectMatches(e.subject, subject) ||
    !publicEvidenceURL(e.url) || typeof e.observation !== 'string' ||
    e.observation.trim().length < 20 || e.observation.length > 4000 ||
    !Number.isFinite(Date.parse(e.observed_at)) || Date.parse(e.observed_at) > clock ||
    clock - Date.parse(e.observed_at) > 7 * DAY);
  if (invalid) return result('NEEDS_RESEARCH', ['STALE_CHANGED_OR_INVALID_EVIDENCE']);
  if (observations.some(e => e.kind === 'CONTRADICTION')) {
    return result('NEEDS_RESEARCH', ['CONFLICTING_EVIDENCE']);
  }
  const find = (kind, check) => observations.find(e => e.kind === kind && check(e));
  const identity = find('IDENTITY', e => e.basis === 'BUSINESS_OWNED_PAGE' && e.business_name_match === true);
  const location = find('LOCATION', e => e.country === 'US' && US_STATES.has(e.state) &&
    e.operating_location === true && e.state === r.state && key(e.city) === key(r.city) && key(r.city).length > 0);
  const activity = find('ACTIVITY', e => e.active === true &&
    ['CURRENT_BUSINESS_OFFER', 'RECENT_BUSINESS_UPDATE'].includes(e.basis));
  const contactEvidence = find('CONTACT', e => email(e.email) === r.public_email &&
    e.basis === 'BUSINESS_PUBLISHED_CONTACT' && e.business_name_match === true);
  const missing = [];
  if (!identity) missing.push('BUSINESS_IDENTITY_REQUIRED');
  if (!location) missing.push('US_OPERATING_LOCATION_REQUIRED');
  if (!activity) missing.push('ACTIVE_BUSINESS_REQUIRED');
  if (!contactEvidence) missing.push('BUSINESS_CONTACT_ASSOCIATION_REQUIRED');
  const gap = find('WEBSITE_GAP', e => GAP_TYPES.has(e.gap) &&
    (['OWNER_REQUESTED_WEBSITE', 'OWNER_CONFIRMED_NO_WEBSITE',
      'OWNER_CONFIRMED_NO_ONLINE_BOOKING', 'OWNER_CONFIRMED_NO_ONLINE_ORDERING', 'PUBLISHED_PHONE_BOOKING', 'PUBLISHED_PHONE_ORDERING'].includes(e.gap)
      ? e.basis === 'EXPLICIT_BUSINESS_STATEMENT' && e.statement_current === true
      : publicEvidenceURL(e.site_url) && e.site_linked_from_business_page === true &&
        e.basis === OBSERVED_GAPS[e.gap]));
  if (!gap) missing.push('OPPORTUNITY_EVIDENCE_REQUIRED');
  if (missing.length) return result('NEEDS_RESEARCH', missing);
  if (gap.gap === 'BROKEN_SITE') {
    const failures = observations.filter(e => e.kind === 'WEBSITE_GAP' &&
      e.gap === 'BROKEN_SITE' && e.site_url === gap.site_url &&
      e.site_linked_from_business_page === true && e.basis === 'OBSERVED_SITE_FAILURE');
    if (failures.length < 2 || Math.max(...failures.map(e => Date.parse(e.observed_at))) -
        Math.min(...failures.map(e => Date.parse(e.observed_at))) < DAY) {
      return result('NEEDS_RESEARCH', ['REPEATED_SITE_FAILURE_REQUIRED']);
    }
  }
  let service = 'WEBSITE';
  if (['OWNER_CONFIRMED_NO_ONLINE_BOOKING','PUBLISHED_PHONE_BOOKING'].includes(gap.gap)) {
    if (!['DENTAL', 'CLINIC', 'AESTHETICS', 'OTHER_BOOKING'].includes(group)) {
      return result('NEEDS_RESEARCH', ['BOOKING_SERVICE_FIT_REQUIRED']);
    }
    service = 'BOOKING';
  }
  if (['OWNER_CONFIRMED_NO_ONLINE_ORDERING','PUBLISHED_PHONE_ORDERING'].includes(gap.gap)) {
    if (!['RESTAURANT', 'CAFE'].includes(group)) return result('NEEDS_RESEARCH', ['ORDERING_SERVICE_FIT_REQUIRED']);
    service = 'ORDERING';
  }
  const used = [identity, location, activity, contactEvidence, gap];
  if (gap.gap === 'BROKEN_SITE') used.push(...observations.filter(e =>
    e.kind === 'WEBSITE_GAP' && e.gap === 'BROKEN_SITE' && e.site_url === gap.site_url &&
    e.site_linked_from_business_page === true && e.basis === 'OBSERVED_SITE_FAILURE'));
  return result('QUALIFIED', ['EVIDENCE_READY_FOR_DRAFT_REVIEW'], [...new Map(used.map(e => [e.id, e])).values()], service);
}
