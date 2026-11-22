// Live onboarding scan with the keys in .env. Usage: node scripts/onboard-smoke.mjs allbirds.com "wool sneakers" fashion
import fs from 'node:fs';
for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { onboardScan } = await import('../lib/plugins/onboard.js');
const { createStore } = await import('../lib/store.js');
const [site = 'allbirds.com', product = 'wool sneakers', cat = 'fashion'] = process.argv.slice(2);
const r = await onboardScan({ store: createStore({ STORE: 'memory' }), ip: 'smoke' }, { site, product, cat, ig: '', noIG: true, icpMode: 'help', rivals: [], rev: '50-250' });
console.log(`${r.ms}ms · ${r.model} · $${r.cost.usd}`); console.log(r.log.join('\n'));
console.log('sources', JSON.stringify(r.sources));
console.log('products', r.products.slice(0, 6).map(p => `${p.name} $${p.price}${p.image ? ' [img]' : ''}`).join(' | '));
for (const i of r.icps) console.log(`ICP ${i.name}: ${i.who} · pain: ${i.pain} · hook: "${i.hook}" · evidence: ${i.evidence}`);
console.log('brand', JSON.stringify(r.brand));
