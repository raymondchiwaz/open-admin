/** Webhooks client — add hooks, toggle, test, watch deliveries live. */

const STYLE = `
.oa-webhooks-hook-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: var(--panel-2); }
.oa-webhooks-url { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; word-break: break-all; }
.oa-webhooks-events { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
`;

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'webhooks';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('webhooks', {
      mount(el, OA) {
        let unsub = null;
        let loadTimer = null;

        async function load() {
          const data = await OA.api('/api/webhooks');
          renderHooks(data.hooks || []);
          renderDeliveries(data.deliveries || []);
        }

        function renderHooks(hooks) {
          const holder = el.querySelector('#oa-webhooks-hooks');
          holder.innerHTML = hooks.length ? hooks.map((h) => `
            <div class="oa-webhooks-hook-card" data-id="${OA.esc(h.id)}">
              <div style="display:flex;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                  <div class="oa-webhooks-url">${OA.esc(h.url)}</div>
                  <div class="oa-webhooks-events">
                    ${h.events.map((t) => `<span class="oa-pill">${OA.esc(t)}</span>`).join('')}
                  </div>
                  <div class="muted" style="font-size:12.5px;margin-top:8px">
                    ${h.stats?.delivered ?? 0} delivered · ${h.stats?.failed ?? 0} failed
                    ${h.stats?.lastAt ? ` · last ${OA.timeAgo(h.stats.lastAt)} ago` : ' · never fired yet'}
                  </div>
                </div>
                <label class="oa-switch" title="Deliveries ${h.active ? 'on' : 'off'}">
                  <input type="checkbox" data-toggle ${h.active ? 'checked' : ''}>
                  <span class="track"></span>
                </label>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
                ${h.stats?.lastStatus != null ? `<span class="oa-chip ${h.stats.lastStatus >= 200 && h.stats.lastStatus < 400 ? 'ok' : 'error'}">last status ${h.stats.lastStatus}</span>` : '<span class="oa-chip info">waiting</span>'}
                <span class="oa-chip ${h.active ? 'ok' : 'error'}" style="margin-right:auto">${h.active ? 'active' : 'paused'}</span>
                <button class="oa-btn secondary small" data-test>Send test</button>
                <button class="oa-btn danger small" data-remove>Delete</button>
              </div>
            </div>`).join('') : `
            <div class="oa-card" style="margin-top:0">
              <div class="muted" style="padding:10px 2px">
                No webhooks yet — add one above to forward events like <code>activity</code>, <code>plugin.enabled</code> or any custom event.
              </div>
            </div>`;

          holder.querySelectorAll('[data-id]').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('[data-toggle]').addEventListener('change', async (e) => {
              try {
                await OA.api(`/api/webhooks/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ active: e.target.checked }),
                });
                OA.toast(e.target.checked ? '🪝 Webhook activated' : '🪝 Webhook paused', 'info');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
              load();
            });
            card.querySelector('[data-test]').addEventListener('click', async () => {
              const btn = card.querySelector('[data-test]');
              btn.disabled = true;
              try {
                const r = await OA.api(`/api/webhooks/${id}/test`, { method: 'POST' });
                OA.toast(r.delivery.ok ? `✅ Test delivery — ${r.delivery.status} in ${r.delivery.ms}ms` : `⚠️ Test delivery failed (${r.delivery.status || 'timeout'})`, r.delivery.ok ? 'success' : 'error');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
              btn.disabled = false;
              load();
            });
            card.querySelector('[data-remove]').addEventListener('click', async () => {
              if (!confirm('Delete this webhook? Past deliveries are removed too.')) return;
              await OA.api(`/api/webhooks/${id}`, { method: 'DELETE' });
              OA.toast('🗑️ Webhook deleted', 'info');
              load();
            });
          });
        }

        function renderDeliveries(deliveries) {
          const holder = el.querySelector('#oa-webhooks-deliveries');
          holder.innerHTML = deliveries.length ? `
            <table class="oa-table">
              <thead><tr><th>Event</th><th>Hook</th><th>Status</th><th>Time</th><th>When</th></tr></thead>
              <tbody>
                ${deliveries.map((d) => `
                  <tr>
                    <td><code>${OA.esc(d.event)}</code></td>
                    <td class="muted" style="font-size:12.5px">${OA.esc(d.hookUrl || d.hookId)}</td>
                    <td><span class="oa-chip ${d.ok ? 'ok' : 'error'}">${d.ok ? d.status : (d.status || 'timeout')}</span></td>
                    <td class="muted">${d.ms} ms</td>
                    <td class="muted" title="${OA.esc(d.at)}">${OA.timeAgo(d.at)} ago</td>
                  </tr>`).join('')}
              </tbody>
            </table>` : '<div class="muted">No deliveries yet — hook events appear here live.</div>';
        }

        el.innerHTML = `
          <div class="oa-page-head"><h2>🪝 Webhooks</h2>
            <p>Every event (including ones posted to <code>/api/events</code>) is delivered as signed JSON to matching endpoints.</p></div>

          <form class="oa-card" id="oa-webhooks-form" style="padding:16px">
            <h3 style="margin-bottom:10px">Add a webhook</h3>
            <div class="oa-form-row" style="margin:0">
              <input class="oa-input" name="url" type="url" placeholder="https://api.example.com/hooks/oa" required>
              <input class="oa-input" name="events" placeholder="* or comma separated (e.g. activity, plugin.enabled)">
              <button class="oa-btn" style="flex:0 0 auto">+ Add</button>
            </div>
          </form>

          <div id="oa-webhooks-hooks"></div>

          <div class="oa-card" style="margin-top:16px">
            <h3 style="margin-bottom:8px">Recent deliveries <span class="muted" style="font-weight:400;font-size:12px">(last 20)</span></h3>
            <div id="oa-webhooks-deliveries"></div>
          </div>`;

        el.querySelector('#oa-webhooks-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await OA.api('/api/webhooks', {
              method: 'POST',
              body: JSON.stringify({ url: fd.get('url'), events: fd.get('events') }),
            });
            OA.toast('🪝 Webhook registered', 'success');
            e.target.reset();
          } catch (err) {
            OA.toast('⚠️ ' + OA.esc(err.message), 'error');
          }
          load();
        });

        // Live: every delivery broadcast refreshes the history + stats.
        unsub = OA.on('webhooks.delivered', () => {
          clearTimeout(loadTimer);
          loadTimer = setTimeout(load, 150);
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('webhooks', err.message); });
        return () => { if (unsub) unsub(); clearTimeout(loadTimer); };
      },
    });
  },
};
