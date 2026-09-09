'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');
const { adaptExistingAdmin } = require('../src/integrations/pipeline');
const { createNextBridge } = require('../src/integrations/next-bridge');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-pipe-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  return { dir, dispose(fn) { t.after(async () => { try { await fn(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }); } };
}

test('adaptExistingAdmin serves existing pipelines with zero fs', async (t) => {
  const { dir, dispose } = tmpDir(t);
  const rows = [{ id: 'o1', total_usd: 10 }, { id: 'o2', total_usd: 20 }];
  const { pluginDefs, serverModules, assets } = adaptExistingAdmin({
    capabilityName: 'site.data',
    pipelines: [{
      id: 'guava-orders', name: 'Orders', icon: '🛒',
      resources: { orders: { list: 'orders.list' } },
      page: { path: 'guava-orders', title: 'Orders', order: 10 },
    }],
  });
  assert.equal(pluginDefs.length, 1);
  assert.ok(assets['oa/plugins/guava-orders/client.js'].content.includes('registerPage'));

  const kernel = new OpenAdminKernel({
    dataDir: path.join(dir, 'data'),
    siteName: 'Guava.land',
    pluginDefs,
    serverModules,
    assets,
  });
  kernel.capabilities.provide('site.data', { orders: { list: async () => rows } }, 'test');
  await kernel.init();
  dispose(() => kernel.close());

  const nav = kernel.plugins.nav();
  assert.ok(nav.some((n) => n.path === 'guava-orders'));
  assert.ok(kernel.plugins.clientEntryIds().includes('guava-orders'));

  // Exercise the generated route over live HTTP.
  const server = await kernel.listen(0, '127.0.0.1');
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/guava-orders/orders/list`);
  const payload = await res.json();
  assert.equal(res.status, 200);
  assert.equal(payload.items.length, 2);
});

test('next bridge gates non-admins and passes admins through', async (t) => {
  const tmp = tmpDir(t);
  const dir = tmp.dir;
  const kernel = new OpenAdminKernel({ dataDir: path.join(dir, 'data'), siteName: 'X', pluginDefs: [], serverModules: {}, assets: {} });
  await kernel.init();
  tmp.dispose(() => kernel.close());
  const bridge = createNextBridge({
    basePath: '/open-admin',
    getKernel: async () => ({ kernel }),
    isAdminRequest: async (req) => req.url.includes('admin=yes'),
  });
  const denied = await bridge.handler(new Request('http://x/open-admin/api/bootstrap', { method: 'GET' }));
  assert.equal(denied.status, 401);
  const allowed = await bridge.handler(new Request('http://x/open-admin/api/bootstrap?admin=yes', { method: 'GET' }));
  assert.equal(allowed.status, 200);
});

test('mobile shell ships drawer + compact CSS', async () => {
  const base = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'base.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(base.includes('oa-nav-open'), 'drawer CSS present');
  assert.ok(base.includes('oa-table-wrap'), 'table wrap CSS present');
  assert.ok(app.includes('menu-btn'), 'hamburger present');
  assert.ok(app.includes('setNavOpen'), 'drawer toggle present');
  assert.ok(html.includes('oa-scrim'), 'scrim present');
  assert.ok(html.includes('viewport-fit=cover'), 'mobile viewport present');
});
