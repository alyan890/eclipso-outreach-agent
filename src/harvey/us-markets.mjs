// A small starting set for a nationwide service. This is not a list of allowed
// target cities: callers can supply any explicit US market with coordinates.
export const STARTING_MARKETS = {
  chicago: { name: 'Chicago', state: 'IL', country: 'US', lat: 41.8781, lon: -87.6298 },
  hartford: { name: 'Hartford', state: 'CT', country: 'US', lat: 41.7658, lon: -72.6734 },
  atlanta: { name: 'Atlanta', state: 'GA', country: 'US', lat: 33.7490, lon: -84.3880 },
  dallas: { name: 'Dallas', state: 'TX', country: 'US', lat: 32.7767, lon: -96.7970 },
  phoenix: { name: 'Phoenix', state: 'AZ', country: 'US', lat: 33.4484, lon: -112.0740 },
};
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
export function validateUSMarket(market) {
  if (!market || market.country !== 'US' || !STATES.has(market.state) ||
      typeof market.name !== 'string' || !market.name.trim() || market.name.length > 100 ||
      !Number.isFinite(market.lat) || Math.abs(market.lat) > 90 ||
      !Number.isFinite(market.lon) || Math.abs(market.lon) > 180) throw new TypeError('Explicit US search market required');
  // Search scope is operator-supplied, not evidence of a business's US location.
  return { name: market.name.trim(), state: market.state, country: 'US', lat: market.lat, lon: market.lon };
}
