'use strict';

/**
 * Update registry. Plugins report their installed version via plugin.json;
 * this module knows the latest published version (in a real deployment you'd
 * fetch this from a registry URL — pluggable via the `updates.source`
 * capability). Social Admin renders the result as its "Updates" feed.
 */

const REGISTRY = {
  'core-dashboard': { latest: '1.1.0', notes: 'Faster widget loading and a new activity chart.' },
  'core-users': { latest: '2.1.0', notes: 'Bulk role editing and CSV export.' },
  'core-plugins': { latest: '1.0.1', notes: 'Small fixes to the dependency checker.' },
  'core-settings': { latest: '1.0.0', notes: '' },
  'social-admin': { latest: '1.3.0', notes: 'Polls, story rings, and richer feedback filters.' },
  'shop-stats': { latest: '0.3.0', notes: 'Revenue by channel breakdown.' },
  'uptime-monitor': { latest: '0.9.2', notes: 'Adds response-time percentiles.' },
};

class Updates {
  constructor(kernel) {
    this.kernel = kernel;
  }

  /** Manually installed (updated) versions override manifest versions. */
  installed() {
    const overrides = this.kernel.store.kvGet('installedVersions', {});
    const installed = {};
    for (const { id, version } of this.kernel.plugins.manifests()) {
      installed[id] = version;
    }
    return { ...installed, ...overrides };
  }

  checkAll() {
    const installed = this.installed();
    const out = [];
    for (const info of this.kernel.plugins.list()) {
      const entry = REGISTRY[info.id];
      const current = installed[info.id] || info.version;
      const latest = entry ? entry.latest : info.version;
      out.push({
        id: info.id,
        name: info.name,
        icon: info.icon,
        current,
        latest,
        hasUpdate: entry ? this._compare(latest, current) > 0 : false,
        notes: entry ? entry.notes : '',
      });
    }
    out.sort((a, b) => Number(b.hasUpdate) - Number(a.hasUpdate) || a.name.localeCompare(b.name));
    return out;
  }

  /** Apply an update: record the new version and tell everyone. */
  apply(id) {
    const entry = REGISTRY[id];
    const info = this.kernel.plugins.get(id);
    if (!info) {
      const err = new Error(`unknown plugin "${id}"`);
      err.status = 404;
      throw err;
    }
    const latest = entry ? entry.latest : info.meta.version;
    const installed = this.kernel.store.kvGet('installedVersions', {});
    if (this._compare(installed[id] || info.meta.version, latest) >= 0) {
      const err = new Error(`"${id}" is already up to date`);
      err.status = 409;
      throw err;
    }
    installed[id] = latest;
    this.kernel.store.kvSet('installedVersions', installed);
    this.kernel.bus.emit('update.installed', {
      pluginId: id, name: info.meta.name, icon: info.meta.icon, version: latest,
    });
    return { id, version: latest };
  }

  /** Have we already announced this update? (avoid duplicate posts on reboot) */
  announced(id, version) {
    const posted = this.kernel.store.kvGet('announcedUpdates', []);
    return posted.includes(`${id}@${version}`);
  }

  markAnnounced(id, version) {
    const posted = this.kernel.store.kvGet('announcedUpdates', []);
    posted.push(`${id}@${version}`);
    this.kernel.store.kvSet('announcedUpdates', posted);
  }

  /** semver-ish comparison, good enough for x.y.z */
  _compare(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }
}

module.exports = { Updates, REGISTRY };
