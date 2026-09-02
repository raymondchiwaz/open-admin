/** Health Checks client — add/manage HTTP checks with live status cards + a dashboard widget. */

const STYLE = `
.oa-hc-card { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.oa-hc-head { display: flex; align-items: center; gap: 9px; }
.oa-hc-head strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oa-hc-dot { font-size: 20px; line-height: 1; }
.oa-hc-url { font-size: 12.5px; color: var(--muted); word-break: break-all; }
.oa-hc-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.oa-hc-bar { height: 8px; border-radius: 6px; background: var(--panel-2); overflow: hidden; }
.oa-hc-bar i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--ok), var(--accent)); transition: width 0.4s ease; }
.oa-hc-bar i.warn { background: linear-gradient(90deg, var(--warn), var(--danger)); }
.oa-hc-actions { display: flex; gap: 8px; margin-top: 2px; }
.oa-hc-actions .oa-btn { flex: 1; justify-content: center; }
.oa-hc-empty { text-align: center; padding: 26px 14px; color: var(--muted); font-size: 13.5px; }
`;

/** Re-render a page/widget body whenever a result lands (widgets have no cleanup hook). */
function onceDetached(el, done) {
  const content = document.getElementById('content');
  if (!content) return;
  const mo = new MutationObserver(() => {
    if (!el.isConnected) { mo.disconnect(); done(); }
  });
  mo.observe(content, { childList: true, subtree: true });
}

function fmtMs(ms) { return ms == null ? '—' : Math.round(ms) + ' ms'; }

