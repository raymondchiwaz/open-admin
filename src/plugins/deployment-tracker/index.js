'use strict';

/**
 * Deployment Tracker — a tiny deploy-state machine seeded with history.
 *
 * statuses: in_progress → (succeeded | failed) or rolled_back. Every state
 * transition is broadcast (`deploys.changed`) and posted to the Social feed
 * via the public `activity` event, so activity-log and analytics see it too.
 */

const crypto = require('crypto');

function iso(ms) { return new Date(ms).toISOString(); }

/** Seed 4 deploys: 3 succeeded on v1.2.x, 1 rolled back. Seed rows carry real
 *  ids — store.update()/get() match by id, so id-less rows are unreachable. */
function seedDeploys(collection) {
  const now = Date.now();
  const h = 3600 * 1000;
  collection.replaceAll([
    { id: crypto.randomUUID(), version: 'v1.2.3', env: 'production', status: 'succeeded', startedAt: iso(now - 50 * h), finishedAt: iso(now - 50 * h + 150 * 1000), notes: 'Weekly bundle refresh; health checks green.', by: 'Deploy Bot' },
    { id: crypto.randomUUID(), version: 'v1.2.2', env: 'production', status: 'rolled_back', startedAt: iso(now - 74 * h), finishedAt: iso(now - 74 * h + 90 * 1000), notes: 'Checkout p95 regressed; reverted to v1.2.1.', by: 'Admin' },
    { id: crypto.randomUUID(), version: 'v1.2.5', env: 'production', status: 'succeeded', startedAt: iso(now - 3 * h), finishedAt: iso(now - 3 * h + 140 * 1000), notes: 'Checkout perf pass — p95 down 18%.', by: 'Deploy Bot' },
    { id: crypto.randomUUID(), version: 'v1.2.4', env: 'staging', status: 'succeeded', startedAt: iso(now - 26 * h), finishedAt: iso(now - 26 * h + 120 * 1000), notes: 'Staging smoke test before the production cut.', by: 'Deploy Bot' },
  ]);
}

function byStartedDesc(a, b) {
  return String(b.startedAt || '').localeCompare(String(a.startedAt || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

module.exports = {
  init(ctx) {
    const deploys = ctx.store.collection('deploys');
    if (deploys.all().length === 0) seedDeploys(deploys);

    const latest = () => [...deploys.all()].sort(byStartedDesc)[0] || null;
    ctx.capabilities.provide('deploys.current', () => latest(), ctx.pluginId);

    ctx.registerRoute('GET', '/api/deploys', (req, res) => {
      ctx.json(res, 200, { deploys: [...deploys.all()].sort(byStartedDesc) });
    });

    ctx.registerRoute('POST', '/api/deploys', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const version = String(body.version || '').trim().slice(0, 60);
      if (!version) return ctx.json(res, 400, { error: 'version is required (e.g. v1.2.6)' });
      const env = body.env === 'staging' ? 'staging' : 'production';
      const notes = String(body.notes || '').trim().slice(0, 240);
      const by = String(body.by || 'Admin').trim().slice(0, 60) || 'Admin';
      const deploy = deploys.insert({
        version,
        env,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        notes,
        by,
      });
      ctx.notify('deploys.changed', { deploy });
      ctx.activity({
        text: `🚢 Deploy **${deploy.version}** → ${deploy.env} started`,
        icon: '🚢',
        level: 'info',
        source: ctx.pluginId,
        tags: ['deploy', deploy.env],
      });
      ctx.json(res, 201, deploy);
    });

    ctx.registerRoute('POST', '/api/deploys/:id/finish', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const deploy = deploys.get(params.id);
      if (!deploy) return ctx.json(res, 404, { error: 'deploy not found' });
      if (deploy.status !== 'in_progress') return ctx.json(res, 409, { error: `deploy is already ${deploy.status}` });
      const status = body.status === 'failed' ? 'failed' : 'succeeded';
      const updated = deploys.update(params.id, { status, finishedAt: new Date().toISOString() });
      ctx.notify('deploys.changed', { deploy: updated });
      ctx.activity({
        text: `${status === 'succeeded' ? '✅' : '❌'} Deploy **${deploy.version}** → ${deploy.env} ${status}`,
        icon: status === 'succeeded' ? '✅' : '❌',
        level: status === 'succeeded' ? 'info' : 'error',
        source: ctx.pluginId,
        tags: ['deploy', deploy.env],
      });
      ctx.json(res, 200, updated);
    });

    ctx.registerRoute('POST', '/api/deploys/:id/rollback', async (req, res, params) => {
      const deploy = deploys.get(params.id);
      if (!deploy) return ctx.json(res, 404, { error: 'deploy not found' });
      if (deploy.status !== 'in_progress') return ctx.json(res, 409, { error: `deploy is already ${deploy.status}` });
      const updated = deploys.update(params.id, { status: 'rolled_back', finishedAt: new Date().toISOString() });
      ctx.notify('deploys.changed', { deploy: updated });
      ctx.activity({
        text: `↩️ Deploy **${deploy.version}** → ${deploy.env} rolled back`,
        icon: '↩️',
        level: 'warn',
        source: ctx.pluginId,
        tags: ['deploy', deploy.env],
      });
      ctx.json(res, 200, updated);
    });
  },
};
