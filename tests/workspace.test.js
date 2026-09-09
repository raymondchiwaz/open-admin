'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');
const { Store } = require('../src/core/store');

async function boot(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-workspace-'));
  const kernel = new OpenAdminKernel({ dataDir: dir, ...options });
  await kernel.init();
  const server = await kernel.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}${options.basePath || ''}`;
  t.after(async () => { await kernel.close(); fs.rmSync(dir, {recursive:true,force:true}); });
  return { kernel, dir, base, get: async (url) => (await fetch(base + url)).json() };
}

test('feed combines attention, text, source, saved filters and bounded pagination', async t => {
  const {kernel,get} = await boot(t);
  const posts = kernel.store.collection('social-admin.posts');
  posts.replaceAll(Array.from({length:105},(_,i)=>({
    id:'post-'+i, text:i % 2 ? 'Deploy complete' : 'Review the release #release', tags:['release'],
    author:{name:'Release team'}, kind:i%3?'announcement':'update', source:i%2?'ci':'team',
    resolved:i===0, status:i===2?{level:'error',label:'failed'}:null,
    createdAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),
  })));
  const attention=await get('/api/social/feed?tab=attention');
  assert.ok(attention.posts.some(p=>p.id==='post-2'));
  assert.ok(!attention.posts.some(p=>p.id==='post-0'));
  assert.ok(attention.posts.every(p=>!p.resolved&&(p.kind==='update'||p.status?.level==='error')));
  const combined=await get('/api/social/feed?tab=attention&source=team&q=RELEASE');
  assert.ok(combined.posts.length>0);
  assert.ok(combined.posts.every(p=>p.source==='team'&&p.text.includes('release')));
  const page1=await get('/api/social/feed?limit=7');
  const page2=await get('/api/social/feed?limit=7&offset='+page1.nextOffset);
  assert.equal(page1.total,105);assert.equal(page1.hasMore,true);
  assert.equal(page2.posts.length,7);assert.equal(new Set([...page1.posts,...page2.posts].map(p=>p.id)).size,14);
  assert.deepEqual(page1.sources,['ci','team']);
  assert.equal((await get('/api/social/feed?limit=9999')).posts.length,100);
  assert.equal((await get('/api/social/feed?limit=nope&offset=-4')).posts.length,60);
  assert.equal((await get('/api/social/feed?limit=-2')).posts.length,1);
  assert.equal((await get('/api/social/feed?tab=saved')).total,0);
  assert.deepEqual((await get('/api/social/feed?tab=saved&ids=post-0,post-104')).posts.map(p=>p.id),['post-104','post-0']);
  assert.equal((await get('/api/social/feed?q=%23release')).total,105);
});

test('health stories distinguish missing telemetry from real zero values', async t => {
  const {kernel,get}=await boot(t);
  kernel.store.collection('social-admin.posts').replaceAll([]);
  const stories=(await get('/api/social/stories')).stories;
  for(const id of ['uptime','errors','visitors']) assert.equal(stories.find(s=>s.id===id).value,'Not connected');
  assert.equal(stories.find(s=>s.id==='deploys').value,'0');
  // Check the actual namespaced adapter, so zero is never mistaken for absence.
  const ctx=kernel.createPluginContext({id:'social-admin'});
  ctx.store.setState('errors24h',0);
  ctx.store.setState('visitorsNow',0);
  const fresh=(await get('/api/social/stories')).stories;
  assert.equal(fresh.find(s=>s.id==='errors').value,'0');
  assert.equal(fresh.find(s=>s.id==='visitors').value,'0');
});

test('workspace assets and new feed API work when embedded under a base path', async t => {
  const {base}=await boot(t,{basePath:'/admin'});
  const html=await (await fetch(base+'/')).text();
  assert.ok(html.includes('/admin/oa/css/workspace.css'));
  for(const asset of ['/oa/css/workspace.css','/oa/icons/house.svg','/oa/js/app.js','/oa/plugins/social-admin/client.js']) {
    const res=await fetch(base+asset);assert.equal(res.status,200,asset);
  }
  assert.ok(require('../package.json').files.includes('public'));
});

test('shutdown persists an update before the debounce interval expires', async t => {
  const {kernel,dir}=await boot(t);
  kernel.store.collection('shutdown-check').insert({id:'saved',text:'team update'});
  kernel.store.kvSet('shutdown-setting','saved');
  await kernel.close();
  const restored=new Store(dir);
  assert.equal(restored.collection('shutdown-check').get('saved').text,'team update');
  assert.equal(restored.kvGet('shutdown-setting'),'saved');
});
