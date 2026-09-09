'use strict';

/**
 * Social Admin — server side.
 *
 * Turns the admin into a social feed. It renders the kernel's event stream
 * (posts, updates, deploys, plugin lifecycle) and exposes:
 *
 *   Feed & posts     GET/POST /api/social/…        reactions, comments, resolve
 *   Feedback board   GET/POST /api/social/feedback upvotes, status, comments
 *   Stories          GET /api/social/stories       system-health "stories"
 *   Trending         GET /api/social/trending      most used #tags
 *
 * Cross-plugin contracts it publishes:
 *   capability `social.post`       — post to the feed programmatically
 *   capability `feedback.capture`  — add feedback from other plugins
 *   event `activity`               — ANY plugin/site emits it, it becomes a post
 */

const crypto = require('crypto');

const id = () => crypto.randomUUID();
const ME = { name: 'Admin', handle: '@admin', avatar: '🫡', color: 'g1', verified: false };
const SYSTEM = (icon, color) => ({ name: 'System', handle: '@system', avatar: icon, color: color || 'g4', verified: true });

const TAB_KINDS = {
  all: null,
  updates: ['update', 'deploy', 'status'],
  announcements: ['announcement'],
};

/** Event unsubscribers for the current activation (run on destroy). */
let unsubs = [];

