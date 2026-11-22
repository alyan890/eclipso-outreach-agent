// Adapted from Harvey 0.3.0 OpenStreetMap._tags/fetch and normalize_domain:
// harvey/collectors/discover.py, commit f851026f876dad9ea665f2164b5ef73d01432349.
// Copyright (c) 2026 Ethan Rogers. MIT; see THIRD_PARTY_NOTICES.md.
// Changes: bounded single-endpoint queries, new industries, unknown != no site,
// published contact provenance, no paid fallback or mirror rotation on limits.
export const HARVEY_REVISION = 'f851026f876dad9ea665f2164b5ef73d01432349';
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const CATEGORY_TAGS = {
  RESTAURANT: [['amenity', 'restaurant']], CAFE: [['amenity', 'cafe']],
  DENTAL: [['amenity', 'dentist'], ['healthcare', 'dentist']],
  CLINIC: [['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'clinic']],
  AESTHETICS: [['shop', 'beauty'], ['shop', 'hairdresser']],
  ROOFING: [['craft', 'roofer'], ['shop', 'roofing']],
  PLUMBING: [['craft', 'plumber']], HVAC: [['craft', 'hvac']],
  CONSTRUCTION: [['craft', 'builder'], ['office', 'construction_company']],
  LANDSCAPING: [['craft', 'gardener']], CLEANING: [['craft', 'cleaning']],
};

export function normalizeDomain(value) {
  if (!value) return '';
  try {
    const u = new URL(String(value).includes('://') ? value : `https://${value}`);
    return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch { return ''; }
}
export function safeWebsite(value) {
  try {
    const u = new URL(String(value).includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) ||
        /^\d+(?:\.\d+){3}$/.test(u.hostname) ||
        /(?:^|\.)(localhost|local|internal|invalid|test|example)$/i.test(u.hostname) ||
        (u.port && !['80', '443'].includes(u.port))) return null;
    return u.href;
  } catch { return null; }
}
export function buildOverpassQuery({ lat, lon, radiusM = 2500, limit = 30, categories = Object.keys(CATEGORY_TAGS) }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
      !Number.isInteger(radiusM) || radiusM < 100 || radiusM > 5000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 60 ||
      !Array.isArray(categories) || !categories.length || categories.length > 12 ||
      categories.some(c => !Object.hasOwn(CATEGORY_TAGS, c))) throw new TypeError('Invalid bounded discovery query');
  const tags = [...new Map(categories.flatMap(c => CATEGORY_TAGS[c]).map(t => [t.join('='), t])).values()];
  const clauses = tags.flatMap(([k, v]) => ['node', 'way', 'relation'].map(type =>
    `${type}["${k}"="${v}"]["name"](around:${radiusM},${lat},${lon});`)).join('');
  return `[out:json][timeout:25];(${clauses});out center ${limit};`;
}
function categoryOf(tags) {
  return Object.entries(CATEGORY_TAGS).find(([, pairs]) => pairs.some(([k, v]) => tags[k] === v))?.[0] ?? null;
}
export function normalizeOSM(payload, { observedAt, searchArea } = {}) {
  if (!Number.isFinite(Date.parse(observedAt)) || !searchArea || !Array.isArray(payload?.elements) || payload.elements.length > 1000) {
    throw new TypeError('Source response and actual observation timestamp required');
  }
  const seen = new Set();
  return payload.elements.flatMap(el => {
    const t = el.tags ?? {}, category = categoryOf(t);
    const name = String(t.name ?? '').trim();
    if (!['node', 'way', 'relation'].includes(el.type) || !Number.isSafeInteger(el.id) || el.id <= 0 ||
        !name || name.length > 180 || /[\x00-\x1f\x7f]/.test(name) || !category) return [];
    const id = `osm:${el.type}/${el.id}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const website = safeWebsite(t.website || t['contact:website'] || '');
    const candidates = String(t.email || t['contact:email'] || '').split(/[;,]/).map(x => x.trim().toLowerCase());
    const publishedEmails = [...new Set(candidates.filter(x => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x)))].slice(0, 3);
    return [{
      lead_id: id, business_name: name, category,
      public_email: publishedEmails.length === 1 ? publishedEmails[0] : '',
      published_emails: publishedEmails, phone: String(t.phone || t['contact:phone'] || ''),
      city: String(t['addr:city'] || ''), state: String(t['addr:state'] || ''),
      country: String(t['addr:country'] || '').toUpperCase(),
      address: [t['addr:housenumber'], t['addr:street'], t['addr:postcode']].filter(Boolean).join(' '),
      coordinates: { lat: el.lat ?? el.center?.lat ?? null, lon: el.lon ?? el.center?.lon ?? null },
      website_url: website, website_status: website ? 'LISTED_WEBSITE_UNVERIFIED' : 'UNKNOWN_NOT_LISTED',
      source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      source_dataset: 'OpenStreetMap contributors', source_observed_at: observedAt,
      search_area: searchArea, contact_status: publishedEmails.length ? 'LISTING_PUBLISHED_UNVERIFIED' : 'CONTACT_RESEARCH_REQUIRED',
      operating_location_verified: false, active_business_verified: false,
      website_need_verified: false, sending_authorized: false,
      harvey_adapter_revision: HARVEY_REVISION,
    }];
  });
}
// A missing source tag is deliberately NOT translated to NO_WEBSITE as upstream did.
export function selectBalanced(records, limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new TypeError('Invalid bounded batch size');
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category).push(r);
  }
  const out = [];
  while (out.length < limit) {
    let added = false;
    for (const rows of groups.values()) if (rows.length && out.length < limit) { out.push(rows.shift()); added = true; }
    if (!added) break;
  }
  return out;
}
