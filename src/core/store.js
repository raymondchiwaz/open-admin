'use strict';

/**
 * Tiny persistent store. Each "collection" is a JSON file inside the data
 * directory, kept in memory and written back (debounced). Zero dependencies,
 * zero database — good enough for an admin panel, swap it out if you outgrow it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Collection {
  constructor(store, name) {
    this._store = store;
    this.name = name;
    this.data = store._load(name);
  }

  all() { return this.data; }

  find(fn) { return this.data.filter(fn); }

  get(id) { return this.data.find((d) => d.id === id) || null; }

  insert(doc) {
    if (!doc.id) doc.id = crypto.randomUUID();
    if (!doc.createdAt) doc.createdAt = new Date().toISOString();
    this.data.push(doc);
    this._store._save(this.name);
    return doc;
  }

  update(id, patch) {
    const doc = this.get(id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    this._store._save(this.name);
    return doc;
  }

  remove(id) {
    const i = this.data.findIndex((d) => d.id === id);
    if (i < 0) return false;
    this.data.splice(i, 1);
    this._store._save(this.name);
    return true;
  }

  replaceAll(arr) {
    this.data = arr;
    this._store._save(this.name);
  }
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this._collections = new Map();
    this._kv = null;
    this._timers = new Map();
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  _file(name) { return path.join(this.dataDir, name + '.json'); }

  _load(name) {
    try {
      return JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    } catch {
      return [];
    }
  }

  _save(name) {
    clearTimeout(this._timers.get(name));
    this._timers.set(name, setTimeout(() => this._flush(name), 60));
  }

  _flush(name) {
    clearTimeout(this._timers.get(name));
    this._timers.delete(name);
    const col = this._collections.get(name);
    try {
      const tmp = this._file(name) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(col.data, null, 2));
      fs.renameSync(tmp, this._file(name));
    } catch (err) {
      console.error('[open-admin] failed to persist collection "' + name + '":', err.message);
    }
  }

  collection(name) {
    if (!this._collections.has(name)) this._collections.set(name, new Collection(this, name));
    return this._collections.get(name);
  }

  collectionNames() { return [...this._collections.keys()]; }

  // Simple key/value store (settings, plugin state).
  _loadKv() {
    if (this._kv) return this._kv;
    try {
      this._kv = JSON.parse(fs.readFileSync(this._file('kv'), 'utf8'));
    } catch {
      this._kv = {};
    }
    return this._kv;
  }

  kvGet(key, fallback) {
    const kv = this._loadKv();
    return key in kv ? kv[key] : fallback;
  }

  /** Snapshot of the whole kv store (admin-privileged introspection). */
  kvAll() { return { ...this._loadKv() }; }

  kvSet(key, value) {
    const kv = this._loadKv();
    kv[key] = value;
    clearTimeout(this._timers.get('__kv'));
    this._timers.set('__kv', setTimeout(() => {
      try {
        const tmp = this._file('kv') + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(kv, null, 2));
        fs.renameSync(tmp, this._file('kv'));
      } catch (err) {
        console.error('[open-admin] failed to persist kv store:', err.message);
      }
    }, 60));
  }

  flushAll() {
    for (const name of this._collections.keys()) this._flush(name);
    this._flushKvNow();
  }

  _flushKvNow() {
    clearTimeout(this._timers.get('__kv'));
    this._timers.delete('__kv');
    if (!this._kv) return;
    try {
      const tmp = this._file('kv') + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._kv, null, 2));
      fs.renameSync(tmp, this._file('kv'));
    } catch { /* best effort on shutdown */ }
  }
}

module.exports = { Store };
