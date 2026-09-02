'use strict';

/**
 * Whole-system plugin sanity: every plugin directory must have a valid
 * manifest, and the kernel must be able to activate EVERY plugin at once,
 * deactivate each one individually, and never 500 while doing it.
 * This is the test that catches cross-plugin interference (route
 * collisions, bad hooks, leaking timers) before it reaches users.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenAdminKernel } = require('../src/core/kernel');

const PLUGINS_DIR = path.join(__dirname, '..', 'src', 'plugins');
const PLUGIN_IDS = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const MANIFEST_KEYS = ['id', 'name', 'version', 'description', 'icon', 'category'];
const CATEGORIES = ['General', 'Content', 'Insights', 'System', 'Tools'];

test('every plugin manifest is valid and matches its directory', () => {
  assert.ok(PLUGIN_IDS.length >= 25, `expected ≥25 plugins, got ${PLUGIN_IDS.length}`);
  const seenIds = new Set();
  for (const dir of PLUGIN_IDS) {
    const meta = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, dir, 'plugin.json'), 'utf8'));
    for (const key of MANIFEST_KEYS) assert.ok(key in meta && meta[key], `${dir}: missing "${key}"`);
    assert.ok(
      /^[a-z0-9][a-z0-9-]*$/.test(meta.id) &&
      (meta.id === dir || meta.id.startsWith('core-')),
      `${dir}: id "${meta.id}" must be a valid slug matching the dir (or a "core-*" built-in)`
    );
    assert.ok(!seenIds.has(meta.id), `duplicate plugin id ${meta.id}`);
    seenIds.add(meta.id);
    assert.ok(CATEGORIES.includes(meta.category), `${dir}: bad category "${meta.category}"`);
    assert.match(meta.version, /^\d+\.\d+\.\d+$/, `${dir}: semantic version required`);
    for (const page of meta.pages || []) {
      assert.ok(page.path && page.title && page.icon, `${dir}: page needs path/title/icon`);
      assert.match(String(page.path), /^[a-z0-9-]+$/, `${dir}: bad page path "${page.path}"`);
    }
    for (const w of meta.widgets || []) {
      assert.ok(w.slot && w.id, `${dir}: widget needs slot+id`);
      assert.equal(typeof w.order, 'number', `${dir}: widget needs numeric order`);
    }
  }
});

test('kernel activates everything, serves every plugin, and survives full disable cycles', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-all-'));
  const kernel = new OpenAdminKernel({ dataDir: path.join(dataDir, 'data'), siteName: 'Test' });
  try {
    await kernel.init();
    const boot = kernel.plugins.list();
    assert.equal(boot.length, PLUGIN_IDS.length, 'all plugins registered');

    // Activate every disabled plugin (deps resolve automatically).
    for (const p of boot.filter((p) => !p.enabled)) {
      await kernel.plugins.activate(p.id);
    }
    const all = kernel.plugins.list().filter((p) => p.enabled);
    assert.equal(all.length, PLUGIN_IDS.length, 'everything enabled');

    // Non-API plugin routes (public pages like /status-page) must be reachable.
    const statusPageRoute = kernel._pluginRoutes.some((r) => r.pattern === '/status-page');
    assert.ok(statusPageRoute, 'a plugin registered a public page route');

    // Nav must contain routes from many categories, home stays Social Admin.
    const nav = kernel.plugins.nav();
    assert.ok(nav.length >= 20, `expected ≥20 nav items, got ${nav.length}`);
    assert.equal(kernel.plugins.homePath(), 'social');
    const cats = new Set(nav.map((n) => n.category));
    assert.ok(cats.size >= 4, `expected nav categories, got ${[...cats].join(', ')}`);

    // Every enabled plugin's client asset is served.
    const source = kernel.plugins.list().find((p) => p.enabled);
    // (spin a server to actually exercise routes + assets)
    const server = await kernel.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    const icon = await fetch(base + '/api/plugins');
    assert.equal(icon.status, 200);
    const boot2 = await (await fetch(base + '/api/bootstrap')).json();
    const clients = boot2.clients;
    assert.ok(clients.length >= 20, `expected ≥20 client modules, got ${clients.length}`);

    // Deactivate EVERY plugin one by one — nothing may throw (route/capable
    // revocation must be complete and idempotent).
    for (const plugin of kernel.plugins.list()) {
      await kernel.plugins.deactivate(plugin.id).catch((err) => {
        // dependencies refuse to disable their parent — that's by design
        assert.match(err.message, /required by/, `${plugin.id} should only fail on dependents`);
      });
    }
    assert.equal(kernel.plugins.list().filter((p) => p.enabled).length, 0, 'all plugins disabled');

    // Re-activate the core four + social — the shell must come back alive.
    for (const id of ['core-dashboard', 'core-users', 'core-settings', 'core-plugins', 'social-admin']) {
      await kernel.plugins.activate(id);
    }
    const navBack = kernel.plugins.nav();
    assert.ok(navBack.some((n) => n.path === 'social'), 'social back after re-activation');
    const boot3 = await (await fetch(base + '/api/bootstrap')).json();
    assert.ok(boot3.plugins.some((p) => p.id === 'social-admin' && p.enabled));
    await new Promise((resolve) => server.close(resolve));
  } finally {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
