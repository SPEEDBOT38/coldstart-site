import test from 'node:test';
import assert from 'node:assert/strict';
import { competitors } from '../lib/plugins/research/index.js';
import { createStore } from '../lib/store.js';

const row = (id, page, domain) => ({ ad_archive_id: id, page_id: page, page_name: 'Example', snapshot: { body: { text: 'Hello' }, images: [{ original_image_url: 'https://cdn.example/img' }], link_url: 'https://' + domain } });
test('unknown jobs, invalid countries and missing setup never start an actor', async t => {
  const token = process.env.APIFY_TOKEN; delete process.env.APIFY_TOKEN;
  t.after(() => { if (token !== undefined) process.env.APIFY_TOKEN = token; });
  const ctx = {store:createStore({STORE:'memory'}),fetch:()=>assert.fail('unexpected network request')};
  await assert.rejects(competitors(ctx,{job:'00000000-0000-0000-0000-000000000000'}), /Unknown or expired/);
  await assert.rejects(competitors(ctx,{query:'category',rival:'Example',country:'USA'}), /country code/);
  assert.equal((await competitors(ctx,{query:'category',rival:'Example'})).status,'needs_setup');
});

test('named run is bounded, polls without another start, and resolves only the evidenced page', async t => {
  const env = {...process.env}; t.after(() => { for (const k of ['APIFY_TOKEN','GEMINI_API_KEY','OPENROUTER_API_KEY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
  process.env.APIFY_TOKEN = 'test'; delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY;
  const replies = [{ data: { id: 'run1' } }, { data: { status: 'RUNNING' } }, { data: { status: 'SUCCEEDED', defaultDatasetId: 'set1', usageTotalUsd: 0.02 } }, [row('100','1','reseller.org/example.com'), row('101','2','shop.example.com'), row('102','2','example.com')]];
  const calls = [], ctx = { store: createStore({STORE:'memory'}), fetch: async (url, opts) => { calls.push([new URL(url), opts]); return Response.json(replies.shift()); } };
  const first = await competitors(ctx, { query:'category', country:'IN', rival:{name:'Example',site:'example.com'} });
  assert.equal(first.status,'pending'); assert.equal(calls.length,1);
  const [url, opts] = calls[0]; assert.ok(url.searchParams.has('maxTotalChargeUsd')); assert.equal(opts.method,'POST');
  const payload = JSON.parse(opts.body); assert.equal(payload['scrapePageAds.countryCode'],'IN'); assert.ok(payload.count <= 90);
  assert.equal((await competitors(ctx,{job:first.job})).status,'pending');
  const done = await competitors(ctx,{job:first.job}); assert.equal(done.status,'done'); assert.equal(done.teardowns.length,1); assert.equal(done.teardowns[0].variants,2); assert.match(done.teardowns[0].url,/id=101$/); assert.equal(done.cost.usd,0.02);
  assert.deepEqual(await competitors(ctx,{job:first.job}),done); assert.equal(calls.length,4);
});
