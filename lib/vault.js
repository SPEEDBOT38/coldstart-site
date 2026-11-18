// Sealed, tamper-evident blobs (AES-256-GCM) for tokens kept in httpOnly cookies and the store.
// Key = SHA-256(SESSION_SECRET). Without a secret in dev, a per-process key is used (sessions reset on restart).
import crypto from 'node:crypto';

let devKey;
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.VERCEL) throw new Error('SESSION_SECRET (≥32 chars) must be set in production.');
  return devKey ||= crypto.randomBytes(32).toString('hex');
}
const keyOf = s => crypto.createHash('sha256').update('coldstart-vault:' + s).digest();

export function seal(data, s = secret(), { ttl = 60 * 86400 } = {}) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(s), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ d: data, x: Date.now() + ttl * 1000 }), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal(blob, s = secret()) {
  try {
    const buf = Buffer.from(String(blob), 'base64url');
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(s), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const { d: data, x } = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    return x > Date.now() ? data : null;
  } catch { return null; }
}

export const randomId = (n = 18) => crypto.randomBytes(n).toString('base64url');
