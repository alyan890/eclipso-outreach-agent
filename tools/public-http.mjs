// Node validation-run adapter, porting Harvey harvey/public_http.py's DNS pinning
// boundary. Copyright (c) 2026 Ethan Rogers, MIT. Not a cloud executor.
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import { safeWebsite } from '../src/harvey/discovery.mjs';

export function publicIPv4(address) {
  const p = String(address).split('.').map(Number);
  if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}
export async function resolvePublicIPv4(host, resolver = resolve4) {
  // This adapter is IPv4-only. No hostname is re-resolved at connection time.
  const addresses = [...new Set(await resolver(host))];
  if (!addresses.length || addresses.some(a => !publicIPv4(a))) throw new Error('unsafe_or_unavailable_dns');
  return addresses[0];
}
async function once(url, { method = 'GET', body = '', maxBytes = 350000, timeoutMs = 15000, accept = 'text/html,text/plain;q=0.9' } = {}) {
  const approved = safeWebsite(url);
  if (!approved || new URL(approved).protocol !== 'https:') throw new Error('unsafe_or_insecure_url');
  const u = new URL(approved);
  let timer;
  const address = await Promise.race([
    resolvePublicIPv4(u.hostname),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dns_timeout')), Math.min(timeoutMs, 8000)); }),
  ]).finally(() => clearTimeout(timer));
  return new Promise((resolve, reject) => {
    const request = https.request(u, {
      method, agent: false, family: 4, servername: u.hostname,
      lookup: (_host, options, callback) => options?.all
        ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
      headers: {
        'User-Agent': 'EclipsoResearch/0.1 (+https://eclipso-digital.vercel.app/; research-only)',
        Accept: accept, 'Accept-Encoding': 'identity',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(new Error('response_too_large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'), url: u.href }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request_timeout')));
    const deadline = setTimeout(() => request.destroy(new Error('request_timeout')), timeoutMs);
    request.on('error', reject);
    request.on('close', () => clearTimeout(deadline));
    request.end(body || undefined);
  });
}
async function followPublicRedirects(url, options, request) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (options.beforeRequest) await options.beforeRequest(current);
    const result = await request(current, options);
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    if (options.followRedirects === false) return result;
    if (!result.headers.location || redirects === 3 || options.method === 'POST') throw new Error('redirect_requires_review');
    current = new URL(result.headers.location, current).href;
  }
  throw new Error('redirect_requires_review');
}

export function publicRequest(url, options = {}) {
  return followPublicRedirects(url, options, once);
}

export function nativeWebsiteRequest(bridge) {
  return (url, options = {}) => followPublicRedirects(url, options, async (destination, config) => {
    const approved = safeWebsite(destination);
    if (!approved || new URL(approved).protocol !== 'https:' || (config.method ?? 'GET') !== 'GET') {
      throw new Error('unsafe_or_insecure_url');
    }
    const result = await bridge.request({
      op: 'public_page', url: approved, max_bytes: config.maxBytes,
      timeout_ms: config.timeoutMs, accept: config.accept,
    });
    if (result.error) throw new Error(result.error);
    return result;
  });
}

export function robotsAllows(text, pathname = '/') {
  const groups = [];
  let group = { agents: [], rules: [] }, hasRules = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase(), value = match[2].trim();
    if (field === 'user-agent') {
      if (hasRules) { groups.push(group); group = { agents: [], rules: [] }; hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(field)) {
      hasRules = true;
      if (value) group.rules.push({ value, allow: field === 'allow' });
    }
  }
  groups.push(group);
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && 'eclipsoresearch'.includes(a)));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const rules = applicable.flatMap(g => g.rules).flatMap(rule => {
    const anchored = rule.value.endsWith('$');
    const value = anchored ? rule.value.slice(0, -1) : rule.value;
    const pattern = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pattern + (anchored ? '$' : '')).test(pathname)
      ? [{ length: value.replace(/\*/g, '').length, allow: rule.allow }] : [];
  });
  rules.sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow));
  return !rules.length || rules[0].allow;
}