module.exports = {
  init(ctx) {
    const posts = ctx.store.collection('posts');
    const feedback = ctx.store.collection('feedback');
    unsubs = [];

    function createPost(data) {
      const post = posts.insert({
        kind: 'activity',
        source: ctx.pluginId,
        author: SYSTEM('✨'),
        text: '',
        tags: [],
        status: null,
        reactions: {},
        comments: [],
        resolved: false,
        ...data,
      });
      ctx.notify('social.post.created', { post });
      return post;
    }

    // ── Cross-plugin contracts ────────────────────────────────────────────
    // Any plugin (or your site, via POST /api/events) can emit an `activity`
    // event; it becomes a feed post. Plugins never need to know about Social
    // Admin, and Social Admin never needs to know about them.
    unsubs.push(ctx.events.on('activity', (payload) => {
      const a = payload && payload.activity;
      if (!a || !a.text) return;
      const source = a.source || 'system';
      createPost({
        kind: 'activity',
        source,
        author: { name: source, handle: '@' + source, avatar: a.icon || '✨', color: 'g4', verified: true },
        text: a.text,
        tags: a.tags || ['activity'],
        status: a.level === 'warn'
          ? { label: 'warning', level: 'warn' }
          : a.level === 'error' ? { label: 'error', level: 'error' } : null,
      });
    }));

    unsubs.push(ctx.events.on('plugin.enabled', (p) => createPost({
      kind: 'activity', source: 'core',
      author: { name: p.name || p.id, handle: '@' + p.id, avatar: p.icon || '🧩', color: 'g2', verified: true },
      text: `Plugin **${p.name || p.id}** was enabled and joined your stack 👋`,
      tags: ['plugins'],
    })));

    unsubs.push(ctx.events.on('plugin.disabled', (p) => createPost({
      kind: 'activity', source: 'core',
      author: { name: p.name || p.id, handle: '@' + p.id, avatar: p.icon || '🧩', color: 'g2', verified: true },
      text: `Plugin **${p.name || p.id}** was disabled. Its pages and widgets are gone from the admin.`,
      tags: ['plugins'],
      status: { label: 'disabled', level: 'warn' },
    })));

    unsubs.push(ctx.events.on('update.installed', (u) => createPost({
      kind: 'update', source: 'core',
      author: { name: 'Open Admin Updates', handle: '@updates', avatar: '📦', color: 'g3', verified: true },
      text: `Update installed: **${u.name}** v${u.version} ✅`,
      tags: ['update'],
      status: { label: u.id, level: 'ok' },
    })));

    unsubs.push(ctx.events.on('feedback.created', (f) => createPost({
      kind: 'feedback', source: 'site',
      author: { name: f.name || 'Someone', handle: '@visitor', avatar: '👤', color: 'g6', verified: false },
      text: `New ${f.type} feedback: “${f.message}” — vote it up on the Feedback board.`,
      tags: ['feedback'],
      feedbackId: f.id,
    })));

    // Capabilities other plugins can use:
    ctx.capabilities.provide('social.post', async (input) => createPost({
      kind: input.kind || 'activity',
      source: input.source || ctx.pluginId,
      author: input.author || {
        name: input.source || 'Plugin', handle: '@' + (input.source || 'plugin'),
        avatar: input.icon || '🧩', color: 'g4', verified: true,
      },
      text: input.text,
      tags: input.tags || [],
      status: input.status || null,
    }), ctx.pluginId);

    function addFeedback(input) {
      const item = feedback.insert({
        name: String(input.name || 'Anonymous').slice(0, 80),
        email: String(input.email || '').slice(0, 120),
        type: ['idea', 'bug', 'praise'].includes(input.type) ? input.type : 'idea',
        message: String(input.message || '').slice(0, 2000),
        upvotes: 0,
        status: 'open',
        comments: [],
      });
      ctx.notify('feedback.created', item);
      return item;
    }
    ctx.capabilities.provide('feedback.capture', addFeedback, ctx.pluginId);

    // ── Feed & posts ──────────────────────────────────────────────────────
    ctx.registerRoute('GET', '/api/social/feed', (req, res) => {
      const tab = req.searchParams.get('tab') || 'all';
      const kinds = TAB_KINDS[tab];
      let list = posts.all();
      const sources = [...new Set(list.map((p) => p.source).filter(Boolean))].sort();
      if (kinds) list = list.filter((p) => kinds.includes(p.kind));
      if (tab === 'attention') list = list.filter((p) => !p.resolved &&
        (p.kind === 'update' || ['warn', 'error'].includes(p.status?.level)));
      if (tab === 'saved') {
        const ids = new Set((req.searchParams.get('ids') || '').split(',').filter(Boolean));
        list = list.filter((p) => ids.has(p.id));
      }
      const tag = req.searchParams.get('tag');
      if (tag) list = list.filter((p) => (p.tags || []).includes(tag));
      const source = req.searchParams.get('source');
      if (source) list = list.filter((p) => p.source === source);
      const q = (req.searchParams.get('q') || '').trim().toLowerCase();
      if (q) list = list.filter((p) => [p.text, p.author?.name, ...(p.tags || []).map((t) => '#' + t)]
        .join(' ').toLowerCase().includes(q));
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const number = (value, fallback) => value !== null && Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
      const limit = Math.max(1, Math.min(100, number(req.searchParams.get('limit'), 60)));
      const offset = Math.max(0, number(req.searchParams.get('offset'), 0));
      const page = list.slice(offset, offset + limit);
      ctx.json(res, 200, { posts: page, total: list.length, sources,
        hasMore: offset + page.length < list.length, nextOffset: offset + page.length });
    });

    ctx.registerRoute('POST', '/api/social/posts', async (req, res) => {
      const body = await ctx.readBody(req);
      if (!body.text || !String(body.text).trim()) {
        return ctx.json(res, 400, { error: 'text is required' });
      }
      const post = createPost({
        kind: ['announcement', 'status', 'deploy'].includes(body.kind) ? body.kind : 'announcement',
        source: 'admin',
        author: ME,
        text: String(body.text).trim().slice(0, 2000),
        tags: Array.isArray(body.tags) && body.tags.length
          ? body.tags
          : (String(body.text).match(/#([\w-]+)/g) || []).map((t) => t.slice(1)),
        status: body.status || null,
      });
      ctx.json(res, 201, post);
    });

    ctx.registerRoute('POST', '/api/social/posts/:id/react', async (req, res, params) => {
      const body = await ctx.readBody(req);
      const post = posts.get(params.id);
      if (!post) return ctx.json(res, 404, { error: 'post not found' });
      const emoji = String(body.emoji || '👍').slice(0, 8);
      const delta = body.on === false ? -1 : 1;
      const reactions = { ...(post.reactions || {}) };
      reactions[emoji] = Math.max(0, (reactions[emoji] || 0) + delta);
      if (!reactions[emoji]) delete reactions[emoji];
      posts.update(post.id, { reactions });
      const fresh = posts.get(post.id);
      ctx.notify('social.post.updated', { post: fresh });
      ctx.json(res, 200, fresh);
    });

    ctx.registerRoute('POST', '/api/social/posts/:id/comments', async (req, res, params) => {
      const body = await ctx.readBody(req);
      const post = posts.get(params.id);
      if (!post) return ctx.json(res, 404, { error: 'post not found' });
      if (!body.text || !String(body.text).trim()) return ctx.json(res, 400, { error: 'text is required' });
      const comments = [...(post.comments || []), {
        id: id(), author: { name: 'Admin', avatar: '🫡', color: 'g1' },
        text: String(body.text).trim().slice(0, 1000), at: new Date().toISOString(),
      }];
      posts.update(post.id, { comments });
      const fresh = posts.get(post.id);
      ctx.notify('social.post.updated', { post: fresh });
      ctx.json(res, 200, fresh);
    });

    ctx.registerRoute('POST', '/api/social/posts/:id/resolve', (req, res, params) => {
      const post = posts.get(params.id);
      if (!post) return ctx.json(res, 404, { error: 'post not found' });
      posts.update(post.id, { resolved: !post.resolved });
      const fresh = posts.get(post.id);
      ctx.notify('social.post.updated', { post: fresh });
      ctx.json(res, 200, fresh);
    });

    ctx.registerRoute('DELETE', '/api/social/posts/:id', (req, res, params) => {
      const removed = posts.remove(params.id);
      if (removed) ctx.notify('social.post.deleted', { id: params.id });
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });

    // ── Feedback board ────────────────────────────────────────────────────
    // Public on purpose: this is the endpoint the site visitor widget posts to.
    ctx.registerRoute('GET', '/api/social/feedback', (req, res) => {
      const list = [...feedback.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      ctx.json(res, 200, {
        feedback: list,
        open: list.filter((f) => f.status !== 'shipped').length,
      });
    });

    ctx.registerRoute('POST', '/api/social/feedback', async (req, res) => {
      const body = await ctx.readBody(req);
      if (!body.message || !String(body.message).trim()) {
        return ctx.json(res, 400, { error: 'message is required' });
      }
      const item = addFeedback(body);
      ctx.json(res, 201, item);
    });

    ctx.registerRoute('POST', '/api/social/feedback/:id/upvote', (req, res, params) => {
      const item = feedback.get(params.id);
      if (!item) return ctx.json(res, 404, { error: 'feedback not found' });
      feedback.update(item.id, { upvotes: (item.upvotes || 0) + 1 });
      ctx.notify('feedback.updated', { item: feedback.get(item.id) });
      ctx.json(res, 200, feedback.get(item.id));
    });

    ctx.registerRoute('PATCH', '/api/social/feedback/:id', async (req, res, params) => {
      const body = await ctx.readBody(req);
      const item = feedback.get(params.id);
      if (!item) return ctx.json(res, 404, { error: 'feedback not found' });
      const patch = {};
      if (['open', 'planned', 'shipped'].includes(body.status)) patch.status = body.status;
      const fresh = feedback.update(item.id, patch);
      ctx.notify('feedback.updated', { item: fresh });
      ctx.json(res, 200, fresh);
    });

    ctx.registerRoute('POST', '/api/social/feedback/:id/comments', async (req, res, params) => {
      const body = await ctx.readBody(req);
      const item = feedback.get(params.id);
      if (!item) return ctx.json(res, 404, { error: 'feedback not found' });
      if (!body.text || !String(body.text).trim()) return ctx.json(res, 400, { error: 'text is required' });
      const comments = [...(item.comments || []), {
        id: id(), author: { name: 'Admin', avatar: '🫡', color: 'g1' },
        text: String(body.text).trim().slice(0, 1000), at: new Date().toISOString(),
      }];
      const fresh = feedback.update(item.id, { comments });
      ctx.notify('feedback.updated', { item: fresh });
      ctx.json(res, 200, fresh);
    });

    // ── Stories (system health, social-media style) ───────────────────────
    ctx.registerRoute('GET', '/api/social/stories', (req, res) => {
      const all = posts.all();
      const day = 24 * 3600 * 1000;
      const deploys = all.filter((p) => p.kind === 'deploy' && Date.now() - new Date(p.createdAt).getTime() < day).length;
      const openFeedback = feedback.all().filter((f) => f.status !== 'shipped').length;
      const week = 7 * 24 * 3600 * 1000;
      const pendingUpdates = all.filter((p) =>
        p.kind === 'update' && !p.resolved && Date.now() - new Date(p.createdAt).getTime() < week).length;
      const errors = ctx.store.getState('errors24h', null);
      const visitors = ctx.store.getState('visitorsNow', null);
      const uptime = ctx.store.getState('uptime', null);
      ctx.json(res, 200, {
        stories: [
          { id: 'uptime', label: 'Uptime', icon: '🟢', value: uptime === null ? 'Not connected' : uptime + '%', level: uptime === null ? 'info' : 'ok', ring: 'r-info' },
          { id: 'deploys', label: 'Deploys 24h', icon: '🚀', value: String(deploys), level: 'info', ring: 'r-info' },
          { id: 'updates', label: 'Updates', icon: '📦', value: `${pendingUpdates} ready`, level: pendingUpdates > 0 ? 'info' : 'ok', ring: 'r-info' },
          { id: 'feedback', label: 'Feedback', icon: '💬', value: `${openFeedback} open`, level: openFeedback > 3 ? 'warn' : 'ok', ring: openFeedback > 3 ? 'r-warn' : 'r-ok' },
          { id: 'errors', label: 'Errors 24h', icon: '🐞', value: errors === null ? 'Not connected' : String(errors), level: errors === null ? 'info' : errors > 5 ? 'error' : errors > 2 ? 'warn' : 'ok', ring: errors > 2 ? 'r-warn' : 'r-info' },
          { id: 'visitors', label: 'Visitors now', icon: '👥', value: visitors === null ? 'Not connected' : String(visitors), level: 'info', ring: 'r-info' },
        ],
      });
    });

    ctx.registerRoute('GET', '/api/social/trending', (req, res) => {
      const counts = new Map();
      for (const p of posts.all()) for (const t of p.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
      const trending = [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => a.tag.localeCompare(b.tag))
        .slice(0, 6);
      ctx.json(res, 200, { trending });
    });
  },

  destroy() {
    for (const off of unsubs.splice(0)) {
      try { off(); } catch { /* noop */ }
    }
  },
};
