import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal } from '../lib/vault.js';

const K = 'a'.repeat(48);

test('sealed payload round-trips and hides the plaintext', () => {
  const s = seal({ token: 'EAAB-secret' }, K);
  assert.ok(!s.includes('EAAB'));
  assert.deepEqual(unseal(s, K), { token: 'EAAB-secret' });
});

test('tampered or foreign-key payloads unseal to null', () => {
  const s = seal({ a: 1 }, K);
  const flipped = s.slice(0, -3) + (s.at(-3) === 'A' ? 'B' : 'A') + s.slice(-2);
  assert.equal(unseal(flipped, K), null);
  assert.equal(unseal(s, 'b'.repeat(48)), null);
  assert.equal(unseal('garbage', K), null);
});

test('expired payloads unseal to null', () => {
  const s = seal({ a: 1 }, K, { ttl: -1 });
  assert.equal(unseal(s, K), null);
});
