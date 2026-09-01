'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { Capabilities } = require('../src/core/capabilities');

test('provide/use roundtrip and revoke by plugin', () => {
  const caps = new Capabilities();
  caps.provide('social.post', () => 'posted-by-social', 'social-admin');
  caps.provide('shop.metrics', () => 'shop-data', 'shop-stats');
  assert.equal(caps.use('social.post')(), 'posted-by-social');
  caps.revoke('social-admin');
  assert.equal(caps.has('social.post'), false);
  assert.equal(caps.has('shop.metrics'), true);
});

test('duplicate capability from a different plugin is rejected', () => {
  const caps = new Capabilities();
  caps.provide('social.post', () => {}, 'social-admin');
  assert.throws(() => caps.provide('social.post', () => {}, 'other'), /already provided/);
  // same plugin re-providing is fine (idempotent init)
  caps.provide('social.post', () => 'v2', 'social-admin');
  assert.equal(caps.use('social.post')(), 'v2');
});
