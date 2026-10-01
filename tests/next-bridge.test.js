'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');
const { createNextBridge } = require('../src/integrations/next-bridge');

async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-bridge-'));
  const kernel = new OpenAdminKernel({ dataDir: dir, basePath: '/open-admin', loadBuiltins: false, seedDemo: false, workspace: { brand: 'Guava.land' } });
  await kernel.init();
  t.after(async () => { await kernel.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const bridge = createNextBridge({ getKernel: async () => ({ kernel }), isAdminRequest: async request => request.headers.get('x-test-admin') === 'yes' });
  const request = (url, opts = {}) => new Request('https://guava.test/open-admin' + url, { ...opts, headers: { 'x-test-admin': 'yes', ...opts.headers } });
  return { kernel, bridge, request };
}

test('bundled host excludes demo data and standalone plugins and exposes its workspace', async t => {
  const { kernel, bridge, request } = await boot(t);
  const response = await bridge.handler(request('/api/bootstrap'));
  const body = await response.json();
  assert.equal(body.workspace.brand, 'Guava.land');
  assert.equal(body.plugins.length, 0);
  assert.equal(kernel.store.kvGet('seeded', false), false);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('static file piping is complete before returning a Web response', async t => {
  const { bridge, request } = await boot(t);
  const response = await bridge.handler(request('/oa/js/oa.js'));
  assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '../public/js/oa.js'), 'utf8'));
});

test('SSE streams events and removes cancelled and aborted subscribers', async t => {
  const { kernel, bridge, request } = await boot(t);
  const response = await bridge.handler(request('/api/events/stream'));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('connection'), null);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 2000/);
  assert.equal(kernel.sse.clientCount, 1);
  kernel.bus.emit('guava.order.updated', { id: 'order-1' });
  assert.match(new TextDecoder().decode((await reader.read()).value), /order-1/);
  await reader.cancel();
  assert.equal(kernel.sse.clientCount, 0);
  const controller = new AbortController();
  const second = await bridge.handler(request('/api/events/stream', { signal: controller.signal }));
  assert.equal(kernel.sse.clientCount, 1);
  controller.abort();
  assert.equal(kernel.sse.clientCount, 0);
  await second.body.cancel();
});

test('admin gate, origin checks, OPTIONS and body limits remain enforced', async t => {
  const { bridge, request } = await boot(t);
  assert.equal((await bridge.handler(new Request('https://guava.test/open-admin/api/bootstrap'))).status, 401);
  assert.equal((await bridge.handler(request('/api/settings', { method: 'PUT', headers: { origin: 'https://other.test' }, body: '{}' }))).status, 403);
  assert.equal((await bridge.handler(request('/api/settings', { method: 'PUT', headers: { origin: 'https://guava.test' }, body: '{"siteName":"Updated"}' }))).status, 200);
  const options = await bridge.handler(request('/api/bootstrap', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  assert.equal(await options.text(), '');
  assert.equal((await bridge.handler(request('/api/settings', { method: 'PUT', body: 'x'.repeat(1024 * 1024 + 1) }))).status, 413);
});

test('bridge errors do not return stack traces or private error details', async () => {
  const bridge = createNextBridge({ getKernel: async () => { throw new Error('private credential detail'); } });
  const response = await bridge.handler(new Request('https://guava.test/open-admin/api/bootstrap'));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private credential|Error:|\.js:/);
});

test('document navigation uses the host sign-in page while APIs retain a 401', async () => {
  const bridge = createNextBridge({ getKernel: async () => { throw new Error('must not boot'); }, isAdminRequest: async () => false, loginPath: '/admin/auth' });
  const response = await bridge.handler(new Request('https://guava.test/open-admin', { headers: { accept: 'text/html' } }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://guava.test/admin/auth?next=%2Fopen-admin');
  assert.equal((await bridge.handler(new Request('https://guava.test/open-admin/api/bootstrap'))).status, 401);
});
