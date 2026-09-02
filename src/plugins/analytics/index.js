'use strict';

/**
 * Analytics — zero-dependency event tracking.
 *
 * Events live in a collection of [{ name, day 'YYYY-MM-DD', count }] rows,
 * upserted per name+day. The kernel ships 14 days of plausible history so the
 * chart feels alive; every track() writes straight to that same collection.
 */

const crypto = require('crypto');

const DAYS = 14;

/** Local calendar day as 'YYYY-MM-DD', `offset` days from today (0 = today). */
function dayStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Deterministic, plausible 14-day seed (pageview / signup / checkout).
 *  Rows get real ids — store.update() matches by id, and a missing id makes
 *  every mutation target the wrong (first id-less) row. */
function seedEvents(collection) {
  const rows = [];
  for (let i = 0; i < DAYS; i++) {
    const off = i - (DAYS - 1); // first row is the oldest day
    const wave = Math.sin((i / DAYS) * Math.PI * 2);
    const wave2 = Math.sin((i / DAYS) * Math.PI * 2 + 1.3);
    rows.push(
      { id: crypto.randomUUID(), name: 'pageview', day: dayStr(off), count: Math.round(420 + wave * 130 + (i % 3) * 40) },
      { id: crypto.randomUUID(), name: 'signup', day: dayStr(off), count: Math.round(18 + wave2 * 8 + (i % 4) * 3) },
      { id: crypto.randomUUID(), name: 'checkout', day: dayStr(off), count: Math.round(9 + wave2 * 4 + (i % 2) * 4) },
    );
  }
  collection.replaceAll(rows);
}

module.exports = {
  init(ctx) {
    const events = ctx.store.collection('events');
    if (events.all().length === 0) seedEvents(events);

    /** Upsert one event row and broadcast it to any live client counters. */
    function track(name) {
      const clean = String(name || '').trim().slice(0, 80) || 'pageview';
      const day = dayStr(0);
      const existing = events.find((e) => e.name === clean && e.day === day)[0];
      const entry = existing
        ? events.update(existing.id, { count: existing.count + 1 })
        : events.insert({ name: clean, day, count: 1 });
      ctx.notify('analytics.tracked', { name: clean, day, count: entry.count });
      return entry;
    }

    ctx.capabilities.provide('analytics.track', (name) => track(name), ctx.pluginId);

    ctx.registerRoute('GET', '/api/analytics/summary', (req, res) => {
      const all = events.all();
      const byDay = new Map();
      const byName = new Map();
      for (const e of all) {
        byDay.set(e.day, (byDay.get(e.day) || 0) + e.count);
        byName.set(e.name, (byName.get(e.name) || 0) + e.count);
      }
      const days = [];
      for (let off = -(DAYS - 1); off <= 0; off++) {
        const d = dayStr(off);
        days.push({ day: d, total: byDay.get(d) || 0 });
      }
      const top = [...byName.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 6);
      const t = dayStr(0);
      ctx.json(res, 200, {
        days,
        top,
        today: { day: t, total: byDay.get(t) || 0 },
        totalEvents: all.length,
      });
    });

    ctx.registerRoute('POST', '/api/analytics/track', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const entry = track(body.name);
      ctx.json(res, 200, { ok: true, name: entry.name, day: entry.day, count: entry.count });
    });

    // Anything posted into the Social feed is an "activity" event too.
    unsubActivity = ctx.events.on('activity', () => track('activity'));
  },

  destroy() {
    if (unsubActivity) { unsubActivity(); unsubActivity = null; }
  },
};

let unsubActivity = null;
