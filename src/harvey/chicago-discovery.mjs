// Eclipso source adapter sharing the Harvey port's research contract.
// City data is not Harvey code and has separate source terms.
export const CHICAGO_ENDPOINT = 'https://data.cityofchicago.org/resource/uupf-x98q.json';
export const CHICAGO_SOURCE = 'https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses-Current-Active/uupf-x98q';
const NAME = 'upper(doing_business_as_name)';
const GROUPS = {
  RESTAURANT: "business_activity like '%Dining%'",
  CAFE: `${NAME} like '%COFFEE%' OR ${NAME} like '%CAFE%' OR ${NAME} like '%CAFÉ%'`,
  DENTAL: `${NAME} like '%DENTAL%' OR ${NAME} like '%DENTIST%'`,
  CLINIC: `${NAME} like '%CLINIC%' OR ${NAME} like '%MEDICAL%'`,
  AESTHETICS: `${NAME} like '%SALON%' OR ${NAME} like '%AESTHETIC%' OR ${NAME} like '%MED SPA%'`,
};
export function candidateSuitability(record) {
  const name = record.business_name ?? '';
  if (/\b(?:UNIVERSITY|HOSPITAL|MEDICAL CENTER)\b/i.test(name)) return 'ENTERPRISE_NOT_PILOT_FIT';
  if (record.category === 'DENTAL' && /\bLAB(?:ORATORY|ORTORY|ORATORIES|S)?\b/i.test(name)) return 'DENTAL_LAB_NOT_PATIENT_PRACTICE';
  if (record.category === 'AESTHETICS' && (!/\b(?:SALON|SPA|AESTHETICS?|BEAUTY)\b/i.test(name) || /RESTAURANT|RAMEN|CAFE|PORCELLINO/i.test(name))) return 'NAME_MATCH_WRONG_INDUSTRY';
  return null;
}
export function chicagoQueries(asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new TypeError('Actual UTC date required');
  return Object.entries(GROUPS).map(([category, clause]) => {
    const url = new URL(CHICAGO_ENDPOINT);
    url.searchParams.set('$select', 'id,license_id,account_number,site_number,doing_business_as_name,address,city,state,zip_code,license_description,business_activity,date_issued,expiration_date,license_status');
    url.searchParams.set('$where', `license_status='AAI' AND city='CHICAGO' AND state='IL' AND expiration_date>'${asOf}T00:00:00' AND (${clause})`);
    // Do not restrict the batch to recently registered or recently issued names.
    // A license's issue date is not the founding age of the business.
    url.searchParams.set('$order', 'account_number ASC,site_number ASC,license_id DESC');
    url.searchParams.set('$limit', '8');
    return { category, url: url.href };
  });
}
export function normalizeChicago(rows, { category, observedAt, queryUrl } = {}) {
  if (!Object.hasOwn(GROUPS, category) || !Array.isArray(rows) || rows.length > 8 || !Number.isFinite(Date.parse(observedAt)) || !queryUrl?.startsWith(CHICAGO_ENDPOINT)) throw new TypeError('Bounded source response required');
  const seen = new Set();
  return rows.flatMap(r => {
    if (!/^\d+$/.test(r.account_number ?? '') || !/^\d+$/.test(r.site_number ?? '') || !/^\d+$/.test(r.license_id ?? '') || !r.doing_business_as_name || r.license_status !== 'AAI' || r.city !== 'CHICAGO' || r.state !== 'IL') return [];
    const id = `chicago:${r.account_number}:${r.site_number}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const source = new URL(CHICAGO_ENDPOINT);
    source.searchParams.set('license_id', r.license_id);
    return [{ lead_id: id, business_name: r.doing_business_as_name, category,
      category_basis: category === 'RESTAURANT' ? 'LICENSE_ACTIVITY_DINING' : 'NAME_MATCH_REQUIRES_CATEGORY_VERIFICATION',
      public_email: '', published_emails: [], city: r.city, state: r.state, country: 'US',
      address: [r.address, r.zip_code].filter(Boolean).join(' '), website_url: null,
      website_status: 'UNKNOWN_SOURCE_HAS_NO_WEBSITE_FIELD', source_url: source.href,
      source_dataset: 'City of Chicago — Business Licenses Current Active',
      source_observed_at: observedAt, source_query_url: queryUrl,
      source_license: { license_id: r.license_id, status: r.license_status, description: r.license_description,
        activity: r.business_activity, issued: r.date_issued, expires: r.expiration_date },
      contact_status: 'CONTACT_RESEARCH_REQUIRED', operating_location_verified: false,
      active_business_verified: false, website_need_verified: false, sending_authorized: false }];
  });
}
