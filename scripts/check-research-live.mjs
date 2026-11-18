// Read-only with respect to workspaces and social accounts. Two metered research scans, no publishing.
// Usage: node scripts/check-research-live.mjs <origin>
import assert from 'node:assert/strict';
import {postShape} from '../lib/plugins/research/verify.js';
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8765').origin;
for (const [name,query] of [['Allbirds','wool sneakers comfortable'],['GoMacro','plant based protein bar']]) {
 const res=await fetch(origin+'/api/plugins/research/actions/scan',{method:'POST',headers:{'content-type':'application/json','x-coldstart':'1'},body:JSON.stringify({query,brand:{name},sources:['reddit','x','instagram']}),signal:AbortSignal.timeout(65000)});
 assert.equal(res.status,200,`scan HTTP ${res.status}`);const r=await res.json();assert.equal(r.query,query);assert.equal(r.quality.shown,r.signals.length);
 const ids=new Set(); for(const s of r.signals){const p=postShape(s.source,s.url);assert.ok(p.ok);assert.ok(!ids.has(s.id));ids.add(s.id);assert.equal(typeof s.verified,'boolean');}
 for(const theme of r.themes){assert.ok(theme.refs.length>0,'unsupported theme');assert.ok(theme.refs.every(ref=>ids.has(ref)));}
 console.log(JSON.stringify({name,ms:r.ms,ai:r.ai,quality:r.quality,themeCount:r.themes.length,summary:r.summary,examples:r.signals.slice(0,2).map(s=>({title:s.title,url:s.url,verification:s.evidence})),notes:r.log},null,2));
}
