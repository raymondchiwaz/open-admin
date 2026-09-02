'use strict';

/**
 * Scheduled Jobs — periodic tasks with a run log.
 *
 * Job kinds:
 *   - activity   → post a "ran on schedule" entry into the Social feed
 *   - http-ping  → GET a URL (4s timeout); non-2xx or failure counts a fail
 *   - kv-touch   → setState('lastTick', now) so custom logic / the data
 *                  inspector can watch a liveness tick
 *
 * Every run updates counters, writes a log row (cap 200) and broadcasts
 * `cron-jobs.ran` so open browser clients refresh live.
 */

const PING_TIMEOUT_MS = 4000;
const LOG_CAP = 200;
const KINDS = ['activity', 'http-ping', 'kv-touch'];
const URL_RE = /^https?:\/\//i;

/** Execute one job run. Returns {ok, detail}; never throws. */
async function execute(ctx, job) {
  const name = job.name;
  switch (job.action && job.action.kind) {
    case 'activity':
      ctx.activity({ text: `⏰ **${name}** ran on schedule`, icon: '⏰', level: 'info', tags: ['cron'] });
      return { ok: true, detail: 'posted to the feed' };

    case 'http-ping': {
      const url = job.action.url || '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      const started = Date.now();
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        const ms = Date.now() - started;
        if (res.ok) return { ok: true, detail: `HTTP ${res.status} in ${ms}ms` };
        return { ok: false, detail: `HTTP ${res.status} in ${ms}ms` };
      } catch {
        return { ok: false, detail: 'unreachable (timeout or network error)' };
      } finally {
        clearTimeout(timer);
      }
    }

    case 'kv-touch': {
      const now = new Date().toISOString();
      ctx.store.setState('lastTick', now);
      return { ok: true, detail: `lastTick = ${now}` };
    }

    default:
      return { ok: false, detail: 'unknown action kind' };
  }
}

