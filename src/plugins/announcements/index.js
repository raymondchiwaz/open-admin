'use strict';

/**
 * Announcements — a live banner for the whole admin, with history.
 *
 *   GET    /api/announcements/current    the current banner (or null)
 *   POST   /api/announcements            { text, level:'info'|'warn'|'critical' }
 *                                        (previous banner moves to history first)
 *   POST   /api/announcements/clear      clear the current banner
 *   GET    /api/announcements/history    past announcements, newest first
 *
 * `announcements.changed` carries the current banner (or null) so open
 * browsers update their banner live over SSE. Publishing also posts to the
 * Social feed via `activity`.
 */

const crypto = require('crypto');

const LEVELS = ['info', 'warn', 'critical'];

function seed(ctx, history) {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600000).toISOString();
  history.replaceAll([
    { id: crypto.randomUUID(), text: 'Welcome to Open Admin — everything on this panel is a plugin.', level: 'info', createdAt: ago(90), clearedAt: ago(80) },
    { id: crypto.randomUUID(), text: 'Scheduled maintenance Sunday 02:00 UTC.', level: 'warn', createdAt: ago(30), clearedAt: ago(20) },
  ]);
  ctx.store.setState('current', { text: 'Welcome to Open Admin — explore the General plugins below.', level: 'info', at: ago(10) });
}

module.exports = {
  init(ctx) {
    const history = ctx.store.collection('history');

    if (!ctx.store.getState('seeded')) {
      seed(ctx, history);
      ctx.store.setState('seeded', true);
    }

    function current() {
      return ctx.store.getState('current', null);
    }

    function historyList() {
      return [...history.all()].sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    ctx.registerRoute('GET', '/api/announcements/current', (req, res) => {
      ctx.json(res, 200, { current: current() });
    });

    ctx.registerRoute('GET', '/api/announcements/history', (req, res) => {
      ctx.json(res, 200, { history: historyList() });
    });

    ctx.registerRoute('POST', '/api/announcements', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const text = String(body.text || '').trim().slice(0, 240);
      if (!text) return ctx.json(res, 400, { error: 'text is required' });
      const level = LEVELS.includes(body.level) ? body.level : 'info';

      // Push the previous banner into history before replacing it.
      const prev = current();
      if (prev) {
        history.insert({
          id: crypto.randomUUID(),
          text: prev.text,
          level: prev.level || 'info',
          createdAt: prev.at || prev.createdAt || new Date().toISOString(),
          clearedAt: new Date().toISOString(),
        });
      }

      const banner = { text, level, at: new Date().toISOString() };
      ctx.store.setState('current', banner);
      ctx.activity({
        text: `📣 Announcement: **${banner.text}**`,
        icon: '📣',
        level: level === 'critical' ? 'error' : level,
        tags: ['announcements'],
      });
      ctx.notify('announcements.changed', banner);
      ctx.json(res, 201, { current: banner });
    });

    ctx.registerRoute('POST', '/api/announcements/clear', (req, res) => {
      const prev = current();
      if (prev) {
        history.insert({
          id: crypto.randomUUID(),
          text: prev.text,
          level: prev.level || 'info',
          createdAt: prev.at || prev.createdAt || new Date().toISOString(),
          clearedAt: new Date().toISOString(),
        });
        ctx.store.setState('current', null);
        ctx.notify('announcements.changed', null);
      }
      ctx.json(res, 200, { current: current() });
    });
  },
};
