'use strict';

/**
 * PluginManager — loads plugins from disk, resolves dependencies, and drives
 * their lifecycle. Every part of Open Admin's UI (dashboard, users, settings,
 * even the plugin manager itself) is a plugin using this exact same mechanism.
 *
 * A plugin is a directory containing:
 *   plugin.json   manifest (id, name, version, pages, widgets, requires…)
 *   index.js      optional server side:  exports { init(ctx), destroy(ctx) }
 *   client.js     optional browser side: export default { pages, widgets }
 */

const fs = require('fs');
const path = require('path');

function readManifest(dir) {
  const file = path.join(dir, 'plugin.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!meta.id || !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) {
    throw new Error(`plugin at ${dir} has an invalid or missing id`);
  }
  meta.dir = dir;
  meta.pages = meta.pages || [];
  meta.widgets = meta.widgets || [];
  meta.requires = meta.requires || [];
  meta.provides = meta.provides || [];
  return meta;
}

class PluginManager {
  constructor(kernel) {
    this.kernel = kernel;
    /** id -> { meta, serverModule, enabled, ctx } */
    this._plugins = new Map();
  }

  /** Register a plugin directory (does not activate it yet). */
  loadDir(dir) {
    const meta = readManifest(dir);
    if (this._plugins.has(meta.id)) {
      throw new Error(`duplicate plugin id "${meta.id}" (${dir})`);
    }
    // Server modules may be injected by the host via `options.serverModules`
    // so the kernel never issues a dynamic require() (which cannot be bundled
    // for edge runtimes). Fall back to require() on plain Node hosts.
    const injected = (this.kernel.options.serverModules || {})[meta.id];
    let serverModule = injected !== undefined ? injected : null;
    if (serverModule === null) {
      const entry = path.join(dir, 'index.js');
      if (fs.existsSync(entry)) serverModule = require(entry);
    }
    this._plugins.set(meta.id, { meta, serverModule, enabled: false, ctx: null, hasClient: undefined });
    return meta;
  }

  /**
   * Register a plugin from an injected definition (no filesystem). Used on
   * runtimes without a filesystem (edge workers) and by hosts that bundle
   * their own admin pipelines: `index.js`/`plugin.json` are passed in by the
   * host instead of read from disk.
   * `def` = { id, meta, serverModule, hasClient, dir }.
   */
  loadDefinition(def) {
    const meta = def.meta || {};
    meta.id = meta.id || def.id;
    meta.dir = def.dir || null;
    meta.pages = meta.pages || [];
    meta.widgets = meta.widgets || [];
    meta.requires = meta.requires || [];
    meta.provides = meta.provides || [];
    if (!meta.id || !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) {
      throw new Error('plugin definition has an invalid or missing id');
    }
    if (this._plugins.has(meta.id)) {
      throw new Error(`duplicate plugin id "${meta.id}"`);
    }
    this._plugins.set(meta.id, {
      meta,
      serverModule: def.serverModule || null,
      enabled: false,
      ctx: null,
      hasClient: Boolean(def.hasClient),
    });
    return meta;
  }

  /** Activate every plugin that isn't explicitly disabled in the kv store. */
  async activateAll() {
    const state = this.kernel.store.kvGet('pluginState', {});
    for (const id of this._plugins.keys()) {
      const record = this._plugins.get(id);
      const enabled = id in state ? state[id] : !record.meta.defaultDisabled;
      if (enabled) await this.activate(id, { silent: true });
    }
  }

  async activate(id, { silent = false } = {}) {
    const record = this._require(id);
    if (record.enabled) return;
    // Activate dependencies first (only ones we actually know about).
    for (const dep of record.meta.requires || []) {
      if (this._plugins.has(dep)) await this.activate(dep);
    }
    record.ctx = this.kernel.createPluginContext(record.meta);
    try {
      if (record.serverModule && record.serverModule.init) {
        await record.serverModule.init(record.ctx);
      }
    } catch (err) {
      this.kernel._revokePlugin(id);
      record.ctx = null;
      throw new Error(`plugin "${id}" failed to start: ${err.message}`);
    }
    record.enabled = true;
    this._persist();
    if (!silent) {
      this.kernel.bus.emit('plugin.enabled', { id, name: record.meta.name, icon: record.meta.icon });
    }
  }

