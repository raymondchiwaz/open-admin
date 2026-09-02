/** Incidents client — timeline cards with inline updates + a live dashboard widget. */

const STYLE = `
.oa-im-card { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.oa-im-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.oa-im-head h3 { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.oa-im-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); }
.oa-im-timeline { display: flex; flex-direction: column; gap: 0; margin: 2px 0; }
.oa-im-step { display: flex; gap: 12px; position: relative; padding: 0 0 14px; }
.oa-im-step:last-child { padding-bottom: 2px; }
.oa-im-step::before { content: ""; position: absolute; left: 9px; top: 20px; bottom: 0; width: 2px; background: var(--border); }
.oa-im-step:last-child::before { display: none; }
.oa-im-step .oa-im-rail { width: 20px; flex: 0 0 20px; display: flex; justify-content: center; padding-top: 2px; font-size: 12px; }
.oa-im-step .oa-im-body { flex: 1; min-width: 0; }
.oa-im-step .oa-im-body p { margin: 4px 0 0; font-size: 13.5px; }
.oa-im-step .oa-im-body small { color: var(--muted); }
.oa-im-update-form .oa-form-row { margin: 0 0 10px; }
.oa-im-empty { text-align: center; padding: 26px 14px; color: var(--muted); font-size: 13.5px; }
`;

const STATUS_LEVELS = { investigating: 'warn', identified: 'info', monitoring: 'info', resolved: 'ok' };
const SEVERITY_LEVELS = { minor: 'info', major: 'warn', critical: 'error' };

function onceDetached(el, done) {
  const content = document.getElementById('content');
  if (!content) return;
  const mo = new MutationObserver(() => {
    if (!el.isConnected) { mo.disconnect(); done(); }
  });
  mo.observe(content, { childList: true, subtree: true });
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'incident-manager';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page ────────────────────────────────────────────────────────────── */
    OA.registerPage('incidents', {
      mount(el, OA) {
        let unsub = null;

        function severityChip(s) {
          return `<span class="oa-chip ${SEVERITY_LEVELS[s] || 'info'}">${OA.esc(s)}</span>`;
        }

        function statusPill(s) {
          return `<span class="oa-chip ${STATUS_LEVELS[s] || 'info'}">${s === 'resolved' ? '✅ resolved' : OA.esc(s)}</span>`;
        }

        function incidentCard(i) {
          const timeline = [...i.updates].reverse();
          return `
            <div class="oa-card oa-im-card" data-incident="${OA.esc(i.id)}">
              <div class="oa-im-head">
                <h3>${OA.esc(i.title)}</h3>
                ${severityChip(i.severity)}
                ${statusPill(i.status)}
              </div>
              <div class="oa-im-meta">
                <span>🚨 opened ${OA.timeAgo(i.createdAt)} ago</span>
                ${i.resolvedAt ? `<span>✅ resolved ${OA.timeAgo(i.resolvedAt)} ago</span>` : ''}
              </div>
              <div class="oa-im-timeline">
                ${timeline.map((u) => `
                  <div class="oa-im-step">
                    <div class="oa-im-rail">${u.status === 'resolved' ? '✅' : u.status === 'monitoring' ? '👀' : u.status === 'identified' ? '🔍' : '🚨'}</div>
                    <div class="oa-im-body">
                      ${statusPill(u.status)}
                      <p>${OA.esc(u.message)}</p>
                      <small>${OA.timeAgo(u.at)} ago</small>
                    </div>
                  </div>`).join('')}
              </div>
              <div class="oa-im-update-form">
                <div class="oa-form-row">
                  <select class="oa-select" data-status>
                    ${['investigating', 'identified', 'monitoring', 'resolved'].map((s) =>
                      `<option value="${s}" ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                  <input class="oa-input" data-message placeholder="What's the latest? e.g. Failover complete…" maxlength="400">
                  <button class="oa-btn small" data-update style="flex:0 0 auto">Post update</button>
                </div>
              </div>
              <div>
                <button class="oa-btn danger small" data-delete>Delete incident</button>
              </div>
            </div>`;
        }

        function emptyState() {
          return `<div class="oa-card oa-im-empty">
            <div style="font-size:34px;margin-bottom:8px">🛰️</div>
            <strong>No incidents — all quiet</strong>
            <p class="muted">Open one below whenever something breaks; the timeline keeps everyone honest.</p></div>`;
        }

        async function load() {
          const { incidents, totals } = await OA.api('/api/incidents');
          el.innerHTML = `
            <div class="oa-page-head"><h2>🚨 Incidents</h2>
              <p>${totals.active} active · ${totals.critical} critical · ${totals.total} total — updates stream live</p></div>
            <form class="oa-card" id="im-create" style="margin-bottom:16px">
              <h3 style="margin-bottom:4px">Open an incident</h3>
              <div class="oa-form-row">
                <input class="oa-input" name="title" placeholder="What's happening? e.g. Checkout is down" required maxlength="120">
                <select class="oa-select" name="severity" style="flex:0 0 140px">
                  <option value="minor">minor</option>
                  <option value="major" selected>major</option>
                  <option value="critical">critical</option>
                </select>
                <button class="oa-btn" style="flex:0 0 auto">🚨 Open incident</button>
              </div>
            </form>
            ${incidents.length ? incidents.map(incidentCard).join('') : emptyState()}`;

          el.querySelector('#im-create').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
              await OA.api('/api/incidents', {
                method: 'POST',
                body: JSON.stringify({ title: fd.get('title'), severity: fd.get('severity') }),
              });
              OA.toast('🚨 Incident opened — announced in the Social feed', 'error');
              e.target.reset();
              load();
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('[data-incident]').forEach((card) => {
            const id = card.dataset.incident;
            const statusSel = card.querySelector('[data-status]');
            const messageInp = card.querySelector('[data-message]');

            card.querySelector('[data-update]').addEventListener('click', async () => {
              const message = messageInp.value.trim();
              if (!message) return OA.toast('✏️ Write a short update message first', 'info');
              try {
                await OA.api(`/api/incidents/${id}/updates`, {
                  method: 'POST',
                  body: JSON.stringify({ status: statusSel.value, message }),
                });
                OA.toast(statusSel.value === 'resolved'
                  ? '✅ Incident resolved — all-clear posted'
                  : '🔧 Update posted to the timeline', 'success');
                load();
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
            });
            messageInp.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') card.querySelector('[data-update]').click();
            });

            card.querySelector('[data-delete]').addEventListener('click', async () => {
              if (!confirm(`Permanently delete incident "${card.querySelector('h3').textContent}"?`)) return;
              await OA.api(`/api/incidents/${id}`, { method: 'DELETE' });
              OA.toast('🗑️ Incident deleted', 'info');
              load();
            });
          });
        }

        unsub = OA.on('incidents.changed', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('incident-manager', err.message); });

        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: active list, or the all-clear ─────────────────── */
    OA.registerWidget('incidents-active', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const { incidents } = await OA.api('/api/incidents');
          const active = incidents.filter((i) => i.status !== 'resolved');
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${active.length}</span>
              <span class="lbl">🚨 Active incidents</span>
              ${active.length
                ? active.map((i) => `<span class="oa-chip ${SEVERITY_LEVELS[i.severity] || 'info'}">${OA.esc(i.title)}</span>`).join('')
                : '<span class="oa-chip ok">All clear ✅</span>'}
              <a href="#/incidents" style="font-size:13px;font-weight:600">Manage incidents →</a>
            </div>`;
        }

        unsub = OA.on('incidents.changed', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('incident-manager', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
