/** Analytics client — 14-day bar chart, top events, live today counter + dashboard sparkline widget. */

const STYLE = `
.oa-analytics-chart { display: flex; align-items: flex-end; gap: 6px; height: 150px; padding-top: 8px; }
.oa-analytics-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; height: 100%; min-width: 0; }
.oa-analytics-bar { width: 100%; max-width: 30px; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, var(--accent), var(--accent-2)); transition: height 0.4s ease; }
.oa-analytics-col small { font-size: 10px; white-space: nowrap; }
.oa-analytics-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.oa-analytics-row:last-child { border-bottom: none; }
.oa-analytics-row .oa-analytics-name { flex: 0 0 110px; font-weight: 600; }
.oa-analytics-row .oa-analytics-track { flex: 1; height: 8px; border-radius: 6px; background: var(--panel-2); overflow: hidden; }
.oa-analytics-row .oa-analytics-track i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.oa-analytics-row .oa-analytics-count { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.oa-analytics-bump { animation: oa-analytics-bump 0.5s ease; }
@keyframes oa-analytics-bump { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
.oa-analytics-spark { display: flex; align-items: flex-end; gap: 3px; height: 34px; margin: 6px 0 2px; }
.oa-analytics-spark i { flex: 1; border-radius: 3px 3px 1px 1px; background: linear-gradient(180deg, var(--accent), var(--accent-2)); min-height: 3px; }
`;

/** Watch `el` and run `done` once it is detached (widgets have no cleanup hook). */
function onceDetached(el, done) {
  const content = document.getElementById('content');
  if (!content) return;
  const mo = new MutationObserver(() => {
    if (!el.isConnected) { mo.disconnect(); done(); }
  });
  mo.observe(content, { childList: true, subtree: true });
}

function shortDay(day) {
  return day ? day.slice(5) : '—'; // MM-DD
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'analytics';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page ────────────────────────────────────────────────────────────── */
    OA.registerPage('analytics', {
      mount(el, OA) {
        let unsub = null;
        let todayEl = null;

        async function load() {
          const s = await OA.api('/api/analytics/summary');
          const max = Math.max(1, ...s.days.map((d) => d.total));
          const topMax = Math.max(1, ...s.top.map((t) => t.count));
          el.innerHTML = `
            <div class="oa-page-head"><h2>📈 Analytics</h2>
              <p>${s.totalEvents} tracked events across ${s.days.length} days · updates in real time</p></div>
            <div class="oa-grid">
              <div class="oa-card" style="grid-column: span 2">
                <h3 style="margin-bottom:12px">Events — last 14 days</h3>
                <div class="oa-analytics-chart" id="oa-analytics-chart">
                  ${s.days.map((d) => `
                    <div class="oa-analytics-col" title="${OA.esc(d.day)} · ${d.total.toLocaleString()} events">
                      <div class="oa-analytics-bar" style="height:${Math.max(4, Math.round((d.total / max) * 108))}px"></div>
                      <small class="muted">${OA.esc(shortDay(d.day))}</small>
                    </div>`).join('')}
                </div>
                <div class="muted" style="font-size:12px;margin-top:10px">Total across all tracked event names — hover a bar for the exact day.</div>
              </div>
              <div class="oa-card oa-stat">
                <span class="num" id="oa-analytics-today">${s.today.total.toLocaleString()}</span>
                <span class="lbl">⚡ Events today (${OA.esc(shortDay(s.today.day))})</span>
                <span class="oa-chip info">live</span>
                <div style="margin-top:8px">
                  <a href="#/analytics" style="font-size:13px;font-weight:600">Open Analytics →</a>
                </div>
              </div>
            </div>
            <div class="oa-card" style="margin-top:16px">
              <h3 style="margin-bottom:8px">Top events</h3>
              ${s.top.length ? s.top.map((t) => `
                <div class="oa-analytics-row">
                  <span class="oa-analytics-name">${OA.esc(t.name)}</span>
                  <div class="oa-analytics-track"><i style="width:${Math.round((t.count / topMax) * 100)}%"></i></div>
                  <span class="oa-analytics-count">${t.count.toLocaleString()}</span>
                </div>`).join('') :
                '<div class="muted">Nothing tracked yet — POST an event to <code>/api/analytics/track</code>.</div>'}
            </div>`;

          todayEl = el.querySelector('#oa-analytics-today');
        }

        // Live counter: tracked events always land on today, so every
        // broadcast bumps the "today" stat — wherever it came from.
        unsub = OA.on('analytics.tracked', () => {
          if (!todayEl) return;
          todayEl.textContent = (Number(todayEl.textContent.replace(/[^\d]/g, '')) + 1).toLocaleString();
          todayEl.classList.remove('oa-analytics-bump');
          void todayEl.offsetWidth;
          todayEl.classList.add('oa-analytics-bump');
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('analytics', err.message); });

        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: today + 7-day sparkline ───────────────────────── */
    OA.registerWidget('analytics-overview', {
      mount(el, OA) {
        let unsub = null;
        let num = null;

        async function load() {
          const s = await OA.api('/api/analytics/summary');
          const seven = s.days.slice(-7);
          const max = Math.max(1, ...seven.map((d) => d.total));
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num" data-today>${s.today.total.toLocaleString()}</span>
              <span class="lbl">📈 Events today</span>
              <div class="oa-analytics-spark">
                ${seven.map((d) => `<i title="${OA.esc(d.day)} · ${d.total}" style="height:${Math.max(8, Math.round((d.total / max) * 100))}%"></i>`).join('')}
              </div>
              <a href="#/analytics" style="font-size:13px;font-weight:600">7-day trend →</a>
            </div>`;
          num = el.querySelector('[data-today]');
        }

        unsub = OA.on('analytics.tracked', () => {
          if (!num) return;
          num.textContent = ((parseInt(num.textContent.replace(/[^\d]/g, ''), 10) || 0) + 1).toLocaleString();
          num.classList.remove('oa-analytics-bump');
          void num.offsetWidth;
          num.classList.add('oa-analytics-bump');
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('analytics', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
