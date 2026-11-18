import test from 'node:test';
import assert from 'node:assert/strict';
import { rivalSpec, resolveAds, actorInput } from '../lib/plugins/research/ads.js';
const row = (id,page,name) => ({ad_archive_id:String(id),page_id:page,page_name:name,start_date:1700000000+id*86400,snapshot:{body:{text:'Creative '+id},videos:[{video_preview_image_url:'https://cdn.example/preview'}]}});

test('does not merge namesakes, use substring matches or infer an archive ID from a page ID',()=>{
  const r = rivalSpec('Acme');
  assert.equal(resolveAds([row(1,'a','Acme'),row(2,'b','Acme')],r).resolution,'ambiguous');
  assert.equal(resolveAds([row(1,'a','Acme Reseller')],r).resolution,'not found');
  assert.equal(resolveAds([{...row(1,'a','Acme'),ad_archive_id:undefined,id:'123'}],r).resolution,'not found');
});
test('selects at most ten oldest and five freshest visible distinct creatives',()=>{
  const rows = Array.from({length:30},(_,i)=>row(i+1,'11','Acme'));
  const {ads} = resolveAds([...rows,{...row(31,'11','Acme'),snapshot:{}}],rivalSpec({name:'Acme',pageId:'11'}));
  assert.deepEqual(ads.map(a=>a.id),['1','2','3','4','5','6','7','8','9','10','30','29','28','27','26']);
});
test('explicit Facebook page ID produces one country-specific target; URLs never target user hosts',()=>{
  const p = actorInput(rivalSpec({pageId:'123'}),'IN');
  assert.equal(p.urls.length,1); const u = new URL(p.urls[0].url); assert.equal(u.searchParams.get('view_all_page_id'),'123'); assert.equal(u.searchParams.get('country'),'IN');
  assert.ok(actorInput(rivalSpec('https://facebook.com.evil.example/Acme'),'US').urls.every(({url})=>new URL(url).hostname==='www.facebook.com'));
});