  async deactivate(id, { silent = false } = {}) {
    const record = this._require(id);
    if (!record.enabled) return;
    const dependents = this.dependents(id);
    if (dependents.length > 0) {
      const names = dependents.map((d) => `"${d}"`).join(', ');
      const err = new Error(`cannot disable "${id}" — required by ${names}. Disable ${names} first.`);
      err.status = 409;
      throw err;
    }
    record.enabled = false;
    try {
      if (record.serverModule && record.serverModule.destroy) {
        await record.serverModule.destroy(record.ctx);
      }
    } catch (err) {
      console.error(`[open-admin] error during destroy of "${id}":`, err.message);
    }
    this.kernel._revokePlugin(id);
    record.ctx = null;
    this._persist();
    if (!silent) {
      this.kernel.bus.emit('plugin.disabled', { id, name: record.meta.name, icon: record.meta.icon });
    }
  }

  /** Plugins that declare `requires: [id]` and are currently enabled. */
  dependents(id) {
    const out = [];
    for (const [otherId, rec] of this._plugins) {
      if (otherId !== id && rec.enabled && (rec.meta.requires || []).includes(id)) out.push(otherId);
    }
    return out;
  }

  list() {
    return [...this._plugins.values()]
      .map(({ meta, enabled }) => ({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        installedVersion: meta.version,
        description: meta.description || '',
        author: meta.author || '',
        icon: meta.icon || '🧩',
        category: meta.category || 'General',
        pages: meta.pages.length,
        requires: meta.requires || [],
        provides: meta.provides || [],
        enabled,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Raw manifest versions (no update-override logic — used by Updates). */
  manifests() {
    return [...this._plugins.values()].map(({ meta }) => ({ id: meta.id, version: meta.version }));
  }

  get(id) {
    const record = this._plugins.get(id);
    return record ? { meta: record.meta, enabled: record.enabled } : null;
  }

  /** Sidebar navigation entries contributed by enabled plugins. */
  nav() {
    const items = [];
    for (const { meta, enabled } of this._plugins.values()) {
      if (!enabled) continue;
      for (const page of meta.pages) {
        items.push({ ...page, pluginId: meta.id, pluginIcon: meta.icon, category: meta.category || 'General' });
      }
    }
    items.sort((a, b) => (a.order || 0) - (b.order || 0) || a.path.localeCompare(b.path));
    return items;
  }

  /** The page to show when no route is selected (lowest-ordered `home` page). */
  homePath() {
    const home = this.nav().find((p) => p.home);
    return home ? home.path : (this.nav()[0] || { path: 'dashboard' }).path;
  }

  /** Widget contributions for a slot, from enabled plugins. */
  widgetsForSlot(slot) {
    const out = [];
    for (const { meta, enabled } of this._plugins.values()) {
      if (!enabled) continue;
      for (const widget of meta.widgets) {
        if (widget.slot === slot) out.push({ ...widget, pluginId: meta.id });
      }
    }
    out.sort((a, b) => (a.order || 0) - (b.order || 0));
    return out;
  }

  /** Every widget contribution, grouped by slot (for the client bootstrap). */
  widgetsMap() {
    const map = {};
    for (const { meta, enabled } of this._plugins.values()) {
      if (!enabled) continue;
      for (const widget of meta.widgets) {
        (map[widget.slot] = map[widget.slot] || []).push({ ...widget, pluginId: meta.id });
      }
    }
    for (const list of Object.values(map)) list.sort((a, b) => (a.order || 0) - (b.order || 0));
    return map;
  }

  /** Directory of an enabled plugin, for serving its client.js and assets. */
  dirOf(id) {
    const record = this._plugins.get(id);
    return record ? record.meta.dir : null;
  }

  clientEntryIds() {
    const fsEntries = [];
    for (const [id, record] of this._plugins) {
      const hasClient = record.hasClient !== undefined
        ? record.hasClient
        : (record.meta.dir ? fs.existsSync(path.join(record.meta.dir, 'client.js')) : false);
      if (record.enabled && hasClient) fsEntries.push(id);
    }
    return fsEntries;
  }

  _persist() {
    const state = {};
    for (const [id, record] of this._plugins) state[id] = record.enabled;
    this.kernel.store.kvSet('pluginState', state);
  }

  _require(id) {
    const record = this._plugins.get(id);
    if (!record) {
      const err = new Error(`unknown plugin "${id}"`);
      err.status = 404;
      throw err;
    }
    return record;
  }
}

module.exports = { PluginManager, readManifest };
