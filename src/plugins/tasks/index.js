'use strict';

/**
 * Tasks — a three-column kanban board (Todo / Doing / Done).
 *
 *   GET    /api/tasks          everything (flat list, oldest first)
 *   POST   /api/tasks          { title, assignee?, priority? }  → status 'todo'
 *   PATCH  /api/tasks/:id      { status?|priority?|assignee? }  (status→done sets
 *                              doneAt and posts "completed" activity; leaving done
 *                              clears doneAt)
 *   DELETE /api/tasks/:id      remove a task
 *
 * Every mutation notifies `tasks.changed` (with the fresh list) so open
 * browsers update the board and the dashboard widget live over SSE.
 */

const crypto = require('crypto');

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

/** One-time sample data (real uuid ids — store.update() matches by id). */
function seed(tasks) {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600000).toISOString();
  tasks.replaceAll([
    { id: crypto.randomUUID(), title: 'Design the new onboarding flow', assignee: 'Ada', priority: 'high', status: 'todo', createdAt: ago(3) },
    { id: crypto.randomUUID(), title: 'Write API docs for Webhooks', assignee: 'Grace', priority: 'medium', status: 'todo', createdAt: ago(5) },
    { id: crypto.randomUUID(), title: 'Investigate slow dashboard query', assignee: 'Alan', priority: 'high', status: 'doing', createdAt: ago(26) },
    { id: crypto.randomUUID(), title: 'Prepare release notes for v1.0', assignee: 'Maya', priority: 'low', status: 'doing', createdAt: ago(30) },
    { id: crypto.randomUUID(), title: 'Set up staging environment', assignee: 'Ada', priority: 'medium', status: 'done', createdAt: ago(50), doneAt: ago(48) },
    { id: crypto.randomUUID(), title: 'Harden login rate limiting', assignee: 'Katherine', priority: 'high', status: 'done', createdAt: ago(80), doneAt: ago(76) },
  ]);
}

module.exports = {
  init(ctx) {
    const tasks = ctx.store.collection('tasks');

    if (!ctx.store.getState('seeded')) {
      seed(tasks);
      ctx.store.setState('seeded', true);
    }

    /** Oldest first — stable ordering for the board columns. */
    function list() {
      return [...tasks.all()].sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    }

    function notifyChanged() {
      ctx.notify('tasks.changed', { tasks: list() });
    }

    ctx.registerRoute('GET', '/api/tasks', (req, res) => {
      ctx.json(res, 200, { tasks: list() });
    });

    ctx.registerRoute('POST', '/api/tasks', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const title = String(body.title || '').trim().slice(0, 120);
      if (!title) return ctx.json(res, 400, { error: 'title is required' });
      const assignee = String(body.assignee || '').trim().slice(0, 60);
      const priority = PRIORITIES.includes(body.priority) ? body.priority : 'medium';
      const task = tasks.insert({ title, assignee, priority, status: 'todo' });
      ctx.activity({
        text: `📋 New task: **${task.title}**${assignee ? ` (${assignee})` : ''}`,
        icon: '📋',
        level: 'info',
        tags: ['tasks'],
      });
      notifyChanged();
      ctx.json(res, 201, task);
    });

    ctx.registerRoute('PATCH', '/api/tasks/:id', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const patch = {};
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return ctx.json(res, 400, { error: 'invalid status' });
        patch.status = body.status;
      }
      if (body.priority !== undefined) {
        if (!PRIORITIES.includes(body.priority)) return ctx.json(res, 400, { error: 'invalid priority' });
        patch.priority = body.priority;
      }
      if (body.assignee !== undefined) patch.assignee = String(body.assignee).trim().slice(0, 60);
      if (Object.keys(patch).length === 0) return ctx.json(res, 400, { error: 'nothing to update' });

      const task = tasks.get(params.id);
      if (!task) return ctx.json(res, 404, { error: 'task not found' });

      // Moving a task to/from done tracks doneAt and announces it.
      const becomingDone = patch.status === 'done' && task.status !== 'done';
      const leavingDone = patch.status !== undefined && patch.status !== 'done' && task.status === 'done';
      if (becomingDone) patch.doneAt = new Date().toISOString();
      if (leavingDone) patch.doneAt = null;

      const updated = tasks.update(params.id, patch);
      if (becomingDone) {
        ctx.activity({
          text: `✅ ${updated.assignee || 'Someone'} completed **${updated.title}**`,
          icon: '✅',
          level: 'info',
          tags: ['tasks'],
        });
      }
      notifyChanged();
      ctx.json(res, 200, updated);
    });

    ctx.registerRoute('DELETE', '/api/tasks/:id', (req, res, params) => {
      const removed = tasks.remove(params.id);
      if (!removed) return ctx.json(res, 404, { error: 'task not found' });
      notifyChanged();
      ctx.json(res, 200, { ok: true });
    });
  },
};
