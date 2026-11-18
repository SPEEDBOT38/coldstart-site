import test from 'node:test';
import assert from 'node:assert/strict';
import { listPlugins, getPlugin } from '../lib/plugins/index.js';

test('registry ships meta, shopify, reddit and x as plugins', () => {
  const ids = listPlugins().map(p => p.id);
  for (const id of ['meta', 'shopify', 'reddit', 'x']) assert.ok(ids.includes(id), id);
});

test('every plugin satisfies the connector contract', () => {
  for (const p of listPlugins()) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(p.name && p.description, p.id + ' name/description');
    assert.ok(Array.isArray(p.capabilities) && p.capabilities.length, p.id + ' capabilities');
    assert.ok(Array.isArray(p.env), p.id + ' env list');
    assert.ok(['oauth2', 'token'].includes(p.auth.type), p.id + ' auth');
    assert.equal(typeof p.authorizeUrl, 'function', p.id + ' authorizeUrl');
    assert.equal(typeof p.exchange, 'function', p.id + ' exchange');
    for (const [name, a] of Object.entries(p.actions)) {
      assert.ok(['GET', 'POST'].includes(a.method), `${p.id}.${name} method`);
      assert.equal(typeof a.run, 'function', `${p.id}.${name} run`);
    }
  }
});

test('a plugin is sandboxed until its app credentials exist', () => {
  const meta = getPlugin('meta');
  const saved = { ...process.env };
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
  assert.equal(meta.liveReady(), false);
  process.env.META_APP_ID = '123'; process.env.META_APP_SECRET = 'x';
  assert.equal(meta.liveReady(), true);
  process.env = saved;
});

test('PLUGINS env swaps the enabled set without code changes', () => {
  const saved = process.env.PLUGINS;
  process.env.PLUGINS = 'meta,shopify';
  assert.deepEqual(listPlugins().map(p => p.id), ['meta', 'shopify']);
  assert.equal(getPlugin('reddit'), null);
  if (saved === undefined) delete process.env.PLUGINS; else process.env.PLUGINS = saved;
});
