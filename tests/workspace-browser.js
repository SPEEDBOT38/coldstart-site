/* Browser acceptance: execute as an async expression in the loaded app. */
(async () => {
  const checks = [], wait = (ms=100) => new Promise(r=>setTimeout(r,ms));
  const check = (name, value) => checks.push({name,pass:!!value});
  const go = async route => {location.hash='/'+route;await wait();};
  check('persistent workspace sidebar', !!document.querySelector('.sidebar'));
  check('prototype disclosure', /prototype/i.test(document.body.innerText));
  for (const route of ['overview','research','studio','calendar','ads','results','tracking','connections','brand']) {
    await go(route);
    check(route+' heading', document.querySelector('main h1')?.textContent?.trim());
    check(route+' active navigation', !!document.querySelector(`[href="#/${route}"][aria-current="page"]`));
    check(route+' no horizontal overflow', document.documentElement.scrollWidth <= innerWidth + 1);
  }
  await go('overview');
  check('overview command launcher & agent trace', !!document.querySelector('#command-input') && !!document.querySelector('#agent-trace') && document.querySelectorAll('.loop-row').length>=4);
  await go('research');
  check('research separates category and competitors', ['signals','category','competitors','saved'].every(tab=>document.querySelector(`[data-research="${tab}"]`)));
  check('research intent themes & crawl telemetry', document.querySelectorAll('[data-intent]').length>=5 && !!document.querySelector('#crawl-telemetry'));
  document.querySelector('[data-research="competitors"]').click(); await wait();
  check('competitor IG organic & Meta Ad Library teardown cards', document.querySelectorAll('[data-comp-filter]').length>=3 && document.querySelectorAll('.teardown-card').length>=4);
  document.querySelector('[data-research="signals"]').click(); await wait();
  await go('calendar');
  check('calendar timezone control', !!document.querySelector('#timezone'));
  check('calendar has entries', !!document.querySelector('[data-post]'));
  check('calendar pipeline ribbon & quick slot actions', !!document.querySelector('.pipeline-ribbon') && document.querySelectorAll('[data-action="quick-slot"]').length>=1);
  await go('studio');
  check('five destinations', document.querySelectorAll('#draft-platform option').length===5);
  check('three approval modes', document.querySelectorAll('[name="policy"]').length===3);
  check('studio top policy ribbon, platform-native fields & preflight', !!document.querySelector('.policy-ribbon') && !!document.querySelector('[data-platform-meta]') && !!document.querySelector('.preflight-list'));
  await go('tracking');
  for(let i=0;i<40&&!document.querySelector('#step-connect');i++)await wait(100);
  check('tracking renders the Meta Pixel + CAPI steps', ['#step-connect','#step-dataset','#step-install','#step-verify'].every(x=>document.querySelector(x)));
  await go('connections');for(let i=0;i<40&&!document.querySelector('.plug-card');i++)await wait(100);
  check('connections lists server plugins', ['meta','shopify','reddit','x'].every(id=>document.querySelector(`[data-plugin-card="${id}"]`)));
  check('publishing simulator kept separate', !!document.querySelector('[data-action="connection"][data-platform="instagram"]'));
  return {checks:checks.length, failures:checks.filter(x=>!x.pass),details:checks};
})()