import { randomUUID } from 'node:crypto';
import { need, PluginError } from '../http.js';
import { charge, limits } from '../../budget.js';
import { actorInput, keywordAds, resolveAds, rivalSpec } from './ads.js';
import { teardownAds } from './enrich.js';

const TTL = 600, MAX_ROWS = 60;
const prefix = 'research:rival:';
const pending = job => ({status:'pending', job, pollAfterMs:4000});
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(id);
async function api(ctx, path, body) {
  const r = await (ctx.fetch || fetch)('https://api.apify.com/v2/' + path, {
    method:body?'POST':'GET', redirect:'error', signal:AbortSignal.timeout(8000),
    headers:{authorization:'Bearer '+process.env.APIFY_TOKEN,'content-type':'application/json'}, body:body && JSON.stringify(body)
  });
  if (!r.ok) throw new PluginError('Apify request failed (HTTP '+r.status+').');
  return r.json();
}
function result(state, status, error, fields = {}) {
  return {status, query:state.query, country:state.country, rival:state.rival.name, at:new Date().toISOString(), source:{provider:'apify',status:error ? status : 'ok',count:fields.teardowns?.length || 0,error}, teardowns:[],competitors:[],ai:'none',cost:{usd:null}, ...fields};
}
// rival is a page spec, or {name, keyword:true} for a plain category search.
export async function startRival(ctx, input, query, keyword = false) {
  const country = String(input.country ?? 'US').toUpperCase();
  need(/^(?:[A-Z]{2}|ALL)$/.test(country),'Enter a two-letter country code or ALL.');
  const rival = keyword ? {name:query, keyword:true} : rivalSpec(input.rival);
  const state = {query,country,rival,brand:{name:String(input.brand?.name || '').slice(0,160),line:String(input.brand?.line || '').slice(0,500)}};
  if (!process.env.APIFY_TOKEN) return result(state,'needs_setup','Configure APIFY_TOKEN to look up named rivals.');
  await charge(ctx.store,'scan',ctx.ip,limits.scan());
  const started = await api(ctx,'acts/curious_coder~facebook-ads-library-scraper/runs?waitForFinish=0&timeout=170&memory=512&maxItems=60&maxTotalChargeUsd=0.25',actorInput(rival,country));
  if (!validId(started?.data?.id)) throw new PluginError('Apify did not return a run ID.');
  const job = randomUUID();
  await ctx.store.set(prefix+job,{...state,run:started.data.id},TTL);
  return pending(job);
}
async function poll(ctx, job) {
  const key = prefix+job, state = await ctx.store.get(key);
  need(state,'Unknown or expired rival job.');
  if (state.result) return state.result;
  const {data} = await api(ctx,'actor-runs/'+state.run);
  if (['READY','RUNNING','TIMING-OUT','ABORTING'].includes(data?.status)) return pending(job);
  let response;
  if (data?.status !== 'SUCCEEDED') response = result(state,'failed','Apify run did not succeed: '+String(data?.status || 'unknown').slice(0,32));
  else {
    if (!validId(data.defaultDatasetId)) throw new PluginError('Apify returned no valid ad dataset.');
    const rows = await api(ctx,`datasets/${data.defaultDatasetId}/items?clean=true&format=json&limit=${MAX_ROWS}`);
    if (!Array.isArray(rows)) throw new PluginError('Invalid Apify ad dataset.');
    const {ads,...match} = state.rival.keyword ? {ads:keywordAds(rows.slice(0,MAX_ROWS)), resolution:'keyword search', via:'keyword'} : resolveAds(rows.slice(0,MAX_ROWS),state.rival);
    const td = await teardownAds(ads,{query:state.query,brand:state.brand,fetch:ctx.fetch || fetch});
    const usd = data.usageTotalUsd;
    response = result(state,'done',null,{...td,...match,cost:{usd:typeof usd === 'number' ? Math.round((usd+(td.usd || 0))*1e6)/1e6 : null}});
  }
  await ctx.store.set(key,{result:response},TTL);
  return response;
}
// Coalesce overlapping UI requests on the same instance, including the final AI teardown.
const polling = new Map();
export function pollRival(ctx, job) {
  need(typeof job === 'string' && /^[a-f0-9-]{36}$/.test(job),'Invalid rival job.');
  if (!polling.has(job)) polling.set(job,poll(ctx,job).finally(()=>polling.delete(job)));
  return polling.get(job);
}
