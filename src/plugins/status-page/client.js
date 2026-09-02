/** Status Page client — admin page explaining the public page + a live preview of what it shares. */

const STYLE = `
.oa-sp-preview-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13.5px; }
.oa-sp-preview-row:last-child { border-bottom: none; }
.oa-sp-preview-row .oa-sp-preview-name { flex: 1; font-weight: 600; overflow-wrap: anywhere; }
.oa-sp-overall { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border); background: var(--panel-2); margin-bottom: 12px; font-size: 14px; }
.oa-sp-overall b { font-size: 15px; }
.oa-sp-linked { font-size: 13.5px; font-weight: 600; }
`;

const SEV_LEVEL = { minor: 'info', major: 'warn', critical: 'error' };
const LEVEL_LABEL = {
  operational: { text: 'All systems operational', cls: 'ok', dot: '🟢' },
  degraded: { text: 'Partial degradation', cls: 'warn', dot: '🟡' },
  outage: { text: 'Major outage', cls: 'error', dot: '🔴' },
};

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'status-page';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('status-page', {
      mount(el, OA) {
        let timer = null;

        async function load() {
          let status = null;
          try { status = await OA.api('/api/status'); } catch { /* status api still works with other plugins off */ }

          const meta = status ? (LEVEL_LABEL[status.overall] || LEVEL_LABEL.operational) : null;
          const compRows = (status && status.components && status.components.length)
            ? status.components.map((c) => `
              <div class="oa-sp-preview-row">
                <span>${c.level === 'error' ? '🔴' : c.level === 'warn' ? '🟡' : '🟢'}</span>
                <span class="oa-sp-preview-name">${OA.esc(c.name)}</span>
                <span class="muted">${c.ms != null ? Math.round(c.ms) + ' ms' : 'no data'}</span>
              </div>`).join('')
            : '<p class="muted" style="font-size:13px">No health checks configured — the page reports the admin panel itself.</p>';

          const incRows = (status && status.activeIncidents && status.activeIncidents.length)
            ? status.activeIncidents.map((i) => `
              <div class="oa-sp-preview-row">
                <span class="oa-chip ${SEV_LEVEL[i.severity] || 'info'}">${OA.esc(i.severity)}</span>
                <span class="oa-sp-preview-name">${OA.esc(i.title)}</span>
                <span class="muted">${OA.esc(i.status)}</span>
              </div>`).join('')
            : '<p class="muted" style="font-size:13px">No active incidents — all clear.</p>';

          el.innerHTML = `
            <div class="oa-page-head"><h2>🌍 Status Page</h2>
              <p>A fully public page for your visitors — no admin session needed.</p></div>
            <div class="oa-grid">
              <div class="oa-card" style="grid-column: span 2">
                <h3 style="margin-bottom:10px">Public page</h3>
                <p style="margin:0 0 14px">Visitors see a self-contained status page (inline CSS only) that auto-refreshes
                  every 30 seconds. The data comes from the <b>Health Checks</b> and <b>Incidents</b> plugins —
                  with them disabled the page still works and reports Open Admin itself as operational.</p>
                <a class="oa-btn" href="/status-page" target="_blank" rel="noopener">Open public page ↗</a>
                <p class="muted" style="margin:12px 0 0;font-size:12.5px">
                  URL: <code>/status-page</code> · Machine-readable feed at <code>/api/status</code> · Both are
                  authenticated-session exempt.</p>
              </div>
              <div class="oa-card">
                <h3 style="margin-bottom:10px">What it shares right now</h3>
                ${meta
                  ? `<div class="oa-sp-overall"><span style="font-size:22px">${meta.dot}</span>
                      <div><b>${meta.text}</b>
                        <p class="muted" style="margin:0;font-size:12.5px">Generated ${status.generatedAt ? OA.timeAgo(status.generatedAt) + ' ago' : ''}</p>
                      </div></div>`
                  : '<div class="muted" style="font-size:13px">Status feed unavailable.</div>'}
                <h3 style="margin:8px 0 4px;font-size:13.5px">Components</h3>
                ${compRows}
                <h3 style="margin:14px 0 4px;font-size:13.5px">Active incidents</h3>
                ${incRows}
              </div>
            </div>`;
        }

        load().catch((err) => { el.innerHTML = OA.crashCard('status-page', err.message); });
        timer = setInterval(() => load().catch(() => {}), 30000);

        return () => { if (timer) clearInterval(timer); };
      },
    });
  },
};