function statusChip(c) {
  if (!c.latest) return '<span class="oa-chip info">PENDING</span>';
  return c.latest.ok
    ? '<span class="oa-chip ok">🟢 UP</span>'
    : '<span class="oa-chip error">🔴 DOWN</span>';
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'health-checks';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* Toast once per check on the ok → down edge, wherever the admin is. */
    const knownDown = new Set();
    OA.on('health-checks.updated', (evt) => {
      if (evt && evt.ok === false && !knownDown.has(evt.checkId)) {
        knownDown.add(evt.checkId);
        OA.toast(`🔴 <b>${OA.esc(evt.name || 'Check')}</b> is DOWN`, 'error');
      } else if (evt && evt.ok === true && knownDown.has(evt.checkId)) {
        knownDown.delete(evt.checkId);
        OA.toast(`🟢 <b>${OA.esc(evt.name || 'Check')}</b> recovered`, 'success');
      } else if (evt && evt.reason === 'deleted') {
        knownDown.delete(evt.checkId);
      }
    });

    /* ── Page ────────────────────────────────────────────────────────────── */
    OA.registerPage('health-checks', {
      mount(el, OA) {
        let unsub = null;

        function cards(checks) {
          if (!checks.length) {
            return `<div class="oa-card oa-hc-empty">
              <div style="font-size:34px;margin-bottom:8px">🛰️</div>
              <strong>No checks yet</strong>
              <p class="muted">Add your first endpoint below — results stream in live.</p></div>`;
          }
          return checks.map((c) => `
            <div class="oa-card oa-hc-card" data-check="${OA.esc(c.id)}">
              <div class="oa-hc-head">
                <span class="oa-hc-dot">${c.latest ? (c.latest.ok ? '🟢' : '🔴') : '⚪'}</span>
                <strong title="${OA.esc(c.name)}">${OA.esc(c.name)}</strong>
                ${statusChip(c)}
              </div>
              <div class="oa-hc-url" title="${OA.esc(c.url)}">${OA.esc(c.url)}</div>
              <div class="oa-hc-meta">
                <span>⚡ ${fmtMs(c.latest && c.latest.ms)}</span>
                <span>🕒 ${c.latest ? OA.timeAgo(c.latest.at) + ' ago' : 'never run'}</span>
                <span>✅ ${c.rate}% (20 runs)</span>
                <span>⏱ every ${OA.esc(String(c.intervalSec))}s</span>
              </div>
              <div class="oa-hc-bar"><i class="${c.rate < 100 ? 'warn' : ''}" style="width:${Math.min(100, c.rate)}%"></i></div>
              <div class="oa-hc-actions">
                <button class="oa-btn secondary small" data-run>▶ Run now</button>
                <button class="oa-btn danger small" data-del>Delete</button>
              </div>
            </div>`).join('');
        }

        async function load() {
          const { checks, totals } = await OA.api('/api/health-checks');
          el.innerHTML = `
            <div class="oa-page-head"><h2>📡 Health Checks</h2>
              <p>${totals.total} endpoint${totals.total === 1 ? '' : 's'} · ${totals.down} currently down · results stream live</p></div>
            <form class="oa-card" id="hc-add" style="margin-bottom:16px">
              <h3 style="margin-bottom:4px">Add a check</h3>
              <div class="oa-form-row">
                <input class="oa-input" name="name" placeholder="Name (e.g. API)" required minlength="1" maxlength="80">
                <input class="oa-input" name="url" placeholder="https://example.com/health" required>
                <select class="oa-select" name="expectStatus" style="flex:0 0 130px" title="Expected HTTP status">
                  ${[200, 201, 204, 301, 302, 401, 403, 404, 503].map((s) =>
                    `<option value="${s}" ${s === 200 ? 'selected' : ''}>Expect ${s}</option>`).join('')}
                </select>
                <select class="oa-select" name="intervalSec" style="flex:0 0 150px" title="Check interval">
                  ${[[30, 'every 30s'], [60, 'every 1m'], [300, 'every 5m'], [900, 'every 15m'], [1800, 'every 30m'], [3600, 'every 1h']]
                    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
                <button class="oa-btn" style="flex:0 0 auto">+ Add check</button>
              </div>
            </form>
            <div class="oa-grid" id="hc-cards">${cards(checks)}</div>`;

          el.querySelector('#hc-add').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
              await OA.api('/api/health-checks', {
                method: 'POST',
                body: JSON.stringify({
                  name: fd.get('name'),
                  url: fd.get('url'),
                  expectStatus: Number(fd.get('expectStatus')),
                  intervalSec: Number(fd.get('intervalSec')),
                }),
              });
              OA.toast('📡 Check added — first probe fired immediately', 'success');
              e.target.reset();
              load();
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('[data-check]').forEach((card) => {
            const id = card.dataset.check;
            card.querySelector('[data-run]').addEventListener('click', async () => {
              const btn = card.querySelector('[data-run]');
              btn.disabled = true; btn.textContent = '⏳ Probing…';
              try {
                await OA.api(`/api/health-checks/${id}/run`, { method: 'POST' });
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
                btn.disabled = false; btn.textContent = '▶ Run now';
              }
              // a broadcast will re-render the card; refresh anyway in case.
              load().catch(() => {});
            });
            card.querySelector('[data-del]').addEventListener('click', async () => {
              if (!confirm(`Delete check "${card.querySelector('strong').textContent}"?`)) return;
              await OA.api(`/api/health-checks/${id}`, { method: 'DELETE' });
              OA.toast('🗑️ Check removed', 'info');
              load();
            });
          });
        }

        unsub = OA.on('health-checks.updated', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('health-checks', err.message); });

        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: X of Y healthy + failing names ────────────────── */
    OA.registerWidget('health-overview', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const { checks, totals } = await OA.api('/api/health-checks');
          const down = checks.filter((c) => c.latest && !c.latest.ok);
          const healthy = totals.total - down.length;
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${healthy}<small style="font-size:15px;color:var(--muted)">/${totals.total}</small></span>
              <span class="lbl">📡 Health checks up</span>
              ${down.length
                ? `<span class="oa-chip error">🔴 ${OA.esc(down.map((d) => d.name).join(', '))}</span>`
                : `<span class="oa-chip ok">all systems go</span>`}
              <a href="#/health-checks" style="font-size:13px;font-weight:600">Open Health Checks →</a>
            </div>`;
        }

        unsub = OA.on('health-checks.updated', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('health-checks', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
