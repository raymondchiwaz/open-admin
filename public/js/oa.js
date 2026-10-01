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
  const initials = (a.name || 'Admin').split(/[\s-]+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return `<div class="oa-avatar ${esc(a.color || 'g4')}" style="--s:${size}px" title="${esc(a.handle || a.name)}">${esc(initials)}</div>`;
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
    this.connection = 'connecting';
    const connectionChanged = (state) => {
      this.connection = state;
      for (const fn of listeners.get('connection.changed') || []) fn(state);
    };
    sse.onopen = () => connectionChanged('live');
    sse.onerror = () => connectionChanged('reconnecting');
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
    let theme = 'light';
    try { theme = localStorage.getItem('oa-theme') || theme; } catch {}
    this.setTheme(theme);
    this._sse = sse;
    window.addEventListener('pagehide', () => sse.close());
  },

  get siteName() { return this.data.siteName; },
  get me() { return this.data.me; },
  get version() { return this.data.version; },

  async api(path, opts = {}) {
    const res = await fetch(this.base + path, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) this.toast('Your session has expired. Sign in again, then refresh.', 'error');
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
      <strong>Unable to load ${esc(pluginId)}</strong>
      <span>${esc(message || 'unknown error')}</span>
      <button class="oa-btn secondary" onclick="location.reload()">Try again</button>
    </div>`;
  },

  toast(message, level = 'info') {
    const el = document.createElement('div');
    el.className = 'oa-toast ' + level;
    el.textContent = message;
    el.setAttribute('role', level === 'error' ? 'alert' : 'status');
    document.getElementById('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 3800);
  },

  setTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('oa-theme', theme); } catch {}
  },

  get theme() { return document.documentElement.dataset.theme || 'light'; },

  toggleTheme() { this.setTheme(this.theme === 'dark' ? 'light' : 'dark'); },

  /* ── shared rendering helpers ─────────────────────────────────────────── */
  esc, md, timeAgo, avatar,
  icon(name, size = 18) {
    return `<img class="oa-icon" src="${this.base}/oa/icons/${esc(name)}.svg" width="${size}" height="${size}" alt="" aria-hidden="true">`;
  },

  statusChip(status) {
    if (!status) return '';
    const cls = { ok: 'ok', info: 'info', warn: 'warn', error: 'error' }[status.level] || 'info';
    return `<span class="oa-chip ${cls}">${esc(status.label)}</span>`;
  },

  /* ── compact / mobile helpers for plugin authors ────────────────────── */

  /** True when the admin is in its compact (drawer-nav) layout. */
  isCompact() {
    return window.matchMedia('(max-width: 900px)').matches;
  },

  /** Wrap a `<table class="oa-table">…` string so it scrolls horizontally on phones. */
  tableWrap(tableHtml) {
    return `<div class="oa-table-wrap">${tableHtml}</div>`;
  },

  /** Improve contributed tables without requiring each plugin to rebuild its UI. */
  enhanceTables(root) {
    for (const table of root.querySelectorAll('table.oa-table:not([data-oa-enhanced])')) {
      table.dataset.oaEnhanced = 'true';
      const rows = [...(table.tBodies[0]?.rows || [])];
      // Preserve a plugin's own empty-state row.
      if (!rows.length) {
        const row = table.tBodies[0]?.insertRow();
        if (row) { const cell = row.insertCell(); cell.colSpan = table.tHead?.rows[0]?.cells.length || 1; cell.className = 'oa-table-empty'; cell.textContent = 'No records yet.'; }
        continue;
      }
      if (rows.length === 1 && rows[0].cells[0]?.colSpan > 1) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'oa-table-wrap';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      const title = table.closest('.oa-card')?.querySelector('h3')?.textContent || 'Records';
      wrapper.setAttribute('aria-label', title + ' table');
      table.before(wrapper);
      wrapper.append(table);
      const toolbar = document.createElement('div');
      toolbar.className = 'oa-table-toolbar';
      toolbar.innerHTML = `<label>Search loaded rows<input class="oa-input" type="search" placeholder="Search ${esc(title.toLowerCase())}"></label><span role="status" aria-live="polite"></span>`;
      wrapper.before(toolbar);
      const footer = document.createElement('div');
      footer.className = 'oa-table-footer';
      footer.innerHTML = '<button class="oa-btn secondary small" type="button">Previous</button><span></span><button class="oa-btn secondary small" type="button">Next</button>';
      wrapper.after(footer);
      const input = toolbar.querySelector('input');
      const status = toolbar.querySelector('[role="status"]');
      const [prev, next] = footer.querySelectorAll('button');
      const texts = rows.map(row => row.textContent.toLocaleLowerCase());
      const empty = document.createElement('tr');
      empty.innerHTML = `<td colspan="${table.tHead?.rows[0]?.cells.length || 1}" class="oa-table-empty">No matching records. Try another search.</td>`;
      table.tBodies[0].append(empty);
      let page = 0;
      const update = () => {
        const query = input.value.trim().toLocaleLowerCase();
        const matching = rows.filter((row, i) => texts[i].includes(query));
        const pages = Math.max(1, Math.ceil(matching.length / 25));
        page = Math.min(page, pages - 1);
        const visible = new Set(matching.slice(page * 25, (page + 1) * 25));
        rows.forEach(row => { row.hidden = !visible.has(row); });
        empty.hidden = matching.length > 0;
        status.textContent = `${matching.length} of ${rows.length} loaded records`;
        footer.querySelector('span').textContent = `Page ${page + 1} of ${pages}`;
        prev.disabled = page === 0;
        next.disabled = page >= pages - 1;
        footer.hidden = pages === 1;
      };
      input.addEventListener('input', () => { page = 0; update(); });
      prev.addEventListener('click', () => { page--; update(); });
      next.addEventListener('click', () => { page++; update(); });
      update();
    }
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
