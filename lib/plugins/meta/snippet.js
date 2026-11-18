// Install snippets. The storefront snippet fires fbq with an eventID and mirrors the same event
// to /api/collect/<siteKey> so Meta can deduplicate the browser and server copies.
const esc = s => String(s).replace(/[^\w.:/-]/g, '');

export function storefrontSnippet({ pixelId, siteKey, origin, consent = 'grant' }) {
  const wait = consent === 'wait';
  return `<!-- Coldstart · Meta Pixel + Conversions API (dataset ${esc(pixelId)}) -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
${wait ? "fbq('consent','revoke');\n" : ''}fbq('init','${esc(pixelId)}');
(function(){
  var U='${esc(origin)}/api/collect/${esc(siteKey)}', ok=${wait ? 'false' : 'true'}, q=[];
  function ck(n){var m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?decodeURIComponent(m[1]):undefined}
  function relay(b){var s=JSON.stringify(b);if(navigator.sendBeacon&&navigator.sendBeacon(U,new Blob([s],{type:'text/plain'})))return;fetch(U,{method:'POST',body:s,keepalive:true,mode:'no-cors'})}
  window.coldstart=function(name,data,opt){
    var id=(opt&&opt.eventID)||name.toLowerCase()+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    var b={event_name:name,event_id:id,event_source_url:location.href,custom_data:data||{},user:{fbp:ck('_fbp'),fbc:ck('_fbc'),external_id:opt&&opt.externalId}};
    fbq('track',name,data||{},{eventID:id});
    ok?relay(b):q.push(b);return id};
  window.coldstart.grant=function(){fbq('consent','grant');ok=true;while(q.length)relay(q.shift())};
  coldstart('PageView');
})();
</script>
<!-- Track more: coldstart('AddToCart', {value: 24, currency: 'USD', content_ids: ['sku-1'], content_type: 'product'}) -->`;
}

/** Shopify Admin → Settings → Customer events → Add custom pixel. Purchase is browser-only here;
 *  the server copy comes from the orders/paid webhook with the same event_id (order_<id>). */
export function shopifyCustomPixel({ pixelId, siteKey, origin }) {
  return `// Coldstart · Meta Pixel + CAPI for Shopify Customer Events (dataset ${esc(pixelId)})
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${esc(pixelId)}');
const U='${esc(origin)}/api/collect/${esc(siteKey)}';
const oid = c => 'order_' + String((c.order && c.order.id) || c.token).split('/').pop();
async function send(name, id, data, url, serverToo = true) {
  fbq('track', name, data, { eventID: id });
  if (!serverToo) return;
  const user = { fbp: await browser.cookie.get('_fbp'), fbc: await browser.cookie.get('_fbc') };
  fetch(U, { method: 'POST', keepalive: true, headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ event_name: name, event_id: id, event_source_url: url, custom_data: data, user }) });
}
analytics.subscribe('page_viewed', e => send('PageView', e.id, {}, e.context.document.location.href));
analytics.subscribe('product_viewed', e => { const v = e.data.productVariant; send('ViewContent', e.id, { content_ids: [v.product.id], content_type: 'product', value: v.price.amount, currency: v.price.currencyCode }, e.context.document.location.href); });
analytics.subscribe('product_added_to_cart', e => { const l = e.data.cartLine; send('AddToCart', e.id, { content_ids: [l.merchandise.product.id], content_type: 'product', value: l.cost.totalAmount.amount, currency: l.cost.totalAmount.currencyCode }, e.context.document.location.href); });
analytics.subscribe('checkout_started', e => { const c = e.data.checkout; send('InitiateCheckout', e.id, { value: c.totalPrice.amount, currency: c.currencyCode, num_items: c.lineItems.length }, e.context.document.location.href); });
analytics.subscribe('checkout_completed', e => { const c = e.data.checkout; send('Purchase', oid(c), { value: c.totalPrice.amount, currency: c.currencyCode, content_type: 'product', content_ids: c.lineItems.map(l => l.variant && l.variant.product.id) }, e.context.document.location.href, false); });`;
}
