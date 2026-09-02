/**
 * Notifications — client. Two surfaces:
 *
 *  (a) A bell in the topbar (first button in .oa-topbar-actions) with a live
 *      red unread badge. Clicking it opens a 360px dropdown of the newest
 *      notifications; clicking an item marks it read. The bell is re-injected
 *      whenever the shell rewrites the topbar (it re-sets #topbar's innerHTML
 *      on every navigation), via a MutationObserver.
 *
 *  (b) A full Notifications page: All/Unread filters, per-row actions
 *      (mark read, delete), clear-all and an empty state.
 */

const BTN_ID = 'oa-notif-bell';
const POP_ID = 'oa-notifications-pop';

const STYLE = `
.oa-notif-pop {
  position: fixed; width: 360px; max-width: calc(100vw - 20px); z-index: 8000;
  display: none; flex-direction: column; max-height: 460px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(4, 8, 20, 0.28); overflow: hidden;
}
.oa-notif-pop.open { display: flex; animation: oa-notif-in 0.15s ease; }
@keyframes oa-notif-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.oa-notif-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
}
.oa-notif-head h4 { font-size: 13.5px; }
.oa-notif-list { overflow-y: auto; flex: 1; }
.oa-notif-item { display: flex; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
.oa-notif-item:hover { background: var(--panel-2); }
.oa-notif-item.unread { background: var(--accent-soft); }
.oa-notif-item.unread:hover { background: color-mix(in srgb, var(--accent) 14%, var(--panel)); }
.oa-notif-ic { font-size: 17px; line-height: 1.4; flex: 0 0 auto; }
.oa-notif-main { flex: 1; min-width: 0; }
.oa-notif-text { font-size: 13px; line-height: 1.4; word-wrap: break-word; }
.oa-notif-time { font-size: 11px; color: var(--muted); margin-top: 2px; }
.oa-notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 7px; flex: 0 0 auto; opacity: 0; }
.oa-notif-item.unread .oa-notif-dot { opacity: 1; }
.oa-notif-foot {
  display: flex; justify-content: space-between; padding: 8px 14px;
  border-top: 1px solid var(--border); font-size: 12.5px; font-weight: 600;
}
.oa-notif-foot a, .oa-notif-foot button { background: none; border: none; color: var(--accent); padding: 0; font-weight: 600; font-size: 12.5px; }
.oa-notif-bell .oa-badge[hidden] { display: none; }
.oa-notif-empty { padding: 30px 16px; text-align: center; color: var(--muted); font-size: 13px; }
.oa-notif-page-item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.oa-notif-page-item.unread { box-shadow: inset 3px 0 0 var(--accent); background: var(--accent-soft); }
.oa-notif-page-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.oa-notif-filter-row { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.oa-notif-chip {
  border: 1px solid var(--border); background: var(--panel-2); color: var(--muted);
  border-radius: 999px; padding: 4px 12px; font-size: 12.5px; font-weight: 600;
}
.oa-notif-chip.active { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
`;

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'notifications';
    style.textContent = STYLE;
    document.head.appendChild(style);

    let pop = null;
    let popOpen = false;

    /* ── data helpers ────────────────────────────────────────────────────── */
    async function fetchInbox() {
      try { return await OA.api('/api/notifications'); }
      catch { return { items: [], unread: 0 }; }
    }

    function setBadge(unread) {
      const badge = document.querySelector(`#${BTN_ID} .oa-badge`);
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.hidden = !unread;
    }

    /* ── bell button (re-injected on every topbar re-render) ─────────────── */
    function injectBell() {
      const actions = document.querySelector('.oa-topbar-actions');
      if (!actions || document.getElementById(BTN_ID)) return;
      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.className = 'oa-icon-btn';
      btn.type = 'button';
      btn.title = 'Notifications';
      btn.setAttribute('aria-label', 'Notifications');
      btn.innerHTML = `🔔<span class="oa-badge" hidden></span>`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); togglePop(); });
      actions.prepend(btn); // first child of .oa-topbar-actions
      fetchInbox().then(({ unread }) => setBadge(unread));
    }

    /* ── dropdown panel (lives on <body> so topbar wipes can't kill it) ──── */
    function ensurePop() {
      if (pop) return pop;
      pop = document.createElement('div');
      pop.id = POP_ID;
      pop.className = 'oa-notif-pop';
      document.body.appendChild(pop);
      document.addEventListener('mousedown', (e) => {
        if (!popOpen) return;
        if (pop.contains(e.target) || e.target.closest(`#${BTN_ID}`)) return;
        closePop();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popOpen) closePop(); });
      window.addEventListener('hashchange', closePop);
      window.addEventListener('resize', closePop);
      return pop;
    }

    async function togglePop() { popOpen ? closePop() : openPop(); }

    async function openPop() {
      const el = ensurePop();
      const btn = document.getElementById(BTN_ID);
      if (btn) {
        const r = btn.getBoundingClientRect();
        el.style.top = Math.min(r.bottom + 10, window.innerHeight - 120) + 'px';
        el.style.left = Math.max(8, r.right - 360) + 'px';
      }
      popOpen = true;
      el.classList.add('open');
      el.innerHTML = `<div class="oa-notif-empty">Loading…</div>`;
      const { items } = await fetchInbox();
      renderPop(items);
    }

    function closePop() {
      popOpen = false;
      pop?.classList.remove('open');
    }

    function renderPop(items) {
      const el = ensurePop();
      const unread = items.filter((n) => !n.read).length;
      el.innerHTML = `
        <div class="oa-notif-head">
          <h4>🔔 Notifications ${unread ? `<span class="oa-chip info">${unread} unread</span>` : ''}</h4>
        </div>
        <div class="oa-notif-list">
          ${items.length ? items.slice(0, 30).map((n) => `
            <div class="oa-notif-item ${n.read ? '' : 'unread'}" data-id="${OA.esc(n.id)}">
              <span class="oa-notif-ic">${OA.esc(n.icon || '🔔')}</span>
              <span class="oa-notif-main">
                <span class="oa-notif-text">${OA.md(n.text)}</span>
                <div class="oa-notif-time">${OA.esc(n.type || 'info')} · ${OA.timeAgo(n.at)} ago</div>
              </span>
              <span class="oa-notif-dot"></span>
            </div>`).join('')
          : '<div class="oa-notif-empty">Nothing yet — you\'re all caught up 🎉</div>'}
        </div>
        <div class="oa-notif-foot">
          <button data-markall ${unread ? '' : 'disabled'}>Mark all read</button>
          <a href="#/notifications">View all →</a>
        </div>`;
      el.querySelectorAll('.oa-notif-item').forEach((row) =>
        row.addEventListener('click', () => markRead(row.dataset.id)));
      el.querySelector('[data-markall]')?.addEventListener('click', async () => {
        await OA.api('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
        refresh();
      });
    }

    async function markRead(id) {
      try { await OA.api(`/api/notifications/${id}/read`, { method: 'POST' }); } catch { /* noop */ }
      refresh();
    }

    /** Badge + open dropdown + page (via the SSE event) all refresh together. */
    function refresh() {
      fetchInbox().then(({ items, unread }) => {
        setBadge(unread);
        if (popOpen) renderPop(items);
      });
    }

    injectBell();
    const mo = new MutationObserver(() => injectBell());
    const topbar = document.getElementById('topbar');
    if (topbar) mo.observe(topbar, { childList: true, subtree: true });

    /* live badge */
    OA.on('notifications.changed', () => refresh());

    /* ── page ─────────────────────────────────────────────────────────────── */
    OA.registerPage('notifications', {
      mount(el, OA) {
        const state = { filter: 'all' };
        const unsubs = [OA.on('notifications.changed', () => load())];

        async function load() {
          const { items, unread } = await fetchInbox();
          const shown = state.filter === 'unread' ? items.filter((n) => !n.read) : items;
          el.innerHTML = `
            <div class="oa-page-head"><h2>🔔 Notifications</h2>
              <p>Everything happening across your admin — activity, feedback, social posts, plugins and updates.</p></div>
            <div class="oa-notif-filter-row">
              <button class="oa-notif-chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All (${items.length})</button>
              <button class="oa-notif-chip ${state.filter === 'unread' ? 'active' : ''}" data-filter="unread">Unread (${unread})</button>
              <span style="flex:1"></span>
              <button class="oa-btn secondary small" data-clear ${items.length ? '' : 'disabled'}>Clear all</button>
            </div>
            <div class="oa-card" style="padding:6px 10px">
              ${shown.length ? shown.map((n) => `
                <div class="oa-notif-page-item ${n.read ? '' : 'unread'}" data-id="${OA.esc(n.id)}">
                  <span class="oa-notif-ic">${OA.esc(n.icon || '🔔')}</span>
                  <div class="oa-notif-main">
                    <div class="oa-notif-text">${OA.md(n.text)}</div>
                    <div class="oa-notif-time">
                      <span class="oa-chip ${n.read ? '' : 'info'}">${n.read ? 'read' : 'unread'}</span>
                      ${OA.esc(n.type || 'info')} · ${OA.timeAgo(n.at)} ago
                    </div>
                  </div>
                  <div class="oa-notif-page-actions">
                    ${n.read ? '' : `<button class="oa-btn secondary small" data-read>Mark read</button>`}
                    <button class="oa-btn danger small" data-delete>Delete</button>
                  </div>
                </div>`).join('')
              : `<div class="oa-empty" style="padding:48px 20px">
                   <h2>You're all caught up 🎉</h2>
                   <p class="muted">${state.filter === 'unread'
                     ? 'No unread notifications — nice work.'
                     : 'New notifications will appear here as your admin hums along.'}</p>
                 </div>`}
            </div>`;

          el.querySelectorAll('[data-filter]').forEach((chip) =>
            chip.addEventListener('click', () => { state.filter = chip.dataset.filter; load(); }));

          el.querySelectorAll('[data-id]').forEach((row) => {
            const id = row.dataset.id;
            row.querySelector('[data-read]')?.addEventListener('click', () => markRead(id));
            row.querySelector('[data-delete]')?.addEventListener('click', async () => {
              await OA.api(`/api/notifications/${id}`, { method: 'DELETE' }).catch(() => {});
            });
          });

          const clear = el.querySelector('[data-clear]');
          if (clear && !clear.disabled) {
            let armed = false, timer = null;
            clear.addEventListener('click', async () => {
              if (!armed) {
                armed = true;
                clear.textContent = 'Really clear?';
                timer = setTimeout(() => { armed = false; clear.textContent = 'Clear all'; }, 3000);
                return;
              }
              clearTimeout(timer);
              await OA.api('/api/notifications', { method: 'DELETE' }).catch(() => {});
            });
          }
        }

        load();
        return () => unsubs.forEach((off) => off());
      },
    });
  },
};
