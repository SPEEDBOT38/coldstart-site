const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../js/workspace-state.js');
const NOW = '2026-11-16T09:00:00.000Z';
const LATER = '2026-11-16T12:00:00.000Z';
function fresh() { const s = E.seed(NOW); s.posts = []; return s; }
function make(s, platform = 'x', campaign = 'launch') {
  return E.createPost(s, {platform, campaign, title: 'Sample plant care', body: 'Water after checking soil.', sourceId: 'sample-guide'}).post;
}
test('createPost validates inputs and makes unique drafts on all five destinations', () => {
  const s = fresh();
  for (const platform of Object.keys(s.connections)) {
    const p = make(s, platform);
    assert.equal(p.status, 'draft'); assert.equal(p.approved, false);
    assert.equal(p.sourceId, 'sample-guide'); assert.equal(p.scheduledAt, null);
    assert.deepEqual(Object.keys(p).sort(), ['id','campaign','platform','title','body','status','scheduledAt','approved','sourceId','media','ruleChecked','error','attempts'].sort());
  }
  assert.equal(new Set(s.posts.map(p => p.id)).size, 5);
  for (const input of [null, {}, {platform:'email'}, {platform:'x', campaign:'unknown',title:'a',body:'b'}, {platform:'x',campaign:'launch',title:'',body:'b'}]) {
    const r = E.createPost(s,input); assert.equal(r.ok,false); assert.equal(typeof r.reason,'string');
  }
  assert.equal(s.posts.length,5);
});
test('approve touches one editable post, rejects missing and terminal posts', () => {
  const s=fresh(), a=make(s), b=make(s);
  assert.equal(E.approve(s,a.id).ok,true); assert.equal(a.status,'approved'); assert.equal(a.approved,true);
  assert.equal(b.approved,false); assert.equal(E.approve(s,'missing').ok,false);
  for (const status of ['published','cancelled']) { b.status=status; const before=JSON.stringify(b);
    assert.equal(E.approve(s,b.id).ok,false); assert.equal(JSON.stringify(b),before); }
});
test('batch approval is scoped to batch campaign and leaves terminal work intact', () => {
 const s=fresh(), a=make(s,'x','evergreen'), b=make(s,'facebook','evergreen'), c=make(s);
 b.status='cancelled'; assert.equal(E.approveBatch(s,'launch').ok,false);
 assert.equal(E.approveBatch(s,'missing').ok,false); assert.equal(E.approveBatch(s,'evergreen').ok,true);
 assert.equal(a.approved,true); assert.equal(c.approved,false); assert.equal(b.status,'cancelled');
});
test('setPolicy validates atomic rules and never changes existing posts', () => {
 const s=fresh(); make(s); const before=JSON.stringify(s.posts);
 const rules={platforms:['x','reddit'],maxPerDay:2,requireEvidence:true};
 assert.equal(E.setPolicy(s,'launch','auto',rules).ok,true);
 assert.equal(JSON.stringify(s.posts),before); assert.equal(s.campaigns[0].policy,'auto');
 rules.platforms.push('instagram'); assert.deepEqual(s.campaigns[0].rules.platforms,['x','reddit']);
 for(const mode of ['each','batch','auto']) assert.equal(E.setPolicy(s,'launch',mode).ok,true);
 for(const bad of [{maxPerDay:0},{maxPerDay:1.5},{platforms:['email']},{requireEvidence:'yes'}]) {
   const prev=JSON.stringify(s.campaigns); assert.equal(E.setPolicy(s,'launch','auto',bad).ok,false); assert.equal(JSON.stringify(s.campaigns),prev);
 }
 assert.equal(E.setPolicy(s,'launch','invalid').ok,false); assert.equal(E.setPolicy(s,'unknown','each').ok,false);
});
test('schedule requires future UTC time, approval and destination prerequisites', () => {
 const s=fresh();
 for (const platform of Object.keys(s.connections)) {
  const p=make(s,platform); assert.equal(E.schedule(s,p.id,LATER,NOW).ok,false);
  E.approve(s,p.id);
  for(const date of ['bad',NOW,'2026-11-15T12:00:00Z','2026-11-16T13:00:00+01:00','2026-02-30T12:00:00Z']) assert.equal(E.schedule(s,p.id,date,NOW).ok,false);
  if(platform==='instagram') {assert.equal(E.schedule(s,p.id,LATER,NOW).ok,false);p.media=true;}
  if(platform==='reddit') {assert.equal(E.schedule(s,p.id,LATER,NOW).ok,false);p.ruleChecked=true;}
  assert.equal(E.schedule(s,p.id,LATER,NOW).ok,true); assert.equal(p.status,'scheduled'); assert.equal(p.scheduledAt,LATER);
 }
 assert.equal(E.schedule(s,'missing',LATER,NOW).ok,false);
 const p=s.posts[0]; p.status='published'; assert.equal(E.schedule(s,p.id,LATER,NOW).ok,false);
});
test('disconnect and pause hold work and restore only eligible schedules', () => {
 const s=fresh(), a=make(s), b=make(s,'facebook'), draft=make(s);
 E.approve(s,a.id); E.approve(s,b.id); E.schedule(s,a.id,LATER,NOW); E.schedule(s,b.id,LATER,NOW);
 assert.equal(E.setConnection(s,'x',false).ok,true); assert.equal(a.status,'held'); assert.equal(b.status,'scheduled'); assert.equal(draft.status,'draft');
 assert.equal(E.setPaused(s,true).ok,true); assert.equal(b.status,'held');
 E.setConnection(s,'x',true); assert.equal(a.status,'held');
 E.setPaused(s,false); assert.equal(a.status,'scheduled'); assert.equal(b.status,'scheduled');
 E.setConnection(s,'x',false); a.approved=false; E.setConnection(s,'x',true); assert.equal(a.status,'held');
 const c=make(s,'instagram'); c.media=true; E.approve(s,c.id); E.setPaused(s,true);
 assert.equal(E.schedule(s,c.id,LATER,NOW).ok,true); assert.equal(c.status,'held');
 c.media=false; E.setPaused(s,false); assert.equal(c.status,'held');
 assert.equal(E.setConnection(s,'email',true).ok,false); assert.equal(E.setConnection(s,'x','yes').ok,false); assert.equal(E.setPaused(s,'yes').ok,false);
});
test('edit invalidates approval and schedule while preserving other post fields', () => {
 const s=fresh(), p=make(s); E.approve(s,p.id); E.schedule(s,p.id,LATER,NOW);
 assert.equal(E.edit(s,p.id,{title:'Updated sample',body:'New care advice',approved:true}).ok,true);
 assert.equal(p.title,'Updated sample'); assert.equal(p.status,'needs_approval'); assert.equal(p.approved,false); assert.equal(p.scheduledAt,null);
 assert.equal(p.sourceId,'sample-guide'); const before=JSON.stringify(p);
 assert.equal(E.edit(s,p.id,{title:'',body:'x'}).ok,false); assert.equal(JSON.stringify(p),before);
 assert.equal(E.edit(s,'missing',{}).ok,false);
 for(const status of ['published','cancelled']) {p.status=status;assert.equal(E.edit(s,p.id,{title:'x',body:'y'}).ok,false);assert.equal(p.title,'Updated sample');}
});
test('automation explicitly approves only guard-qualified drafts up to its cap', () => {
 const s=fresh(), allowed=make(s), noEvidence=make(s), reddit=make(s,'reddit'), forbidden=make(s,'facebook'), extra=make(s), other=make(s,'x','evergreen');
 noEvidence.sourceId=null; assert.equal(E.applyAutomation(s,'launch').ok,false);
 E.setPolicy(s,'launch','auto',{platforms:['x','reddit'],maxPerDay:2,requireEvidence:true});
 assert.equal(E.applyAutomation(s,'launch').ok,true);
 assert.equal(allowed.approved,true); assert.equal(extra.approved,true);
 for(const p of [noEvidence,reddit,forbidden,other]) assert.equal(p.approved,false);
 reddit.ruleChecked=true; E.applyAutomation(s,'launch'); assert.equal(reddit.approved,false);
 assert.equal(allowed.status,'approved'); assert.equal(allowed.scheduledAt,null);
 E.setPolicy(s,'launch','auto',{maxPerDay:4,requireEvidence:false}); E.applyAutomation(s,'launch');
 assert.equal(noEvidence.approved,true); assert.equal(reddit.approved,true);
 assert.equal(E.applyAutomation(s,'missing').ok,false);
});
test('automatic schedules enforce current guards and campaign UTC daily cap', () => {
 const s=fresh(), a=make(s), b=make(s); E.approve(s,a.id); E.approve(s,b.id);
 E.setPolicy(s,'launch','auto',{platforms:['x'],maxPerDay:1,requireEvidence:true});
 assert.equal(E.schedule(s,a.id,LATER,NOW).ok,true);
 assert.equal(E.schedule(s,a.id,'2026-11-16T13:00:00Z',NOW).ok,true);
 assert.equal(E.schedule(s,b.id,LATER,NOW).ok,false);
 assert.equal(E.schedule(s,b.id,'2026-11-17T12:00:00Z',NOW).ok,true);
 b.sourceId=null; assert.equal(E.schedule(s,b.id,'2026-11-18T12:00:00Z',NOW).ok,false);
 E.setConnection(s,'x',false); E.setConnection(s,'x',true); assert.equal(b.status,'held');
});
test('simulatePublish isolates outcomes, records safe failure, retries and blocks duplicates', () => {
 const s=fresh(), posts=Object.keys(s.connections).map(k=>make(s,k));
 for(const p of posts) {p.media=true;p.ruleChecked=true;E.approve(s,p.id);}
 const failed=posts[0]; assert.equal(E.simulatePublish(s,failed.id,'failure',NOW).ok,false);
 assert.equal(failed.status,'failed');assert.equal(failed.attempts,1); assert.match(failed.error,/simulat/i);
 for(const p of posts.slice(1)) { assert.equal(p.status,'approved');assert.equal(E.simulatePublish(s,p.id,'success',NOW).ok,true);assert.equal(p.status,'published');assert.equal(p.attempts,1); }
 assert.equal(E.simulatePublish(s,failed.id,'success',NOW).ok,true);assert.equal(failed.attempts,2);
 const snapshot=JSON.stringify(s);
 assert.equal(E.simulatePublish(s,failed.id,'success',NOW).ok,false);assert.equal(JSON.stringify(s),snapshot);
 const draft=make(s);assert.equal(E.simulatePublish(s,draft.id,'success',NOW).ok,false);
 E.approve(s,draft.id);const before=JSON.stringify(draft);
 assert.equal(E.simulatePublish(s,draft.id,'<script>bad</script>',NOW).ok,false);assert.equal(JSON.stringify(draft),before);
 assert.equal(E.simulatePublish(s,'missing').ok,false);
 assert(s.activity.every(a=>/simulation/i.test(a.text)));
});
test('simulation respects pause, disconnect, due time and revalidates direct field edits', () => {
 const s=fresh(), p=make(s,'instagram');p.media=true;E.approve(s,p.id);E.schedule(s,p.id,LATER,NOW);
 assert.equal(E.simulatePublish(s,p.id,'success',NOW).ok,false);assert.equal(p.attempts,0);
 E.setConnection(s,'instagram',false);assert.equal(E.simulatePublish(s,p.id,'success',LATER).ok,false);assert.equal(p.status,'held');assert.equal(p.attempts,0);
 E.setConnection(s,'instagram',true);E.setPaused(s,true);assert.equal(E.simulatePublish(s,p.id,'success',LATER).ok,false);assert.equal(p.attempts,0);
 E.setPaused(s,false);p.media=false;assert.equal(E.simulatePublish(s,p.id,'success',LATER).ok,false);
 p.media=true; assert.equal(E.simulatePublish(s,p.id,'success',LATER).ok,true);
 const q=make(s);E.approve(s,q.id);E.setConnection(s,'x',false);assert.equal(E.simulatePublish(s,q.id,'success',NOW).ok,false);assert.equal(q.status,'held');
 E.setConnection(s,'x',true);assert.equal(q.status,'held');assert.equal(q.scheduledAt,null);
});
test('cancel clears approval and schedule and terminal posts remain immutable across APIs', () => {
 const s=fresh(), p=make(s);E.approve(s,p.id);E.schedule(s,p.id,LATER,NOW);
 assert.equal(E.cancel(s,p.id).ok,true);assert.equal(p.status,'cancelled');assert.equal(p.approved,false);assert.equal(p.scheduledAt,null);
 assert.equal(E.cancel(s,'missing').ok,false);
 for(const status of ['cancelled','published']) {
  p.status=status;const snapshot=JSON.stringify(p);
  for(const invoke of [()=>E.cancel(s,p.id),()=>E.approve(s,p.id),()=>E.edit(s,p.id,{title:'x',body:'y'}),()=>E.schedule(s,p.id,LATER,NOW),()=>E.simulatePublish(s,p.id,'success',NOW)]) assert.equal(invoke().ok,false);
  E.setConnection(s,'x',false);E.setPaused(s,true);E.setConnection(s,'x',true);E.setPaused(s,false);
  assert.equal(JSON.stringify(p),snapshot);
 }
});
test('automatic approvals count today reservations but not other UTC dates', t => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
 const s=fresh(), published=make(s), tomorrow=make(s), a=make(s), b=make(s);
 E.approve(s,published.id); E.simulatePublish(s,published.id,'success',NOW);
 E.approve(s,tomorrow.id); E.schedule(s,tomorrow.id,'2026-11-17T12:00:00Z',NOW);
 E.setPolicy(s,'launch','auto',{maxPerDay:2}); E.applyAutomation(s,'launch');
 assert.equal(a.approved,true); assert.equal(b.approved,false);
});
test('seed has exact shared contract, fictional samples and browser export', () => {
  const s = E.seed(NOW);
  assert.equal(s.version, 1);
  assert.deepEqual(Object.keys(s).sort(), ['version','brand','campaigns','connections','paused','posts','activity','tracking','saved'].sort());
  assert.equal(s.brand.name, 'Fern & Form');
  assert.equal(s.tracking.store, 'fern-and-form.myshopify.com');
  assert.equal(s.tracking.installed, false);
  assert.equal(s.posts.length, 10);
  assert.deepEqual([...new Set(s.posts.map(p => p.platform))].sort(), ['facebook','instagram','reddit','shopify','x']);
  assert(s.posts.some(p => p.status === 'published'));
  assert(s.posts.some(p => p.status === 'failed'));
  assert(s.posts.some(p => p.status === 'scheduled' && p.scheduledAt.startsWith('2026-11-16')));
  assert(s.posts.some(p => p.status === 'scheduled' && p.scheduledAt.startsWith('2026-11-17')));
  assert(new Set(s.posts.filter(p => p.scheduledAt).map(p => p.scheduledAt.slice(0, 10))).size >= 4);
  assert(s.activity.every(a => /sample|simulation/i.test(a.text)));
  const box = { module: {exports: {}} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/workspace-state.js'), 'utf8'), box);
  assert.equal(box.ColdState, box.module.exports);
  assert.notEqual(E.seed(NOW).posts, s.posts);
});
