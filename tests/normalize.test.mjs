import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItems } from '../lib/plugins/research/normalize.js';

test('finds the row array anywhere in a provider body and maps reddit fields', () => {
  const body = { output: { posts: [{ id: 'abc', title: 'Watering?', selftext: 'pots stay wet', subreddit: 'houseplants', score: 64, num_comments: 29, created_utc: 1790000000, permalink: '/r/houseplants/comments/abc/x/' }] } };
  const [r] = normalizeItems('reddit', body);
  assert.equal(r.title, 'Watering?');
  assert.equal(r.text, 'pots stay wet');
  assert.equal(r.where, 'r/houseplants');
  assert.equal(r.url, 'https://www.reddit.com/r/houseplants/comments/abc/x/');
  assert.equal(r.score, 64);
  assert.equal(r.comments, 29);
  assert.equal(r.created, new Date(1790000000 * 1000).toISOString());
});

test('maps X rows with nested user and legacy text', () => {
  const body = { data: { tweets: [{ id_str: '9', full_text: 'my shelf is full of gadgets', user: { screen_name: 'plant_shelf' }, favorite_count: 110, reply_count: 18, created_at: 'Mon Nov 16 10:00:00 +0000 2026' }] } };
  const [r] = normalizeItems('x', body);
  assert.equal(r.where, '@plant_shelf');
  assert.equal(r.url, 'https://x.com/plant_shelf/status/9');
  assert.equal(r.score, 110);
  assert.match(r.text, /gadgets/);
});

test('maps Instagram posts with caption objects and shortcodes', () => {
  const body = { items: [{ code: 'C1x', caption: { text: 'Sunday plant reset #plantcare' }, user: { username: 'greenflat' }, like_count: 900, comment_count: 12, taken_at: 1790000000 }] };
  const [r] = normalizeItems('instagram', body);
  assert.equal(r.url, 'https://www.instagram.com/p/C1x/');
  assert.equal(r.where, '@greenflat');
  assert.match(r.text, /Sunday plant reset/);
});

test('maps Meta Ad Library ads_archive rows', () => {
  const body = { data: [{ id: '77', page_name: 'Moss House', ad_creative_bodies: ['Your living room looks finished.'], ad_creative_link_titles: ['Shelf kit'], ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=77', ad_delivery_start_time: '2026-10-01', publisher_platforms: ['facebook', 'instagram'] }] };
  const [r] = normalizeItems('meta_ads', body);
  assert.equal(r.author, 'Moss House');
  assert.equal(r.title, 'Shelf kit');
  assert.equal(r.text, 'Your living room looks finished.');
  assert.deepEqual(r.platforms, ['facebook', 'instagram']);
  assert.equal(r.started, '2026-10-01');
});

test('drops empty rows, dedupes by url and caps the count', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ title: 't' + (i % 30), url: 'https://e.com/' + (i % 30) })).concat([{}, { foo: 1 }]);
  const out = normalizeItems('web', { results: rows }, { max: 20 });
  assert.equal(out.length, 20);
  assert.equal(new Set(out.map(r => r.url)).size, 20);
});

test('returns [] for bodies with no rows', () => {
  assert.deepEqual(normalizeItems('x', { ok: true }), []);
  assert.deepEqual(normalizeItems('x', null), []);
});

test('web-search rows recover the community or handle from the URL', () => {
  const [r] = normalizeItems('reddit', { data: { web: [{ url: 'https://www.reddit.com/r/houseplants/comments/1rmc3w6/how_do/', title: 'How do you track watering?', description: 'my collection grew' }] } });
  assert.equal(r.where, 'r/houseplants');
  const [x] = normalizeItems('x', { data: { web: [{ url: 'https://x.com/plant_shelf/status/123', title: 'routine > gadgets', description: '' }] } });
  assert.equal(x.where, '@plant_shelf');
  assert.equal(x.author, 'plant_shelf');
});
