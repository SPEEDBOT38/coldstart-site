// Maps provider HTTP outcomes to publish-outbox semantics. Only a timeout/network error/5xx is "ambiguous" (the provider may have acted).
// A 4xx means the provider refused, so it is safe to say nothing was posted.
export function classify(e) {
  const h = e && e.http, msg = String((e && e.message) || '');
  if (h === 401 || /expired|invalid.*token|OAuthException.*190|code":?\s*190/i.test(msg + JSON.stringify((e && e.detail) || '').slice(0, 400))) return { kind: 'auth', ambiguous: false, retryable: false, message: 'Credentials expired or revoked. Reconnect the account.' };
  if (h === 429) return { kind: 'rate_limit', ambiguous: false, retryable: true, message: 'Rate limit reached. Try again later.' };
  if (h === 402 || /spend|usage cap|credit|monthly (post|usage)/i.test(msg)) return { kind: 'quota', ambiguous: false, retryable: false, message: 'The provider usage/spending cap is reached. Nothing was posted.' };
  if (h === 403 && /duplicate/i.test(msg)) return { kind: 'duplicate', ambiguous: false, retryable: false, message: 'The platform rejected this as duplicate content. It may already be posted; check the account.' };
  if (h === 403) return { kind: 'permission', ambiguous: false, retryable: false, message: 'The connected account lacks permission for this action (scopes or app approval).' };
  if (h && h >= 400 && h < 500) return { kind: 'client', ambiguous: false, retryable: false, message: msg.slice(0, 200) };
  return { kind: 'error', ambiguous: true, retryable: false, message: msg.slice(0, 200) || 'No response from the provider.' };   // timeout / network / 5xx
}
