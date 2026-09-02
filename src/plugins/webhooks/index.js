'use strict';

/**
 * Webhooks — forward internal bus events to HTTP endpoints.
 *
 * Every event the kernel (or any plugin) emits is checked against each active
 * hook. Matching events are POSTed as JSON ({event, payload, at}) with an
 * `X-OA-Signature` header holding the HMAC-SHA256 of the raw body.
 *
 * Reliability notes:
 *   - Fetches run with a 3s AbortController timeout and every failure is
 *     counted, never thrown — a down endpoint can't take the panel down.
 *   - Delivery records live in a ring buffer (cap 100).
 *   - Events this plugin itself emits (`webhooks.*`) are never re-forwarded,
 *     so there is no delivery feedback loop.
 */

const crypto = require('crypto');

const DELIVERIES_CAP = 100;
const FETCH_TIMEOUT_MS = 3000;
// 'webhook.' covers the spec'd prefix; 'webhooks.' covers this plugin's own
// namespace (webhooks.delivered, …) so deliveries never trigger deliveries.
const SELF_PREFIXES = ['webhook.', 'webhooks.'];

const URL_RE = /^https?:\/\/.+/i;

/** Validate a URL string: must be absolute http(s), else '' (falsy). */
function cleanUrl(raw) {
  const url = String(raw || '').trim();
  if (!URL_RE.test(url)) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/** Normalize a comma-separated / array event list; ['*'] when empty. */
function normalizeEvents(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',').map((s) => s.trim());
  const clean = [...new Set(list.filter(Boolean))].slice(0, 50);
  return clean.length ? clean : ['*'];
}

function hmacSha256Hex(secret, body) {
  return crypto.createHmac('sha256', String(secret)).update(body, 'utf8').digest('hex');
}

function publicHook(hook) {
  return {
    id: hook.id,
    url: hook.url,
    events: hook.events,
    active: !!hook.active,
    createdAt: hook.createdAt,
    stats: hook.stats || { delivered: 0, failed: 0, lastAt: null, lastStatus: null },
  };
}

module.exports = {
  init(ctx) {
    const hooks = ctx.store.collection('hooks');
    const deliveries = ctx.store.collection('deliveries');

    /** Insert a delivery, keeping the ring buffer at DELIVERIES_CAP. */
    function recordDelivery(doc) {
      deliveries.insert(doc);
      if (deliveries.all().length > DELIVERIES_CAP) {
        deliveries.replaceAll(deliveries.all().slice(-DELIVERIES_CAP));
      }
    }

    /** POST one event to one hook. Never throws; failures are recorded. */
    async function deliver(hook, type, payload, at) {
      const body = JSON.stringify({ event: type, payload, at });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const started = Date.now();
      let status;
      let ok;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-OA-Signature': hmacSha256Hex(hook.secret, body),
          },
          body,
          signal: controller.signal,
        });
        status = res.status;
        ok = res.ok;
      } catch {
        status = 0; // network error / timeout
        ok = false;
      } finally {
        clearTimeout(timer);
      }
      const ms = Date.now() - started;
      const statusStr = ok ? String(status) : String(status || 'timeout');
      const stats = {
        delivered: (hook.stats?.delivered || 0) + (ok ? 1 : 0),
        failed: (hook.stats?.failed || 0) + (ok ? 0 : 1),
        lastAt: new Date().toISOString(),
        lastStatus: statusStr,
      };
      const updated = hooks.update(hook.id, { stats });
      const delivery = {
        id: crypto.randomUUID(),
        hookId: hook.id,
        event: type,
        ok,
        status,
        ms,
        at: new Date().toISOString(),
      };
      recordDelivery(delivery);
      ctx.notify('webhooks.delivered', { delivery: { ...delivery, hookUrl: hook.url } });
      return { delivery, hookStats: updated ? updated.stats : stats };
    }

    /** Fan an event out to every active matching hook (fire-and-forget). */
    function fanOut(type, payload, at) {
      if (SELF_PREFIXES.some((p) => type.startsWith(p))) return;
      for (const hook of hooks.all()) {
        if (!hook.active) continue;
        const match = hook.events.includes('*') || hook.events.includes(type);
        if (!match) continue;
        deliver(hook, type, payload, at).catch(() => {
          // deliver() already records failures; this is a last-resort guard.
          try {
            hooks.update(hook.id, { stats: {
              delivered: hook.stats?.delivered || 0,
              failed: (hook.stats?.failed || 0) + 1,
              lastAt: new Date().toISOString(),
              lastStatus: 'timeout',
            } });
          } catch { /* noop */ }
        });
      }
    }

    ctx.events.onAny((type, payload, event) => fanOut(type, payload, event && event.at));

    // ── Routes ──────────────────────────────────────────────────────────────

    ctx.registerRoute('GET', '/api/webhooks', (req, res) => {
      const urlOf = (hookId) => hooks.get(hookId)?.url || hookId;
      const recent = [...deliveries.all()]
        .slice(-20)
        .reverse()
        .map((d) => ({ ...d, hookUrl: urlOf(d.hookId) }));
      ctx.json(res, 200, {
        hooks: hooks.all().map(publicHook),
        deliveries: recent,
      });
    });

    ctx.registerRoute('POST', '/api/webhooks', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const url = cleanUrl(body.url);
      if (!url) return ctx.json(res, 400, { error: 'a valid http(s) URL is required' });
      const secret = String(body.secret || '').trim() || crypto.randomBytes(18).toString('base64url');
      const hook = hooks.insert({
        url,
        events: normalizeEvents(body.events),
        secret,
        active: true,
        stats: { delivered: 0, failed: 0, lastAt: null, lastStatus: null },
      });
      ctx.activity({ text: `🪝 Webhook **${hook.url}** was registered`, icon: '🪝', level: 'info', tags: ['webhooks'] });
      ctx.json(res, 201, { hook: publicHook(hook) });
    });

    ctx.registerRoute('PATCH', '/api/webhooks/:id', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      if (typeof body.active !== 'boolean' && body.active !== undefined) {
        return ctx.json(res, 400, { error: 'active must be a boolean' });
      }
      const patch = {};
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (body.url) {
        const url = cleanUrl(body.url);
        if (!url) return ctx.json(res, 400, { error: 'a valid http(s) URL is required' });
        patch.url = url;
      }
      if (body.events) patch.events = normalizeEvents(body.events);
      if (Object.keys(patch).length === 0) return ctx.json(res, 400, { error: 'nothing to update' });
      const hook = hooks.update(params.id, patch);
      if (!hook) return ctx.json(res, 404, { error: 'hook not found' });
      ctx.json(res, 200, { hook: publicHook(hook) });
    });

    ctx.registerRoute('DELETE', '/api/webhooks/:id', (req, res, params) => {
      const removed = hooks.remove(params.id);
      if (removed) {
        const kept = deliveries.all().filter((d) => d.hookId !== params.id);
        deliveries.replaceAll(kept);
      }
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });

    ctx.registerRoute('POST', '/api/webhooks/:id/test', async (req, res, params) => {
      const hook = hooks.get(params.id);
      if (!hook) return ctx.json(res, 404, { error: 'hook not found' });
      const result = await deliver(hook, 'webhook.test', { notice: 'test payload' }, new Date().toISOString());
      ctx.json(res, 200, result);
    });
  },
};
