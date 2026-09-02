/** Activity Log client — filterable, live-updating event table + dashboard widget. */

const STYLE = `
.oa-alog-type { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; white-space: nowrap; }
.oa-alog-preview { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); }
.oa-alog-preview, .oa-alog-time { max-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oa-alog-time { width: 62px; }
.oa-alog-live { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); margin-right: 6px; animation: oa-alog-pulse 1.8s ease infinite; }
@keyframes oa-alog-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.oa-alog-item { padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 13px; display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.oa-alog-item:last-child { border-bottom: none; }
.oa-alog-item code { flex: 0 0 auto; }
`;

function preview(payload) {
  const s = String(payload || '');
  return s.length > 120 ? s.slice(0, 120) + '…' : s || '{}';
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'activity-log';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page ────────────────────────────────────────────────────────────── */
    OA.registerPage('activity-log', {
      mount(el, OA) {
        let unsub = null;
        let filter = '';
        let limit = 50;
        const seen = new Set(); // dedupe rows that arrived via SSE + fetch

        function rowHtml(e) {
          const at = e.at || e.createdAt || new Date().toISOString();
          const key = at + '|' + e.type;
          seen.add(key);
          return `
            <tr data-key="${key}">
              <td class="oa-alog-time muted" title="${OA.esc(at)}">${OA.timeAgo(at)}</td>
              <td><code class="oa-alog-type">${OA.esc(e.type)}</code></td>
              <td class="oa-alog-preview" title="${OA.esc(e.payload)}">${OA.esc(preview(e.payload))}</td>
            </tr>`;
        }

        function emptyRow(msg) {
          return `<tr><td colspan="3" class="muted" style="padding:26px 10px;text-align:center">${msg}</td></tr>`;
        }

        async function load(appendToTop) {
          const [listRes, typesRes] = await Promise.all([
            OA.api(`/api/activity-log?type=${encodeURIComponent(filter)}&limit=${limit}`),
            OA.api('/api/activity-log/types'),
          ]);
          const tbody = el.querySelector('#oa-alog-tbody');
          if (!tbody) return;
          tbody.innerHTML = listRes.events.length
            ? listRes.events.map(rowHtml).join('')
            : emptyRow('No events yet — activity will appear here live as plugins emit events.');
          const head = el.querySelector('#oa-alog-count');
          if (head) head.textContent = `${listRes.total.toLocaleString()} events logged`;
          const typesSel = el.querySelector('#oa-alog-types');
          if (typesSel && typesRes.types.length) {
            const current = filter;
            typesSel.innerHTML =
              `<option value="">All types</option>` +
              typesRes.types.map((t) => `<option value="${OA.esc(t.type)}">${OA.esc(t.type)} (${t.count})</option>`).join('');
            typesSel.value = current;
          }
          if (appendToTop) tbody.scrollIntoView({ block: 'nearest' });
        }

        el.innerHTML = `
          <div class="oa-page-head"><h2>📜 Activity Log</h2>
            <p><span class="oa-alog-live"></span><span id="oa-alog-count">…</span></p></div>
          <div class="oa-card" style="padding:14px">
            <div class="oa-form-row" style="margin:0">
              <select class="oa-select" id="oa-alog-types" style="max-width:320px">
                <option value="">All types</option>
              </select>
              <select class="oa-select" id="oa-alog-limit" style="max-width:160px">
                <option value="25">25 rows</option>
                <option value="50" selected>50 rows</option>
                <option value="100">100 rows</option>
                <option value="250">250 rows</option>
              </select>
              <button class="oa-btn secondary" id="oa-alog-refresh" style="flex:0 0 auto">↻ Refresh</button>
            </div>
          </div>
          <div class="oa-card" style="margin-top:14px;padding:6px 10px;overflow:auto">
            <table class="oa-table">
              <thead><tr><th>Time</th><th>Type</th><th>Payload</th></tr></thead>
              <tbody id="oa-alog-tbody"><tr><td colspan="3" class="muted" style="padding:26px 10px;text-align:center">Loading…</td></tr></tbody>
            </table>
          </div>`;

        el.querySelector('#oa-alog-types').addEventListener('change', (e) => { filter = e.target.value; load(); });
        el.querySelector('#oa-alog-limit').addEventListener('change', (e) => { limit = Number(e.target.value); load(); });
        el.querySelector('#oa-alog-refresh').addEventListener('click', () => load());

        // Live prepend: every event the browser sees over SSE shows up instantly.
        unsub = OA.on('*', (payload, type) => {
          if (!type) return;
          if (filter && type !== filter) return; // respect the active filter
          const at = new Date().toISOString();
          const key = at + '|' + type;
          if (seen.has(key)) return;
          const tbody = el.querySelector('#oa-alog-tbody');
          if (!tbody) return;
          const empty = tbody.querySelector('tr[colspan]');
          if (empty) empty.remove();
          tbody.insertAdjacentHTML('afterbegin', rowHtml({ type, payload: JSON.stringify(payload), at }));
          while (tbody.children.length > limit) tbody.lastElementChild.remove();
          const head = el.querySelector('#oa-alog-count');
          if (head && /(\d[\d,]*)/.test(head.textContent)) {
            head.textContent = (parseInt(head.textContent.replace(/[^\d]/g, ''), 10) + 1).toLocaleString() + ' events logged';
          }
          seen.add(key);
          if (seen.size > 5000) seen.clear();
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('activity-log', err.message); });

        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: last 5 events, live ───────────────────────────── */
    OA.registerWidget('activity-log-recent', {
      mount(el, OA) {
        let unsub = null;

        function itemHtml(type, payload, at) {
          return `<div class="oa-alog-item" title="${OA.esc(at)}">
            <code class="oa-alog-type">${OA.esc(type)}</code>
            <span class="oa-alog-preview" style="flex:1">${OA.esc(preview(payload))}</span>
            <span class="muted" style="flex:0 0 auto;font-size:12px">${OA.timeAgo(at)}</span>
          </div>`;
        }

        async function load() {
          const { events } = await OA.api('/api/activity-log?limit=5');
          el.innerHTML = `
            <div class="oa-card">
              <h3 style="margin-bottom:8px">📜 Latest activity</h3>
              <div data-list>
                ${events.length
                  ? events.map((e) => itemHtml(e.type, e.payload, e.at || e.createdAt)).join('')
                  : '<div class="muted" style="padding:8px 0">Quiet so far — events will appear here live.</div>'}
              </div>
              <a href="#/activity-log" style="font-size:13px;font-weight:600;display:inline-block;margin-top:8px">Full log →</a>
            </div>`;
        }

        unsub = OA.on('*', (payload, type) => {
          if (!type) return;
          const list = el.querySelector('[data-list]');
          if (!list) return;
          const first = list.querySelector('.oa-alog-item');
          list.insertAdjacentHTML('afterbegin', itemHtml(type, JSON.stringify(payload), new Date().toISOString()));
          const items = list.querySelectorAll('.oa-alog-item');
          if (items.length > 5) items[5].remove();
          if (first) first.style.background = 'var(--accent-soft)';
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('activity-log', err.message); });

        // Widgets get no cleanup hook from the shell — unsubscribe on detach.
        const content = document.getElementById('content');
        const mo = new MutationObserver(() => {
          if (!el.isConnected) { mo.disconnect(); if (unsub) unsub(); }
        });
        if (content) mo.observe(content, { childList: true, subtree: true });
      },
    });
  },
};
