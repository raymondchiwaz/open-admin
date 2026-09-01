'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');

function kernelWith(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-kernel-'));
  const plugins = fixture ? [fixture] : [];
  return new OpenAdminKernel({ dataDir: path.join(dir, 'data'), siteName: 'Test', plugins });
}

test('loads built-in plugins; home is Social Admin; disabled plugins stay off', async () => {
  const kernel = kernelWith();
  await kernel.init();
  const ids = kernel.plugins.list().map((p) => p.id);
  for (const id of ['core-dashboard', 'core-users', 'core-settings', 'core-plugins', 'social-admin']) {
    assert.ok(ids.includes(id), id + ' loaded');
  }
  assert.ok(ids.includes('shop-stats') && ids.includes('uptime-monitor'), 'demo plugins present');
  assert.equal(kernel.plugins.get('shop-stats').enabled, false, 'shop-stats off by default');
  assert.equal(kernel.plugins.homePath(), 'social', 'Social Admin is the home page');
  await kernel.close();
});

test('enable/disable lifecycle removes nav, routes and widgets; dependents block disable', async () => {
  const fixture = path.join(__dirname, 'fixtures', 'dependent-plugin');
  const kernel = kernelWith(fixture);
  await kernel.init();

  assert.ok(!kernel.plugins.nav().some((n) => n.path === 'dep'));
  await kernel.plugins.activate('dependent-plugin');       // pulls in core-dashboard
  assert.ok(kernel.plugins.get('core-dashboard').enabled, 'dependency auto-enabled');
  assert.ok(kernel.plugins.nav().some((n) => n.path === 'dep'));

  await assert.rejects(
    () => kernel.plugins.deactivate('core-dashboard'),
    /required by/, 'disabling a required plugin is refused'
  );

  await kernel.plugins.deactivate('dependent-plugin');
  assert.ok(!kernel.plugins.nav().some((n) => n.path === 'dep'));

  // plugin routes disappear on disable
  await kernel.plugins.deactivate('core-users');
  const before = kernel._pluginRoutes.length;
  await kernel.plugins.activate('core-users');
  assert.ok(kernel._pluginRoutes.length > before, 'users routes registered on activate');
  await kernel.plugins.deactivate('core-users');
  assert.equal(kernel._pluginRoutes.length, before, 'users routes revoked on deactivate');
  await kernel.close();
});

test('capabilities are revoked when a plugin is disabled', async () => {
  const kernel = kernelWith();
  await kernel.init();
  assert.ok(kernel.capabilities.has('social.post'));
  await kernel.plugins.deactivate('social-admin');
  assert.ok(!kernel.capabilities.has('social.post'), 'capability revoked');
  await kernel.plugins.activate('social-admin');
  assert.ok(kernel.capabilities.has('social.post'), 'capability restored');
  await kernel.close();
});
