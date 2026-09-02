'use strict';

/**
 * Notes — team sticky notes.
 *
 *   GET    /api/notes        pinned first, then newest first
 *   POST   /api/notes        { text (max 500), color? (0-5) }
 *   PATCH  /api/notes/:id    { text?|pinned?|color? }
 *   DELETE /api/notes/:id
 *
 * Every mutation notifies `notes.changed` (with the fresh list) so open
 * browsers update the wall and the dashboard widget live over SSE.
 */

const crypto = require('crypto');

const MAX_TEXT = 500;
const MAX_COLOR = 5;

function seed(notes) {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600000).toISOString();
  notes.replaceAll([
    { id: crypto.randomUUID(), text: 'Deploy window is Friday 14:00 UTC — freeze merges after Thursday standup.', color: 1, pinned: true, author: 'Grace', createdAt: ago(2) },
    { id: crypto.randomUUID(), text: 'Remember: every API route must validate input before touching the store.', color: 3, pinned: false, author: 'Alan', createdAt: ago(9) },
    { id: crypto.randomUUID(), text: 'Ideas for the team offsite: whiteboard sprint, hack day, then a long lunch 🥪', color: 0, pinned: false, author: 'Maya', createdAt: ago(28) },
    { id: crypto.randomUUID(), text: 'The new dashboard widget looked great in the demo — ship it behind a flag first.', color: 4, pinned: false, author: 'Ada', createdAt: ago(55) },
  ]);
}

module.exports = {
  init(ctx) {
    const notes = ctx.store.collection('notes');

    if (!ctx.store.getState('seeded')) {
      seed(notes);
      ctx.store.setState('seeded', true);
    }

    /** Pinned first, then newest first. */
    function list() {
      return [...notes.all()].sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    function notifyChanged() {
      ctx.notify('notes.changed', { notes: list() });
    }

    function cleanColor(c) {
      const n = Number(c);
      return Number.isFinite(n) && n >= 0 && n <= MAX_COLOR ? Math.floor(n) : 0;
    }

    ctx.registerRoute('GET', '/api/notes', (req, res) => {
      ctx.json(res, 200, { notes: list() });
    });

    ctx.registerRoute('POST', '/api/notes', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      if (!text) return ctx.json(res, 400, { error: 'text is required' });
      const note = notes.insert({
        text,
        color: cleanColor(body.color),
        pinned: false,
        author: String(body.author || 'Admin').trim().slice(0, 40) || 'Admin',
      });
      notifyChanged();
      ctx.json(res, 201, note);
    });

    ctx.registerRoute('PATCH', '/api/notes/:id', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const patch = {};
      if (body.text !== undefined) {
        const text = String(body.text).trim().slice(0, MAX_TEXT);
        if (!text) return ctx.json(res, 400, { error: 'text cannot be empty' });
        patch.text = text;
      }
      if (body.pinned !== undefined) patch.pinned = !!body.pinned;
      if (body.color !== undefined) patch.color = cleanColor(body.color);
      if (Object.keys(patch).length === 0) return ctx.json(res, 400, { error: 'nothing to update' });

      const note = notes.update(params.id, patch);
      if (!note) return ctx.json(res, 404, { error: 'note not found' });
      notifyChanged();
      ctx.json(res, 200, note);
    });

    ctx.registerRoute('DELETE', '/api/notes/:id', (req, res, params) => {
      const removed = notes.remove(params.id);
      if (!removed) return ctx.json(res, 404, { error: 'note not found' });
      notifyChanged();
      ctx.json(res, 200, { ok: true });
    });
  },
};
