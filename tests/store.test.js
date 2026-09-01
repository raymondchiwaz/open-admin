'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core/store');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oa-test-'));
}

test('collections CRUD with auto id/createdAt and persistence', async () => {
  const dir = tmp();
  const store = new Store(dir);
  const col = store.collection('things');
  const doc = col.insert({ name: 'a' });
  assert.ok(doc.id, 'id assigned');
  assert.ok(doc.createdAt, 'createdAt assigned');
  col.update(doc.id, { name: 'b' });
  col.insert({ name: 'c' });
  store.flushAll();

  // fresh instance reads the same data
  const store2 = new Store(dir);
  assert.equal(store2.collection('things').get(doc.id).name, 'b');
  assert.equal(store2.collection('things').all().length, 2);
  assert.equal(store2.collection('things').remove(doc.id), true);
  store2.flushAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kv get/set with fallback and persistence', async () => {
  const dir = tmp();
  const store = new Store(dir);
  assert.equal(store.kvGet('nope', 'fallback'), 'fallback');
  store.kvSet('theme', 'dark');
  store.flushAll();
  assert.equal(new Store(dir).kvGet('theme', 'light'), 'dark');
  fs.rmSync(dir, { recursive: true, force: true });
});
