'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EventBus } = require('../src/core/event-bus');

test('emit delivers to typed subscribers and wildcard subscribers', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('deploy.finished', (p) => seen.push(['typed', p.id]));
  bus.onAny((type, p) => seen.push(['any', type]));
  bus.emit('deploy.finished', { id: 42 });
  assert.deepEqual(seen, [['typed', 42], ['any', 'deploy.finished']]);
});

test('off / unsubscribe works and errors do not break the bus', () => {
  const bus = new EventBus();
  let calls = 0;
  const off = bus.on('x', () => calls++);
  bus.emit('x', {});
  off();
  bus.emit('x', {});
  assert.equal(calls, 1);
  bus.on('boom', () => { throw new Error('kaboom'); });
  let after = 0;
  bus.on('boom', () => after++);
  bus.emit('boom', {});
  assert.equal(after, 1, 'second listener still ran after first threw');
});

test('recent() keeps a ring buffer, newest first', () => {
  const bus = new EventBus();
  for (let i = 0; i < 5; i++) bus.emit('tick', { i });
  const recent = bus.recent(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].payload.i, 4);
});
