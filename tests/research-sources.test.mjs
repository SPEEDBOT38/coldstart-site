import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRows, overlap, postShape, queryTerms, verifyRows } from '../lib/plugins/research/verify.js';
import { normalizeItems } from '../lib/plugins/research/normalize.js';
import { fetchSource } from '../lib/plugins/research/sources.js';

test('off-topic rows do not fill the search quota or crowd relevant fallback posts out', async t => {
  for (const key of ['TREG_TOKEN', 'FIRECRAWL_API_KEY']) {
    const old = process.env[key]; process.env[key] = 'test';
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const fetch = url => json(String(url).includes('treg.to')
    ? { posts: [{ url: 'https://x.com/shop/status/100000', text: 'Movie night' }] }
    : { data: { web: [{ url: 'https://x.com/shop/status/100001', title: 'Plant care kit' }] } });
  const result = await fetchSource(fetch, 'x', 'plant care', { max: 1, enough: 1 });
  assert.deepEqual(result.items.map(i => i.postId), ['100001']);
  assert.equal(result.tried.length, 2);
});

const json = value => Response.json(value);
const stale = { postId: 'abc123', title: 'plant care', text: 'plant care' };

test('archive text replaces stale search text even for link-only posts', async () => {
  const data = [{ id: 'abc123', title: 'Movie night', selftext: '', subreddit: 'movies' }];
  const { items: [it] } = await verifyRows(() => json({ data }), 'reddit', [stale]);
  assert.equal(it.verified, true);
  assert.equal(it.where, 'r/movies');
  assert.equal(overlap(it, queryTerms('plant care')), 0);
});

test('short X embed never inherits stale text or author attribution as post copy', async () => {
  const html = '<blockquote class="twitter-tweet"><p>Movie night</p>— Plant Care (@plants)</blockquote>';
  const { items: [it] } = await verifyRows(() => json({ html }), 'x', [stale]);
  assert.equal(it.verified, true);
  assert.equal(it.title, 'Movie night');
  assert.equal(overlap(it, queryTerms('plant care')), 0);
});

test('X checker distinguishes unavailable from deleted', async () => {
  for (const status of [200, 404, 429]) {
    const r = await verifyRows(() => new Response('{}', { status }), 'x', [stale]);
    assert.equal(r.deleted, Number(status === 404));
    assert.equal(r.unverified, Number(status !== 404));
    if (r.items.length) assert.equal(r.items[0].verified, false);
  }
});

test('requires single-post HTTP(S) paths; media links dedupe by platform ID', () => {
  for (const [source, url] of [['reddit', 'https://reddit.com/r/test/comments/abc123/slug/def456'], ['instagram', 'https://instagram.com/explore/p/AB12345/'], ['x', 'ftp://x.com/test/status/123456'], ['x', 'https://x.com/test/status/123456/analytics']]) assert.equal(postShape(source, url).ok, false, url);
  const r = cleanRows('x', ['https://twitter.com/test/status/123456/photo/1', 'https://x.com/test/status/123456?s=20'].map(url => ({ url })));
  assert.deepEqual(r.items.map(i => i.url), ['https://x.com/test/status/123456']);
  assert.equal(r.dropped.duplicate, 1);
});

test('normalization uses Reddit post permalink instead of outbound article and tolerates junk URLs', () => {
  const rows = normalizeItems('reddit', [{ title: 'junk', url: {} }, { title: 'article', url: 'https://news.test/story', permalink: '/r/test/comments/abc123/story/' }]);
  const clean = cleanRows('reddit', rows);
  assert.deepEqual(clean.items.map(i => i.postId), ['abc123']);
});

test('relevance matches short topic words and Unicode, not question filler', () => {
  const terms = queryTerms('Which AI tools should I try for café menus?');
  for (const [title, expected] of [['AI', 1], ['Café', 1], ['Which should I try?', 0], ['chair', 0]]) assert.equal(overlap({ title }, terms), expected);
});