module.exports = {
  init(ctx) {
    const jobs = ctx.store.collection('jobs');
    const log = ctx.store.collection('log');

    // Seed demo jobs once (kv flag survives disable/re-enable, so a user who
    // deletes the demo jobs won't get them back).
    if (!ctx.store.getState('seeded', false)) {
      ctx.store.setState('seeded', true);
      if (jobs.all().length === 0) {
        jobs.insert({
          name: 'Hourly heartbeat',
          intervalMin: 60,
          action: { kind: 'activity' },
          active: true,
          runCount: 0,
          failCount: 0,
          lastRunAt: null,
          lastResult: null,
        });
        jobs.insert({
          name: 'Example ping',
          intervalMin: 30,
          action: { kind: 'http-ping', url: 'https://example.com' },
          active: false,
          runCount: 0,
          failCount: 0,
          lastRunAt: null,
          lastResult: null,
        });
      }
    }

    /** Append a log row, keeping the ring buffer at LOG_CAP. */
    function logRun(job, ok, detail) {
      log.insert({ jobId: job.id, jobName: job.name, ok, detail, at: new Date().toISOString() });
      if (log.all().length > LOG_CAP) log.replaceAll(log.all().slice(-LOG_CAP));
    }

    /** Run a job once, update counters, log it and broadcast. */
    async function run(job) {
      const startedAt = new Date().toISOString();
      let ok = false;
      let detail = 'unknown error';
      try {
        const result = await execute(ctx, job);
        ok = result.ok;
        detail = result.detail;
      } catch (err) {
        ok = false;
        detail = err && err.message ? err.message : 'unknown error';
      }
      const patch = {
        runCount: (job.runCount || 0) + 1,
        failCount: (job.failCount || 0) + (ok ? 0 : 1),
        lastRunAt: startedAt,
        lastResult: { ok, detail },
      };
      const updated = jobs.update(job.id, patch);
      logRun(job, ok, detail);
      ctx.notify('cron-jobs.ran', { job: updated, ok });
      if (!ok) ctx.log(`job "${job.name}" failed:`, detail);
    }

    /** Map of jobId -> interval handle (so individual jobs can be restarted). */
    const runners = new Map();

    function startJob(job) {
      stopJob(job.id);
      if (!job.active) return null;
      const handle = ctx.every(job.intervalMin * 60_000, () => run(job));
      runners.set(job.id, handle);
      return handle;
    }

    function stopJob(id) {
      const handle = runners.get(id);
      if (handle) {
        clearInterval(handle);
        runners.delete(id);
      }
    }

    for (const job of jobs.all()) startJob(job);

    // ── Routes ──────────────────────────────────────────────────────────────

    ctx.registerRoute('GET', '/api/cron-jobs', (req, res) => {
      ctx.json(res, 200, {
        jobs: jobs.all(),
        log: [...log.all()].slice(-20).reverse(),
      });
    });

    ctx.registerRoute('POST', '/api/cron-jobs', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 80);
      const intervalMin = Math.round(Number(body.intervalMin));
      const kind = body.action && body.action.kind;

      if (!name) return ctx.json(res, 400, { error: 'name is required' });
      if (!Number.isFinite(intervalMin) || intervalMin < 1 || intervalMin > 10080) {
        return ctx.json(res, 400, { error: 'intervalMin must be between 1 and 10080' });
      }
      if (!KINDS.includes(kind)) {
        return ctx.json(res, 400, { error: 'action.kind must be one of ' + KINDS.join(', ') });
      }

      const action = { kind };
      if (kind === 'http-ping') {
        const url = String(body.action && body.action.url || '').trim();
        if (!URL_RE.test(url)) return ctx.json(res, 400, { error: 'http-ping jobs need a valid http(s) URL' });
        action.url = url;
      }

      const job = jobs.insert({
        name,
        intervalMin,
        action,
        active: true,
        runCount: 0,
        failCount: 0,
        lastRunAt: null,
        lastResult: null,
      });
      startJob(job);
      ctx.activity({ text: `⏰ Scheduled job **${name}** (every ${intervalMin} min) was created`, icon: '⏰', level: 'info', tags: ['cron'] });
      ctx.json(res, 201, { job });
    });

    // Restart the timer whenever intervalMin or active changes.
    ctx.registerRoute('PATCH', '/api/cron-jobs/:id', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const patch = {};
      if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') return ctx.json(res, 400, { error: 'active must be a boolean' });
        patch.active = body.active;
      }
      if (body.intervalMin !== undefined) {
        const intervalMin = Math.round(Number(body.intervalMin));
        if (!Number.isFinite(intervalMin) || intervalMin < 1 || intervalMin > 10080) {
          return ctx.json(res, 400, { error: 'intervalMin must be between 1 and 10080' });
        }
        patch.intervalMin = intervalMin;
      }
      if (Object.keys(patch).length === 0) return ctx.json(res, 400, { error: 'nothing to update' });
      const job = jobs.update(params.id, patch);
      if (!job) return ctx.json(res, 404, { error: 'job not found' });
      startJob(job);
      ctx.json(res, 200, { job });
    });

    ctx.registerRoute('DELETE', '/api/cron-jobs/:id', (req, res, params) => {
      stopJob(params.id);
      const removed = jobs.remove(params.id);
      if (removed) log.replaceAll(log.all().filter((l) => l.jobId !== params.id));
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });

    ctx.registerRoute('POST', '/api/cron-jobs/:id/run-now', async (req, res, params) => {
      const job = jobs.get(params.id);
      if (!job) return ctx.json(res, 404, { error: 'job not found' });
      await run(job); // run() counts + logs every outcome, never throws
      const after = jobs.get(params.id);
      ctx.json(res, 200, { job: after, ok: !!(after && after.lastResult && after.lastResult.ok) });
    });

    ctx.log(`${jobs.all().length} scheduled job(s) loaded`);
  },
};
