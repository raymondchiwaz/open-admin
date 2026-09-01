'use strict';

/**
 * Capability registry — how plugins stay compatible with each other.
 *
 * A plugin can *provide* a capability (e.g. Social Admin provides
 * "social.post") and any other plugin can *use* it. Plugins declare what they
 * provide/require in plugin.json; the PluginManager enables dependencies
 * automatically and refuses to disable plugins that others depend on.
 */
class Capabilities {
  constructor() {
    this._caps = new Map(); // name -> { fn, pluginId }
  }

  provide(name, fn, pluginId) {
    const existing = this._caps.get(name);
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(`Capability "${name}" is already provided by plugin "${existing.pluginId}"`);
    }
    this._caps.set(name, { fn, pluginId });
    if (!existing) console.log(`[open-admin] capability registered: ${name} (by ${pluginId})`);
  }

  revoke(pluginId) {
    for (const [name, cap] of [...this._caps]) {
      if (cap.pluginId === pluginId) this._caps.delete(name);
    }
  }

  has(name) { return this._caps.has(name); }

  use(name) {
    const cap = this._caps.get(name);
    return cap ? cap.fn : undefined;
  }

  list() {
    return [...this._caps.entries()].map(([name, cap]) => ({ name, pluginId: cap.pluginId }));
  }
}

module.exports = { Capabilities };
