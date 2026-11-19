// Shared helpers for the insights pipeline (ported from MetaCroc lib/util.js, without its database and hatchable deps).
export const ANGLES = ['aspiration', 'social proof', 'offer', 'pain point', 'authority', 'fomo', 'comparison', 'founder story', 'ugc testimonial', 'education', 'gifting', 'humour'];
export const str = (v, max = 500) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
export const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const daysSince = d => { const t = Date.parse(d); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null; };
export function clip(s, n) { s = String(s || '').trim(); if (s.length <= n) return s; const cut = s.slice(0, n); const i = cut.lastIndexOf(' '); return (i > n * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:.-]+$/, ''); }
