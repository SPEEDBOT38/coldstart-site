/* Execute in an isolated app.html session with onboarding rival Trail Co. No provider calls. */
(async () => {
  const $ = s => document.querySelector(s), click = s => $(s).click();
  const wait = () => new Promise(r => setTimeout(r, 30));
  let checks = 0;
  function check(value, name) { if (!value) throw Error(name); checks++; }
  let reply, body;
  const api = ColdConnectors.api;
  ColdConnectors.api = async (_, opts) => { body = opts.body; if (reply instanceof Error) throw reply; return reply; };
  async function submit(id) { $(id).requestSubmit(); await wait(); }
  try {
    click('[data-research="signals"]');
    const form = '#live-scan-form';
    const post={id:'live-1',title:'Current soil post',body:'Soil question',topic:'soil',intent:'Customer pain',source:'reddit',live:true,verified:true,tagged:'keywords'};
    reply={signals:[post], sources:{reddit:{status:'ok',mode:'archive',provider:'index',count:1,verified:1}},quality:{found:2,shown:1},ai:'keywords'};
    $(form).elements.query.value='soil'; await submit(form);
    check($('[data-signal="live-1"]') && /archive/.test($('.research-report').innerText) && /1 of 1 verified/.test($('.research-report').innerText),'current post and verification');
    check(/2 found/.test($('.research-report').innerText),'quality counters are visible');
    reply = {query:'soil', at:new Date().toISOString(), sources:{reddit:{status:'ok',provider:'posts',count:0,verified:0}}, signals:[],cost:{usd:0}};
    $(form).elements.query.value = 'soil'; await submit(form);
    check(!$('[data-signal]'), 'empty live scan replaced by sample rows');
    check(/retry/i.test($(form).innerText), 'empty scan has retry');
    reply = new Error('Provider unavailable'); click('[data-action="retry-source"][data-src="reddit"]'); await wait();
    check(body.sources.join(',')==='reddit','retry only the selected source');
    check(!$('[data-signal]') && $('#workspace').innerText.includes(reply.message), 'scan error persists without rows');
    click('[data-research="competitors"]');
    const ads = '#live-ads-form';
    check($(ads).elements.rival.value === 'Trail Co', 'onboarding prefill');
    $(ads).elements.query.value='hiking gear'; $(ads).elements.country.value='CA';
    reply={teardowns:[{id:'ad-current',brand:'Trail Co',channel:'paid',hook:'Trail offer',live:true}],competitors:[{name:'Trail Co'}],source:{status:'ok'}};
    await submit(ads);check($('.teardown-card') && $('.comparison tbody tr'),'current ad and brand rendered');
    reply={teardowns:[],competitors:[],source:{status:'empty'}}; await submit(ads);
    check(body.query==='hiking gear' && body.rival==='Trail Co' && body.country==='CA','named ads payload');
    check(!$('.teardown-card') && !$('.comparison tbody tr'), 'empty ads have no sample cards or brands');
    $(ads).elements.rival.value=' '; reply=new Error('Ads unavailable'); await submit(ads);
    check(!('rival' in body) && !$('.teardown-card') && $('#workspace').innerText.includes(reply.message),'category retry omits rival and retains error');
    return {checks};
  } finally { ColdConnectors.api = api; }
})()
