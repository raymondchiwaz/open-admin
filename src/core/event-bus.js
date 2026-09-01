'use strict';

/**
 * Global event bus. Plugins talk to each other through it — the kernel and
 * every plugin emit events, and any plugin can subscribe. Events are also
 * forwarded to connected browsers over SSE.
 */
class EventBus {
  constructor() {
    this._subs = new Map();      // type -> Set<fn>
    this._anySubs = new Set();   // fn(type, payload)
    this._ring = [];             // recent events for the activity feed
    this._ringMax = 100;
  }

  on(type, fn) {
    if (!this._subs.has(type)) this._subs.set(type, new Set());
    this._subs.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this._subs.get(type);
    if (set) set.delete(fn);
  }

  onAny(fn) {
    this._anySubs.add(fn);
    return () => this._anySubs.delete(fn);
  }

  emit(type, payload = {}) {
    const event = { type, payload, at: new Date().toISOString() };
    this._ring.push(event);
    if (this._ring.length > this._ringMax) this._ring.shift();

    const set = this._subs.get(type);
    if (set) for (const fn of [...set]) {
      try { fn(payload, event); } catch (err) {
        console.error('[open-admin] event handler error for "' + type + '":', err.message);
      }
    }
    for (const fn of [...this._anySubs]) {
      try { fn(type, payload, event); } catch (err) {
        console.error('[open-admin] event handler error (onAny):', err.message);
      }
    }
    return event;
  }

  recent(limit = 50) { return this._ring.slice(-limit).reverse(); }
}

module.exports = { EventBus };
