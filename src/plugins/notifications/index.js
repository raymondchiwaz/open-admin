'use strict';

/**
 * Notifications — server side. Turns the kernel's event stream into a small
 * persistent inbox (capped at 100 items) with an unread count:
 *
 *   GET    /api/notifications            items (newest first) + unread count
 *   POST   /api/notifications/:id/read   mark one read
 *   POST   /api/notifications/read-all   mark everything read
 *   DELETE /api/notifications/:id        remove one
 *   DELETE /api/notifications            clear the inbox
 *
 * Every mutation notifies `notifications.changed` (with the fresh unread
 * count) so any open browser updates its bell badge live over SSE.
 *
 * Dedupe: several events describe the same thing twice — an `activity` event
 * becomes a Social post, `plugin.enabled` becomes a feed post, etc. Each
 * insert gets a semantic key; a second insert with the same key within a
 * short window is dropped, whichever of the two events arrives first.
 */

const MAX_ITEMS = 100;   // hard cap on the inbox
const TRIM_TO = 80;      // when it overflows, keep only the newest 80
const DEDUPE_WINDOW_MS = 4000;

/** Event unsubscribers for the current activation (drained on destroy). */
let unsubs = [];

module.exports = {
  init(ctx) {
    const inbox = ctx.store.collection('inbox');
    const recentKeys = new Map(); // dedupe key -> inserted at (ms)

    /* ── inbox helpers ─────────────────────────────────────────────────── */

    function unreadCount() {
      return inbox.find((n) => !n.read).length;
    }

    /** Oldest-first storage; when the inbox overflows MAX_ITEMS, keep the
     *  newest TRIM_TO items (replaceAll so no stragglers survive). */
    function trim() {
      const all = [...inbox.all()].sort((a, b) =>
        String(a.at || a.createdAt || '').localeCompare(String(b.at || b.createdAt || '')));
      if (all.length > MAX_ITEMS) inbox.replaceAll(all.slice(all.length - TRIM_TO));
    }

    function remember(key) {
      if (!key) return;
      const now = Date.now();
      for (const [k, at] of recentKeys) if (now - at > DEDUPE_WINDOW_MS) recentKeys.delete(k);
      recentKeys.set(key, now);
    }

    function seen(key) {
      if (!key) return false;
      const at = recentKeys.get(key);
      return at !== undefined && Date.now() - at <= DEDUPE_WINDOW_MS;
    }

    function insert({ type, text, icon, key }) {
      if (seen(key)) return null;
      remember(key);
      const item = inbox.insert({
        type: String(type || 'info'),
        text: String(text || '').slice(0, 300),
        icon: String(icon || '🔔'),
        read: false,
        at: new Date().toISOString(),
      });
      trim();
      ctx.notify('notifications.changed', { unread: unreadCount() });
      return item;
    }

    /* ── event subscriptions ───────────────────────────────────────────── */

    unsubs = [
      // Any plugin/site activity → a notification with its text and icon.
      ctx.events.on('activity', (payload) => {
        const a = payload && payload.activity;
        if (!a || !a.text) return;
        insert({
          type: 'activity',
          text: a.text,
          icon: a.icon || '✨',
          key: `act:${a.source || 'system'}:${a.text}`,
        });
      }),

      // Visitor feedback (also arrives as a social post — deduped via key).
      ctx.events.on('feedback.created', (f) => {
        if (!f) return;
        insert({
          type: 'feedback',
          text: `💬 Feedback from **${f.name || 'a visitor'}**`,
          icon: '💬',
          key: `fb:${f.id}`,
        });
      }),

      ctx.events.on('plugin.enabled', (p) => {
        if (!p) return;
        insert({
          type: 'plugin',
          text: `🧩 Plugin **${p.name || p.id}** was enabled`,
          icon: p.icon || '🧩',
          key: `plug:${p.id}:on`,
        });
      }),

      ctx.events.on('plugin.disabled', (p) => {
        if (!p) return;
        insert({
          type: 'plugin',
          text: `⛔ Plugin **${p.name || p.id}** was disabled`,
          icon: p.icon || '🧩',
          key: `plug:${p.id}:off`,
        });
      }),

      ctx.events.on('update.installed', (u) => {
        if (!u) return;
        insert({
          type: 'update',
          text: `📦 Update installed: **${u.name || u.pluginId}** v${u.version}`,
          icon: '📦',
          key: `upd:${u.pluginId || u.name}:${u.version}`,
        });
      }),

      // Everything posted to the Social feed lands in the inbox too. Posts
      // that mirror the events above carry the same dedupe key; plain posts
      // (announcements, deploys…) get their own per-post key.
      ctx.events.on('social.post.created', (payload) => {
        const post = payload && payload.post;
        if (!post) return;
        const author = (post.author && post.author.name) || 'Someone';
        insert({
          type: 'social',
          text: `📝 ${author}: ${String(post.text || '').slice(0, 140)}`,
          icon: '📝',
          key: postKey(post),
        });
      }),
    ];

    /** Semantic key for a social post, mirroring the direct-event keys. */
    function postKey(post) {
      if (post.kind === 'feedback' && post.feedbackId) return `fb:${post.feedbackId}`;
      const author = post.author || {};
      if (post.kind === 'activity') {
        const pluginId = typeof author.handle === 'string' && author.handle.startsWith('@')
          ? author.handle.slice(1) : null;
        if (pluginId && /^Plugin \*\*.+\*\* was (enabled|disabled)/.test(post.text || '')) {
          return `plug:${pluginId}:${/enabled/.test(post.text) ? 'on' : 'off'}`;
        }
        return `act:${post.source || author.handle || 'system'}:${post.text || ''}`;
      }
      if (post.kind === 'update') {
        const m = /\*\*.+\*\* v([^\s✅]+)/.exec(post.text || '');
        if (post.status && post.status.label && m) return `upd:${post.status.label}:${m[1]}`;
      }
      return `post:${post.id}`;
    }

    /* ── routes ────────────────────────────────────────────────────────── */

    ctx.registerRoute('GET', '/api/notifications', (req, res) => {
      const items = [...inbox.all()].sort((a, b) =>
        String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')));
      ctx.json(res, 200, { items, unread: unreadCount() });
    });

    ctx.registerRoute('POST', '/api/notifications/read-all', (req, res) => {
      for (const item of inbox.find((n) => !n.read)) inbox.update(item.id, { read: true });
      ctx.notify('notifications.changed', { unread: 0 });
      ctx.json(res, 200, { ok: true, unread: 0 });
    });

    ctx.registerRoute('POST', '/api/notifications/:id/read', (req, res, params) => {
      const item = inbox.update(params.id, { read: true });
      if (!item) return ctx.json(res, 404, { error: 'notification not found' });
      ctx.notify('notifications.changed', { unread: unreadCount() });
      ctx.json(res, 200, item);
    });

    ctx.registerRoute('DELETE', '/api/notifications/:id', (req, res, params) => {
      const removed = inbox.remove(params.id);
      if (removed) ctx.notify('notifications.changed', { unread: unreadCount() });
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });

    ctx.registerRoute('DELETE', '/api/notifications', (req, res) => {
      inbox.replaceAll([]);
      ctx.notify('notifications.changed', { unread: 0 });
      ctx.json(res, 200, { ok: true, unread: 0 });
    });

    ctx.log(`Notifications ready — inbox holds ${inbox.all().length} item(s)`);
  },

  /** Detach from the event bus so a disable → enable cycle never double-fires. */
  destroy() {
    for (const off of unsubs.splice(0)) {
      try { off(); } catch { /* noop */ }
    }
  },
};
