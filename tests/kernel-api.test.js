'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');

async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-api-'));
  const kernel = new OpenAdminKernel({ dataDir: path.join(dir, 'data'), siteName: 'Test Site' });
  await kernel.init();
  const server = await kernel.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { kernel, base };
}

test('bootstrap exposes nav, plugins, widgets and client modules', async (t) => {
  const { base } = await boot(t);
  const res = await fetch(base + '/api/bootstrap');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.siteName, 'Test Site');
  assert.equal(data.home, 'social');
  assert.ok(data.plugins.length >= 7);
  assert.ok(data.clients.includes('social-admin'));
  assert.ok(data.widgets['dashboard.grid'].some((w) => w.id === 'social-summary'));
  const social = data.plugins.find((p) => p.id === 'social-admin');
  assert.equal(social.version, '1.2.0');
});

test('activity events from anywhere become Social feed posts', async (t) => {
  const { base } = await boot(t);
  const emit = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'activity', payload: { activity: { text: 'hello from the site', icon: '🏬', source: 'northwind-site' } } }),
  });
  assert.equal(emit.status, 200);
  const { posts } = await (await fetch(base + '/api/social/feed')).json();
  const found = posts.find((p) => p.text.includes('hello from the site'));
  assert.ok(found, 'activity became a post');
  assert.equal(found.source, 'northwind-site');
});

test('feedback endpoint works and lands on the board + feed', async (t) => {
  const { base } = await boot(t);
  const res = await fetch(base + '/api/social/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Visitor', message: 'Love the new checkout', type: 'praise' }),
  });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.status, 'open');

  const board = await (await fetch(base + '/api/social/feedback')).json();
  assert.ok(board.feedback.some((f) => f.id === item.id));

  const up = await (await fetch(`${base}/api/social/feedback/${item.id}/upvote`, { method: 'POST' })).json();
  assert.equal(up.upvotes, 1);

  const { posts } = await (await fetch(base + '/api/social/feed')).json();
  assert.ok(posts.some((p) => p.kind === 'feedback' && p.feedbackId === item.id), 'feedback announced in feed');
});

test('posts, reactions, comments, resolve', async (t) => {
  const { base } = await boot(t);
  const post = await (await fetch(base + '/api/social/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Shipped the thing #ship' }),
  })).json();
  assert.equal(post.kind, 'announcement');
  assert.deepEqual(post.tags, ['ship']);

  const reacted = await (await fetch(`${base}/api/social/posts/${post.id}/react`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji: '🔥' }),
  })).json();
  assert.equal(reacted.reactions['🔥'], 1);
  const undone = await (await fetch(`${base}/api/social/posts/${post.id}/react`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji: '🔥', on: false }),
  })).json();
  assert.equal(undone.reactions['🔥'], undefined);

  const commented = await (await fetch(`${base}/api/social/posts/${post.id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'nice work' }),
  })).json();
  assert.equal(commented.comments.length, 1);

  const resolved = await (await fetch(`${base}/api/social/posts/${post.id}/resolve`, { method: 'POST' })).json();
  assert.equal(resolved.resolved, true);
});

test('updates: check + apply bumps version and avoids re-apply', async (t) => {
  const { base } = await boot(t);
  const { updates } = await (await fetch(base + '/api/updates')).json();
  const pending = updates.find((u) => u.hasUpdate);
  assert.ok(pending, 'at least one pending update');
  const applied = await fetch(`${base}/api/updates/${pending.id}/apply`, { method: 'POST' });
  assert.equal(applied.status, 200);
  const again = await fetch(`${base}/api/updates/${pending.id}/apply`, { method: 'POST' });
  assert.equal(again.status, 409, 're-apply refused');
  const { updates: after } = await (await fetch(base + '/api/updates')).json();
  assert.equal(after.find((u) => u.id === pending.id).hasUpdate, false);
});

test('enable shop-stats via API, its page + widget + route appear', async (t) => {
  const { base, kernel } = await boot(t);
  const res = await fetch(base + '/api/plugins/shop-stats/enable', { method: 'POST' });
  assert.equal(res.status, 200);
  const boot2 = await (await fetch(base + '/api/bootstrap')).json();
  assert.ok(boot2.nav.some((n) => n.path === 'shop-stats'));
  assert.ok(boot2.widgets['dashboard.grid'].some((w) => w.id === 'shop-revenue'));
  const metrics = await fetch(base + '/api/shop-stats/metrics');
  assert.equal(metrics.status, 200);
  // and disable again
  const off = await fetch(base + '/api/plugins/shop-stats/disable', { method: 'POST' });
  assert.equal(off.status, 200);
  const after = await (await fetch(base + '/api/shop-stats/metrics'));
  assert.equal(after.status, 404, 'plugin route revoked');
  void kernel;
});

test('SPA is served with base-path injection and plugin assets resolve', async (t) => {
  const { base } = await boot(t);
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('window.OA_BASE'), 'index served');
  const js = await fetch(base + '/oa/plugins/social-admin/client.js');
  assert.equal(js.status, 200);
  const oa = await fetch(base + '/oa/js/oa.js');
  assert.equal(oa.status, 200);
  const missing = await fetch(base + '/api/nope');
  assert.equal(missing.status, 404);
});
