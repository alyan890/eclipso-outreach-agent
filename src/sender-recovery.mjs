// Only explicit API rejections are safe to classify as not accepted.
// A timeout, malformed success, or 5xx can have an ambiguous delivery outcome.
export const SENDER_RECOVERY_VERSION = 'GMAIL_RECOVERY_V3';
const RETRY_WINDOW_MS = 90 * 60 * 1000;
export function gmailFailurePolicy(status, payload, responseHeaders = {}, now = Date.now()) {
  const error = payload?.error;
  const message = typeof error?.message === 'string' ? error.message : '';
  const reasons = Array.isArray(error?.errors) ? error.errors.map(e => e?.reason ?? '').join(' ') : '';
  const text = message + ' ' + reasons;
  const explicitRejection = Number.isInteger(status) && status >= 400 && status < 500;
  const temporary = explicitRejection && (status === 429 || status === 403 && /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|mail sending|sending limit|sending quota/i.test(text));
  if (!temporary) return {state: explicitRejection ? 'FAILED' : 'UNKNOWN', kind: status === 401 ? 'GMAIL_AUTHORIZATION_REQUIRED' : explicitRejection ? 'GMAIL_REQUEST_REJECTED' : 'SEND_OUTCOME_UNKNOWN', temporary: false, retry_after: null};
  const kind = /mail sending|sending limit|sending quota/i.test(text) ? 'GMAIL_SENDING_LIMIT' : 'GMAIL_RATE_LIMIT';
  const raw = typeof responseHeaders?.get === 'function' ? responseHeaders.get('retry-after') : responseHeaders['retry-after'];
  let providerAt = 0;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) providerAt = now + Number(raw) * 1000;
  else if (raw) providerAt = Date.parse(raw) || 0;
  // Gmail can include a specific retry timestamp in the error message.
  for (const value of message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g) ?? []) providerAt = Math.max(providerAt, Date.parse(value) || 0);
  return {state: 'FAILED', kind, temporary: true, retry_after: new Date(Math.max(now + RETRY_WINDOW_MS, providerAt)).toISOString()};
}

export function senderWaitState(cfg, now = Date.now()) {
  if (!cfg.sending_enabled || !cfg.activation_approved) return {status: 'SENDING_DISABLED', sent: 0};
  if (!cfg.migration_verified || cfg.halt_reason) return {status: 'MANUAL_REVIEW_REQUIRED', sent: 0};
  if (cfg.sender_retry_after != null) {
    const until = Date.parse(cfg.sender_retry_after);
    if (!Number.isFinite(until)) return {status: 'RECOVERY_STATE_INVALID', sent: 0};
    if (until > now) return {status: 'WAITING_FOR_GMAIL_RETRY', retry_after: new Date(until).toISOString(), reason: cfg.sender_retry_reason, sent: 0};
  }
  return null;
}
