'use strict';

/**
 * Health Checks — monitor HTTP endpoints the plugin-first way.
 *
 * Each check runs on its own ctx.every() interval (kept in a Map so timers can
 * be created/stopped as checks are added/deleted, and cleared automatically
 * when the plugin is disabled). Results are recorded per check, trimmed to the
 * last MAX_RESULTS runs, and every result is broadcast so the admin UI stays
 * live. Down/recovery transitions land in the Social feed via ctx.activity().
 *
 * Capability: `health.snapshot` → [{ name, level: 'ok'|'error', ms, at, rate }]
 * Event:       `health-checks.updated` (per result / create / delete)
 */

const MAX_RESULTS = 40;   // history kept per check
const RUN_TIMEOUT_MS = 5000;

function iso() { return new Date().toISOString(); }

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/** Newest result for a check (no sort copy: single pass). */
function latestFor(results, checkId) {
  let latest = null;
  for (const r of results) {
    if (r.checkId === checkId && (!latest || r.at > latest.at)) latest = r;
  }
  return latest;
}

/** The last `n` results for a check, oldest → newest. */
function recentFor(results, checkId, n) {
  return results
    .filter((r) => r.checkId === checkId)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-n);
}

module.exports = {
  init(ctx) {
    const checks = ctx.store.collection('checks');
    const results = ctx.store.collection('results');
    const timers = new Map();  // checkId -> interval handle (ctx.every)
    const lastOk = new Map();  // checkId -> boolean | undefined (transition state)

    const latest = (checkId) => latestFor(results.all(), checkId);
    /** 0-100 success rate across the last 20 runs (100 when no runs yet). */
    const rate = (checkId) => {
      const runs = recentFor(results.all(), checkId, 20);
      if (!runs.length) return 100;
      return Math.round((runs.filter((r) => r.ok).length / runs.length) * 100);
    };

    /** Persist one result, trim history, fire transitions + broadcast. */
    function record(check, entry) {
      const result = results.insert({
        checkId: check.id,
        name: check.name,
        ok: entry.ok,
        ms: entry.ms,
        status: entry.status,
        at: entry.at,
        error: entry.error || null,
      });

      const mine = results.all().filter((r) => r.checkId === check.id);
      if (mine.length > MAX_RESULTS) {
        for (const old of mine.slice(0, mine.length - MAX_RESULTS)) results.remove(old.id);
      }

      const prev = lastOk.get(check.id);
      lastOk.set(check.id, entry.ok);
      if (entry.ok && prev === false) {
        ctx.activity({
          text: `🟢 **${check.name}** recovered (status ${entry.status || 'ok'}, ${entry.ms} ms)`,
          icon: '🟢', level: 'ok', source: ctx.pluginId, tags: ['status'],
        });
      } else if (!entry.ok && prev !== false) {
        ctx.activity({
          text: `🔴 **${check.name}** is DOWN (status ${entry.status || 'no response'})`,
          icon: '🔴', level: 'error', source: ctx.pluginId, tags: ['status'],
        });
      }
      ctx.notify('health-checks.updated', {
        checkId: check.id, name: check.name, ok: entry.ok, ms: entry.ms,
        status: entry.status, at: entry.at,
      });
      return result;
    }

    /** One fetch with a 5s abort timeout; never throws. */
    async function runCheck(check) {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
      timeout.unref?.();
      const started = Date.now();
      try {
        const res = await fetch(check.url, { signal: ctrl.signal, redirect: 'manual' });
        const ms = Date.now() - started;
        return record(check, { ok: res.status === check.expectStatus, ms, status: res.status, at: iso() });
      } catch (err) {
        const ms = Date.now() - started;
        return record(check, {
          ok: false, ms, status: 0, at: iso(),
          error: String((err && (err.name || err.message)) || 'request failed').slice(0, 120),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    /** Recreate a check's interval timer (idempotent — one per check). */
    function ensureTimer(check) {
      if (timers.has(check.id)) return;
      const secs = clamp(Math.floor(Number(check.intervalSec)) || 60, 10, 3600);
      timers.set(check.id, ctx.every(secs * 1000, () => {
        runCheck(check).catch(() => { /* results already recorded */ });
      }));
    }

    function stopTimer(checkId) {
      const handle = timers.get(checkId);
      if (handle) { clearInterval(handle); timers.delete(checkId); }
    }

    /** Rebuild runner state on (re)activation from persisted data. */
    function syncRunner() {
      for (const check of checks.all()) {
        const last = latest(check.id);
        lastOk.set(check.id, last ? last.ok : undefined);
        ensureTimer(check);
      }
    }
    syncRunner();

    /* ── Routes ─────────────────────────────────────────────────────────── */

    ctx.registerRoute('GET', '/api/health-checks', (req, res) => {
      const all = checks.all();
      ctx.json(res, 200, {
        checks: all.map((c) => {
          const last = latest(c.id);
          return {
            ...c,
            latest: last ? { ok: last.ok, ms: last.ms, status: last.status, at: last.at } : null,
            rate: rate(c.id),
          };
        }),
        totals: {
          total: all.length,
          down: all.filter((c) => {
            const last = latest(c.id);
            return last ? !last.ok : false;
          }).length,
        },
      });
    });

    ctx.registerRoute('POST', '/api/health-checks', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 80);
      const url = String(body.url || '').trim().slice(0, 500);
      if (!name) return ctx.json(res, 400, { error: 'name is required' });
      if (!/^https?:\/\//.test(url)) {
        return ctx.json(res, 400, { error: 'url must start with http:// or https://' });
      }
      try { new URL(url); } catch {
        return ctx.json(res, 400, { error: 'url is not a valid URL' });
      }
      const expectStatus = Math.floor(Number(body.expectStatus));
      if (!Number.isInteger(expectStatus) || expectStatus < 100 || expectStatus > 599) {
        return ctx.json(res, 400, { error: 'expectStatus must be an integer between 100 and 599' });
      }
      const intervalSec = clamp(Math.floor(Number(body.intervalSec)) || 60, 10, 3600);
      const check = checks.insert({ name, url, expectStatus, intervalSec });
      ensureTimer(check);

      // Kick in right away (unref'd so it never holds the process open).
      const t = setTimeout(() => { runCheck(check).catch(() => {}); }, 200);
      t.unref?.();

      ctx.notify('health-checks.updated', { checkId: check.id, reason: 'created' });
      ctx.activity({
        text: `📡 Health check **${name}** added — ${url} (expect ${expectStatus} every ${intervalSec}s)`,
        icon: '📡', level: 'info', source: ctx.pluginId, tags: ['status'],
      });
      ctx.json(res, 201, check);
    });

    ctx.registerRoute('DELETE', '/api/health-checks/:id', (req, res, params) => {
      const check = checks.get(params.id);
      if (!check) return ctx.json(res, 404, { error: 'check not found' });
      stopTimer(check.id);
      checks.remove(check.id);
      for (const r of results.all().filter((x) => x.checkId === check.id)) results.remove(r.id);
      lastOk.delete(check.id);
      ctx.notify('health-checks.updated', { checkId: check.id, reason: 'deleted' });
      ctx.json(res, 200, { ok: true });
    });

    ctx.registerRoute('POST', '/api/health-checks/:id/run', async (req, res, params) => {
      const check = checks.get(params.id);
      if (!check) return ctx.json(res, 404, { error: 'check not found' });
      const result = await runCheck(check);
      ctx.json(res, 200, {
        ok: result.ok, ms: result.ms, status: result.status, at: result.at,
      });
    });

    /* ── Capability: what the status page / widgets consume ─────────────── */

    ctx.capabilities.provide('health.snapshot', () => checks.all().map((c) => {
      const last = latest(c.id);
      return {
        name: c.name,
        level: last ? (last.ok ? 'ok' : 'error') : 'ok',
        ms: last ? last.ms : null,
        at: last ? last.at : null,
        rate: rate(c.id),
      };
    }), ctx.pluginId);

    ctx.log(`${checks.all().length} health checks registered`);
  },
};
