'use strict';

/**
 * Activity Log — records every event on the bus into a capped ring buffer.
 *
 * `onAny` fires for every kernel + plugin event, so the log sees everything
 * (including events this plugin's own actions cause). The buffer is trimmed
 * every 100 inserts once it passes the 500 cap, keeping the newest 400.
 */

const MAX_EVENTS = 500;
const KEEP_AFTER_TRIM = 400;
const TRIM_EVERY = 100;

/** Payload → short JSON string (truncated at 300 chars, never throws). */
function stringify(payload) {
  let s;
  try { s = JSON.stringify(payload); } catch { s = String(payload); }
  if (typeof s !== 'string') s = '';
  return s.slice(0, 300);
}

function byAtDesc(a, b) {
  return String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

module.exports = {
  init(ctx) {
    const log = ctx.store.collection('events');
    let insertedCount = 0;

    unsubAny = ctx.events.onAny((type, payload, event) => {
      log.insert({
        type: String(type),
        payload: stringify(payload),
        at: (event && event.at) || new Date().toISOString(),
      });
      insertedCount++;
      if (insertedCount % TRIM_EVERY === 0) {
        const all = log.all();
        if (all.length > MAX_EVENTS) log.replaceAll(all.slice(-KEEP_AFTER_TRIM));
      }
    });

    ctx.capabilities.provide('activity-log.recent', (n) => {
      const k = Math.min(200, Math.max(1, Number(n) || 25));
      return [...log.all()].sort(byAtDesc).slice(0, k);
    }, ctx.pluginId);

    ctx.registerRoute('GET', '/api/activity-log', (req, res) => {
      const type = (req.searchParams.get('type') || '').trim();
      const limit = Math.min(500, Math.max(1, parseInt(req.searchParams.get('limit') || '50', 10) || 50));
      let items = log.all();
      if (type) items = items.filter((e) => e.type === type);
      ctx.json(res, 200, {
        events: [...items].sort(byAtDesc).slice(0, limit),
        total: log.all().length,
        type,
        limit,
      });
    });

    ctx.registerRoute('GET', '/api/activity-log/types', (req, res) => {
      const counts = new Map();
      for (const e of log.all()) counts.set(e.type, (counts.get(e.type) || 0) + 1);
      const types = [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
      ctx.json(res, 200, { types });
    });
  },

  destroy() {
    if (unsubAny) { unsubAny(); unsubAny = null; }
  },
};

let unsubAny = null;
