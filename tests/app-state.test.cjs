const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
function app(saved) {
  const listeners = {}, nodes = {}, storage = new Map(saved ? [['coldstart-app', saved]] : []);
  const node = (selector) => nodes[selector] ||= { innerHTML: '', textContent: '', value: '', dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, focus() {}, play: () => Promise.resolve(), pause() {}, removeAttribute() {} };
  const document = { querySelector: node, querySelectorAll: () => [], addEventListener: (type, fn) => listeners[type] = fn };
  const context = { document, window: {}, location: { hash: '#/run' }, matchMedia: () => ({ matches: true }), structuredClone, localStorage: { getItem: key => storage.get(key), setItem: (key, val) => storage.set(key, val) }, setTimeout: () => 1, clearTimeout() {}, scrollTo() {}, navigator: {}, addEventListener: (type, fn) => listeners[type] = fn };
  vm.runInNewContext(source, context);
  return {
    click(act, data = {}) { listeners.click({ target: { closest: () => ({ dataset: { act, ...data } }) } }); },
    route(view) { context.location.hash = '#/' + view; listeners.hashchange(); },
    input(id, value, extra = {}) { const target = Object.assign(node('#' + id), { id, value }, extra); listeners.input({ target }); },
    submit() { listeners.submit({ target: { id: 'brandForm' }, preventDefault() {} }); },
    node, state: () => JSON.parse(storage.get('coldstart-app')), saved: () => storage.get('coldstart-app'), html: () => node('#view').innerHTML,
  };
}
test('pause holds approved items for every publishing channel; resume releases only held items', () => {
  const a = app();
  a.click('approve', { id: 'q2' });
  assert.equal(a.state().queue.find(q => q.id === 'q2').status, 'held');
  a.click('connect', { id: 'reddit' });
  assert.equal(a.state().queue.find(q => q.id === 'q2').status, 'approved');
  for (const [channel, id] of [['reddit', 'q2'], ['ig', 'q1'], ['x', 'q3'], ['web', 'q5']]) {
    a.click('approve', { id });
    a.click('toggle', { id: channel });
    assert.equal(a.state().queue.find(q => q.id === id).status, 'held', channel + ' must hold approved work');
    a.click('toggle', { id: channel });
    assert.equal(a.state().queue.find(q => q.id === id).status, 'approved');
  }
  assert.equal(a.state().queue.find(q => q.id === 'q7').status, 'sent');
});
test('new workspace saves setup progress and keeps it separate from the Fernbook sample', () => {
  const a = app();
  a.click('mode', { mode: 'empty' });
  a.route('pixel'); a.node('#site').value = 'https://sprout.example'; a.click('savesite');
  a.route('brand');
  for (const [name, value] of [['name', 'Sprout'], ['line', 'Care for balcony plants']]) a.input('b-' + name, value, { name, form: { id: 'brandForm' } });
  a.submit(); a.route('channels'); a.click('connect', { id: 'web' });
  a.route('run');
  assert.match(a.html(), /3 of 3/);
  const b = app(a.saved());
  b.route('pixel'); assert.match(b.html(), /value="https:\/\/sprout.example"/);
  b.route('brand'); assert.match(b.html(), /value="Sprout"/);
  b.click('mode', { mode: 'running' }); assert.equal(b.state().brand.name, 'Fernbook');
  b.click('mode', { mode: 'empty' }); b.route('run'); assert.match(b.html(), /3 of 3/);
});
test('edit, filter, approve, drop and undo persist across reload', () => {
  const a = app(); a.route('queue');
  a.input('draft', 'Edited locally <not markup>', { dataset: { id: 'q1' } });
  a.click('filter', { key: 'chan', val: 'ig' });
  a.click('approve', { id: 'q1' });
  a.click('drop', { id: 'q0' });
  const b = app(a.saved());
  assert.equal(b.state().ui.chan, 'ig');
  assert.equal(b.state().queue.find(q => q.id === 'q1').body, 'Edited locally <not markup>');
  assert.equal(b.state().queue.find(q => q.id === 'q1').status, 'approved');
  assert.equal(b.state().queue.find(q => q.id === 'q0').status, 'rejected');
  b.click('undo', { id: 'q0' }); assert.equal(b.state().queue.find(q => q.id === 'q0').status, 'draft');
});
test('routine work uses neutral attention state, never distress clips', () => {
  const a = app();
  assert.equal(a.node('#coldieState').textContent, 'needs attention');
  assert.match(a.node('#coldieDuo video').src, /idle_stand\.webm$/);
  a.click('mode', { mode: 'empty' }); a.route('results');
  assert.doesNotMatch(a.html(), /cry_flail|angry_swear|faceplant|bomb_panic/);
  assert.doesNotMatch(a.node('#coldieDuo video').src, /cry_flail|angry_swear|faceplant|bomb_panic/);
});
const status = (a, id) => a.state().queue.find(q => q.id === id).status;
test('pausing the run holds approved work on every channel until it is resumed', () => {
  const a = app();
  a.click('approve', { id: 'q3' });
  assert.equal(status(a, 'q3'), 'approved');
  a.click('pause');
  assert.equal(a.state().paused, true);
  assert.equal(status(a, 'q3'), 'held');
  assert.equal(status(a, 'q6'), 'held');
  a.click('approve', { id: 'q4' });
  assert.equal(status(a, 'q4'), 'held', 'approving while paused must not release anything');
  assert.equal(a.node('#coldieState').textContent, 'paused');
  a.click('pause');
  assert.equal(a.state().paused, false);
  for (const id of ['q3', 'q4', 'q6']) assert.equal(status(a, id), 'approved');
  assert.equal(status(a, 'q2'), 'draft', 'resume must not approve drafts');
});
test('an X post over 280 characters cannot be approved', () => {
  const a = app(); a.route('queue');
  a.input('draft', 'x'.repeat(281), { dataset: { id: 'q3' } });
  a.click('approve', { id: 'q3' });
  assert.equal(status(a, 'q3'), 'draft');
  a.input('draft', 'x'.repeat(280), { dataset: { id: 'q3' } });
  a.click('approve', { id: 'q3' });
  assert.equal(status(a, 'q3'), 'approved');
});
test('Coldie performs the job on screen, and stands by for work that is not going out', () => {
  const a = app(), clip = () => a.node('#coldieDuo video').src;
  a.route('queue');
  assert.match(clip(), /ig_ad\.webm$/, 'selected Instagram draft');
  a.click('select', { id: 'q0' });
  assert.match(clip(), /idle_stand\.webm$/, 'a rejected ad must not show the megaphone');
  a.click('select', { id: 'q3' });
  assert.match(clip(), /x_post\.webm$/);
  a.route('pixel'); assert.match(clip(), /pixel_setup\.webm$/);
  a.route('competitors'); assert.match(clip(), /competitor_scan\.webm$/);
});
test('the four stages are the navigation and carry the run state', () => {
  const a = app();
  const nav = a.node('#nav').innerHTML;
  for (const name of ['Install', 'Scan', 'Campaigns', 'Results']) assert.match(nav, new RegExp(name));
  assert.match(nav, /is-done[^]*is-done[^]*is-now[^]*is-wait/);
  a.click('mode', { mode: 'empty' });
  assert.match(a.node('#nav').innerHTML, /is-now[^]*is-wait[^]*is-wait[^]*is-wait/);
});
test('mobile queue returns to list when its last matching draft is decided', () => {
  const a = app(); a.route('queue');
  a.click('filter', { key: 'chan', val: 'reddit' }); a.click('select', { id: 'q2' });
  a.click('approve', { id: 'q2' });
  assert.doesNotMatch(a.html(), /class="queue is-open"/);
});
module.exports = { app };
