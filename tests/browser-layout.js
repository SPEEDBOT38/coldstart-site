/* Run in app.html using browser console or the browser harness; returns a report. */
(async () => {
  const failures = [], checked = [];
  const check = (ok, message) => { checked.push(message); if (!ok) failures.push(message); };
  const visit = async (name) => { location.hash = '#/' + name; dispatchEvent(new Event('hashchange')); };
  for (const route of ['run', 'queue', 'channels', 'pixel', 'competitors', 'results', 'brand']) {
    await visit(route);
    check(document.documentElement.scrollWidth <= innerWidth, route + ': no page overflow');
    if (innerWidth <= 900) {
      for (const el of document.querySelectorAll('#view button:not(:disabled), #view select, .topbar button')) {
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height) check(rect.height >= 44, route + ': touch target ' + (el.textContent.trim() || el.getAttribute('aria-label')));
      }
    }
    if (route === 'results' && document.querySelector('.res')) {
      const headers = [...document.querySelector('.res .th').children].filter(el => getComputedStyle(el).display !== 'none');
      if (innerWidth <= 900) check(headers.map(el => el.textContent).join('|') === 'source|visits|sign-ups', 'mobile results: three correctly aligned column headers');
    }
  }
  return { viewport: innerWidth, checks: checked.length, failures };
})()
