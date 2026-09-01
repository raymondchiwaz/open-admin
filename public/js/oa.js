/**
 * oa.js — the client kernel. One small object that everything (shell and
 * plugins alike) talks to. Loaded as an ES module; plugin client modules
 * receive it as an argument, so they never need to import it.
 */

const listeners = new Map();   // SSE event type -> Set<fn>

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tiny markdown: **bold**, *em*, #tags, newlines. Everything is escaped. */
function md(text) {
  let out = esc(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
  out = out.replace(/(^|\s)#([\w-]+)/g, '$1<span class="oa-tag">#$2</span>');
  return out.replace(/\n/g, '<br>');
}

function timeAgo(iso) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

function avatar(author, size = 40) {
  const a = author || {};
  return `<div class="oa-avatar ${esc(a.color || 'g4')}" style="--s:${size}px" title="${esc(a.handle || a.name)}">${esc(a.avatar || '🙂')}</div>`;
}

const OA = {
  data: null,
  base: '',
  pages: new Map(),      // path -> { mount(el, oa) -> cleanup? }
  widgets: new Map(),    // widget id -> { mount(el, oa) }
  _cleanup: null,

  async init() {
    this.data = await this.api('/api/bootstrap');
    const sse = new EventSource(this.base + '/api/events/stream');
    sse.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const fn of listeners.get(msg.type) || []) {
        try { fn(msg.payload, msg.type); } catch (err) { console.error('[oa] handler error', err); }
      }
      for (const fn of listeners.get('*') || []) {
        try { fn(msg.payload, msg.type); } catch (err) { console.error('[oa] handler error', err); }
      }
    };
    this.setTheme(localStorage.getItem('oa-theme') || 'light');
  },

  get siteName() { return this.data.siteName; },
  get me() { return this.data.me; },
  get version() { return this.data.version; },

  async api(path, opts = {}) {
    const res = await fetch(this.base + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
    }
    return body;
  },

  /** Subscribe to a server event (or '*' for everything). Returns unsubscriber. */
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },

  navigate(path) { location.hash = '#/' + path; },

  registerPage(path, def) { this.pages.set(path, def); },
  registerWidget(id, def) { this.widgets.set(id, def); },

  widgetsForSlot(slot) {
    return (this.data.widgets?.[slot] || []).map((w) => ({ ...w, def: this.widgets.get(w.id) }));
  },

  /** Find [data-oa-slot] containers and mount contributed widgets into them. */
  fillSlots(root) {
    root.querySelectorAll('[data-oa-slot]').forEach((slotEl) => {
      for (const w of this.widgetsForSlot(slotEl.dataset.oaSlot)) {
        const holder = document.createElement('div');
        holder.className = 'oa-widget';
        holder.dataset.plugin = w.pluginId;
        slotEl.appendChild(holder);
        if (!w.def) {
          holder.innerHTML = this.crashCard(w.pluginId, `No client code registered widget "${w.id}"`);
          continue;
        }
        try {
          w.def.mount(holder, this);
        } catch (err) {
          console.error('[oa] widget crashed:', w.id, err);
          holder.innerHTML = this.crashCard(w.pluginId, err.message);
        }
      }
    });
  },

  crashCard(pluginId, message) {
    return `<div class="oa-crash">
      <strong>⚠️ Plugin "${esc(pluginId)}" crashed</strong>
      <span>${esc(message || 'unknown error')}</span>
      <button onclick="location.hash='#/plugins'">Manage plugins</button>
    </div>`;
  },

  toast(message, level = 'info') {
    const el = document.createElement('div');
    el.className = 'oa-toast ' + level;
    el.innerHTML = message;
    document.getElementById('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 3800);
  },

  setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('oa-theme', theme);
  },

  get theme() { return document.documentElement.dataset.theme || 'light'; },

  toggleTheme() { this.setTheme(this.theme === 'dark' ? 'light' : 'dark'); },

  /* ── shared rendering helpers ─────────────────────────────────────────── */
  esc, md, timeAgo, avatar,

  statusChip(status) {
    if (!status) return '';
    const cls = { ok: 'ok', info: 'info', warn: 'warn', error: 'error' }[status.level] || 'info';
    return `<span class="oa-chip ${cls}">${esc(status.label)}</span>`;
  },

  /* Local ("just me") reaction tracking so reactions toggle. */
  myReactions(postId) {
    try { return JSON.parse(localStorage.getItem('oa-react:' + postId) || '[]'); } catch { return []; }
  },
  toggleMyReaction(postId, emoji) {
    const mine = this.myReactions(postId);
    const i = mine.indexOf(emoji);
    if (i >= 0) mine.splice(i, 1); else mine.push(emoji);
    localStorage.setItem('oa-react:' + postId, JSON.stringify(mine));
    return i < 0;
  },

  quickReactions: ['👍', '❤️', '🔥'],
};

export default OA;
