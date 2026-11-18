// Named-rival resolution: actor targets are built locally, never fetched from user URLs.
import { need } from '../http.js';
const text = (s, n = 160) => typeof s === 'string' ? s.trim().slice(0,n) : '';
const nameKey = s => text(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
function urlOf(s) { try { const u = new URL(s); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u : null; } catch { return null; } }
function facebookSlug(url) {
  const u = urlOf(url);
  return u && /^(www\.|m\.)?facebook\.com$/.test(u.hostname) && /^\/[a-z0-9.]+\/?$/i.test(u.pathname) ? u.pathname.split('/')[1].toLowerCase() : '';
}
export function rivalSpec(raw) {
  const r = typeof raw === 'string' ? {name:raw} : raw || {};
  const name = text(r.name), parsed = urlOf(/^https?:/i.test(name) ? name : 'https://' + name);
  const siteInput = r.site || r.website || r.domain || (parsed?.hostname.includes('.') && !facebookSlug(parsed.href) ? name : '');
  const site = siteInput ? urlOf(/^https?:/i.test(siteInput) ? siteInput : 'https://' + siteInput)?.hostname.replace(/^www\./,'') : '';
  need(!siteInput || (site && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)), 'Invalid rival website.');
  const fb = facebookSlug(parsed?.href) || facebookSlug(r.fb) || text(r.fb).toLowerCase().replace(/^@/,'');
  need(!fb || /^[a-z0-9.]{1,100}$/.test(fb),'Invalid Facebook page handle.');
  const pageId = String(r.page_id || r.pageId || ''); need(!pageId || /^\d{1,30}$/.test(pageId),'Invalid rival page ID.');
  need(nameKey(name) || fb || site || pageId, 'Enter a rival name, website or Facebook page.');
  return { name:name || fb || site || pageId, site, fb, pageId };
}
export function actorInput(r, country) {
  const library = params => 'https://www.facebook.com/ads/library/?' + new URLSearchParams({active_status:'active',ad_type:'all',country,...params});
  const urls = [];
  if (r.pageId) urls.push(library({view_all_page_id:r.pageId,search_type:'page'}));
  else {
    const slug = r.fb || nameKey(r.name);
    if (/^[a-z0-9.]{2,80}$/.test(slug)) urls.push('https://www.facebook.com/' + slug);
    urls.push(library({q:r.site || r.name,search_type:'keyword_unordered'}));
  }
  return {urls:urls.map(url => ({url})),count:urls.length*30,limitPerSource:30,scrapeAdDetails:false,'scrapePageAds.activeStatus':'active','scrapePageAds.countryCode':country,'scrapePageAds.sortBy':'impressions_desc'};
}
function normalize(it) {
  const s = it?.snapshot || {}, c = s.cards?.[0] || {};
  const id = String(it?.ad_archive_id || it?.adArchiveID || it?.adArchiveId || '');
  if (!/^\d+$/.test(id) || it.is_active === false) return null;
  const clean = v => text(v,1500).replace(/\{\{[^}]+\}\}/g,'').trim();
  const raw = it.start_date ?? it.startDate ?? it.start_date_formatted;
  const d = raw ? new Date(/^\d+$/.test(raw) ? Number(raw)*(Number(raw)<1e12 ? 1000 : 1) : raw) : null;
  const started = d && Number.isFinite(+d) ? d.toISOString() : null;
  const image = [s.images?.[0], ...(Array.isArray(s.cards)?s.cards:[]), s.videos?.[0]].map(i => urlOf(i?.resized_image_url || i?.original_image_url || i?.video_preview_image_url || i?.url)?.href).find(Boolean);
  return { id, pageId:String(it.page_id || s.page_id || ''),author:text(it.page_name || s.page_name),slug:facebookSlug(s.page_profile_uri),host:urlOf(s.link_url || c.link_url)?.hostname,
    title:clean(s.title || c.title || it.ad_creative_link_title), text:clean(s.body?.text || c.body || it.ad_creative_body),image,
    url:'https://www.facebook.com/ads/library/?id='+id,started,days:started ? Math.max(0,Math.floor((Date.now()-d)/86400000)) : null,
    format:text(s.display_format || it.display_format) || (s.videos?.length?'VIDEO':s.cards?.length>1?'CAROUSEL':image?'IMAGE':'Meta ad'),
    group:it.collation_id, variants:Math.max(1,Number(it.collation_count)||1) };
}
export function resolveAds(rows, rival) {
  const groups = new Map(), ids = new Set();
  for (const row of rows) {
    const a = normalize(row); if (!a || ids.has(a.id)) continue; ids.add(a.id);
    const key = a.pageId || a.slug; if (!key) continue;
    if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(a);
  }
  const matches = [];
  for (const ads of groups.values()) {
    const a = ads[0], hits = ads.filter(x => x.host === rival.site || x.host?.endsWith('.'+rival.site)).length;
    const via = rival.pageId ? (a.pageId === rival.pageId && 'page ID') : rival.fb ? (ads.some(x => x.slug === rival.fb) && 'Facebook page') : rival.site ? ((hits >= 2 || hits/ads.length >= .5) && 'website') : (nameKey(a.author) === nameKey(rival.name) && 'exact page name');
    if (via) matches.push({ads,via});
  }
  if (matches.length !== 1) return {resolution:matches.length?'ambiguous':'not found', ads:[],candidates:[...new Set([...groups.values()].map(g=>g[0].author).filter(Boolean))].slice(0,3)};
  const {ads,via} = matches[0], creatives = new Map();
  for (const a of ads.filter(a=>a.image).sort((a,b)=>(a.started || '9').localeCompare(b.started || '9'))) {
    const key = a.group || nameKey(a.text.slice(0,80)+a.title) || a.id, old = creatives.get(key);
    if (!old) creatives.set(key,{...a,variant_count:a.variants,observedCount:1});
    else old.variant_count = Math.max(old.variant_count,a.variants,++old.observedCount);
  }
  const ordered = [...creatives.values()], longest = ordered.slice().sort((a,b)=>Number(a.format==='VIDEO')-Number(b.format==='VIDEO')).slice(0,10);
  const fresh = ordered.filter(a=>!longest.includes(a)).sort((a,b)=>(b.started || '').localeCompare(a.started || '')).slice(0,15-longest.length);
  return {resolution:'matched page',via,page:ads[0].author,pageId:ads[0].pageId,ads:[...longest,...fresh].map(a=>({...a,pick_reason:a.started ? longest.includes(a)?'long-running':'fresh' : null}))};
}
