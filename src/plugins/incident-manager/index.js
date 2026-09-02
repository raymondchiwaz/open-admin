'use strict';

/**
 * Incident Manager — a tiny incident state machine with a public timeline.
 *
 * statuses: investigating → identified → monitoring → resolved. Every update
 * is appended to the incident's timeline and broadcast (`incidents.changed`).
 * Opening an incident posts an alert to the Social feed; resolving it posts an
 * all-clear. `incidents.active` feeds the Status Page plugin.
 *
 * Capability: `incidents.active` → non-resolved incidents
 * Event:       `incidents.changed`
 */

const crypto = require('crypto');

const SEVERITIES = ['minor', 'major', 'critical'];
const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];

function iso(ms) { return new Date(ms).toISOString(); }

/** First-run seed: one resolved "API latency spike" with a full timeline. */
function seedIncidents(collection) {
  const now = Date.now();
  const h = 3600 * 1000;
  collection.replaceAll([{
    id: crypto.randomUUID(),
    title: 'API latency spike',
    severity: 'major',
    status: 'resolved',
    createdAt: iso(now - 6 * h),
    resolvedAt: iso(now - 4 * h),
    updates: [
      { status: 'investigating', message: 'Elevated API latency reported — p95 above 1.2s.', at: iso(now - 6 * h) },
      { status: 'identified', message: 'Root cause: replica lag after the weekly maintenance window.', at: iso(now - 5.5 * h) },
      { status: 'monitoring', message: 'Traffic shifted to primary; latency back at baseline — watching for recurrence.', at: iso(now - 4.5 * h) },
    ],
  }]);
}

module.exports = {
  init(ctx) {
    const incidents = ctx.store.collection('incidents');
    if (incidents.all().length === 0) seedIncidents(incidents);

    const byNewest = () => [...incidents.all()].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)));

    ctx.capabilities.provide('incidents.active', () =>
      incidents.all().filter((i) => i.status !== 'resolved'), ctx.pluginId);

    ctx.registerRoute('GET', '/api/incidents', (req, res) => {
      const all = byNewest();
      ctx.json(res, 200, {
        incidents: all,
        totals: {
          total: all.length,
          active: all.filter((i) => i.status !== 'resolved').length,
          critical: all.filter((i) => i.severity === 'critical' && i.status !== 'resolved').length,
        },
      });
    });

    ctx.registerRoute('POST', '/api/incidents', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const title = String(body.title || '').trim().slice(0, 120);
      if (!title) return ctx.json(res, 400, { error: 'title is required' });
      const severity = SEVERITIES.includes(body.severity) ? body.severity : 'minor';
      const at = new Date().toISOString();
      const incident = incidents.insert({
        title,
        severity,
        status: 'investigating',
        createdAt: at,
        resolvedAt: null,
        updates: [{ status: 'investigating', message: 'Incident opened — investigating.', at }],
      });
      ctx.notify('incidents.changed', { incident });
      ctx.activity({
        text: `🚨 Incident: **${incident.title}** (${incident.severity})`,
        icon: '🚨', level: 'error', source: ctx.pluginId, tags: ['incident', severity],
      });
      ctx.json(res, 201, incident);
    });

    ctx.registerRoute('POST', '/api/incidents/:id/updates', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const incident = incidents.get(params.id);
      if (!incident) return ctx.json(res, 404, { error: 'incident not found' });
      if (incident.status === 'resolved') {
        return ctx.json(res, 409, { error: 'incident is already resolved' });
      }
      const status = STATUSES.includes(body.status) ? body.status : incident.status;
      const message = String(body.message || '').trim().slice(0, 400);
      if (!message) return ctx.json(res, 400, { error: 'message is required' });

      const patch = {
        status,
        updates: [...incident.updates, { status, message, at: new Date().toISOString() }],
      };
      if (status === 'resolved') patch.resolvedAt = new Date().toISOString();
      const updated = incidents.update(incident.id, patch);

      ctx.notify('incidents.changed', { incident: updated });
      if (status === 'resolved') {
        ctx.activity({
          text: `✅ Incident resolved: **${updated.title}**`,
          icon: '✅', level: 'ok', source: ctx.pluginId, tags: ['incident', 'resolved'],
        });
      } else {
        ctx.activity({
          text: `🔧 **${updated.title}** — ${status} (${message.slice(0, 140)})`,
          icon: '🔧', level: 'info', source: ctx.pluginId, tags: ['incident', status],
        });
      }
      ctx.json(res, 200, updated);
    });

    ctx.registerRoute('DELETE', '/api/incidents/:id', (req, res, params) => {
      const removed = incidents.remove(params.id);
      if (!removed) return ctx.json(res, 404, { error: 'incident not found' });
      ctx.notify('incidents.changed', { deleted: params.id });
      ctx.json(res, 200, { ok: true });
    });
  },
};
