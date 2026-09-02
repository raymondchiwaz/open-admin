/** Deploys client — new-deploy form, live deploy cards, rollback/finish actions, feed mirror + dashboard widget. */

const STYLE = `
.oa-deploy-card { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-2); margin-bottom: 12px; }
.oa-deploy-card .oa-deploy-main { flex: 1; min-width: 0; }
.oa-deploy-badge { font-size: 15px; color: var(--muted); flex: 0 0 auto; }
.oa-deploy-body { font-size: 13px; color: var(--muted); margin-top: 4px; overflow-wrap: anywhere; }
.oa-deploy-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.oa-deploy-feed { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px; display: flex; gap: 8px; align-items: baseline; }
.oa-deploy-feed:last-child { border-bottom: none; }
.oa-deploy-inprogress { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: inset 3px 0 0 var(--accent); }
.oa-deploy-new { animation: oa-deploy-in 0.35s ease; }
@keyframes oa-deploy-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
`;

const STATUS_CLASS = {
  succeeded: 'ok', failed: 'error', in_progress: 'info', rolled_back: 'warn',
};

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'deployment-tracker';
    style.textContent = STYLE;
    document.head.appendChild(style);

    function cardHtml(d, OA) {
      const statusCls = STATUS_CLASS[d.status] || 'info';
      const finished = d.finishedAt ? ` · finished ${OA.timeAgo(d.finishedAt)}` : '';
      return `
        <div class="oa-deploy-card ${d.status === 'in_progress' ? 'oa-deploy-inprogress' : ''}" data-id="${OA.esc(d.id)}">
          <span class="oa-deploy-badge">${d.status === 'in_progress' ? '🚧' : d.status === 'succeeded' ? '✅' : d.status === 'failed' ? '❌' : '↩️'}</span>
          <div class="oa-deploy-main">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <strong>${OA.esc(d.version)}</strong>
              <span class="oa-chip info">${OA.esc(d.env)}</span>
              <span class="oa-chip ${statusCls}">${OA.esc(d.status)}</span>
              <span class="muted" style="font-size:12.5px">${OA.esc(d.by)} · started ${OA.timeAgo(d.startedAt)}${finished}</span>
            </div>
            ${d.notes ? `<div class="oa-deploy-body">${OA.esc(d.notes)}</div>` : ''}
            ${d.status === 'in_progress' ? `
            <div class="oa-deploy-actions">
              <button class="oa-btn small" data-action="succeed">✓ Mark succeeded</button>
              <button class="oa-btn small secondary" data-action="fail">✗ Mark failed</button>
              <button class="oa-btn small danger" data-action="rollback">↩ Roll back</button>
            </div>` : ''}
          </div>
        </div>`;
    }

    function feedHtml(a, OA) {
      return `<div class="oa-deploy-feed"><span>${OA.esc(a.icon || '🚢')}</span><span style="flex:1">${OA.md(a.text)}</span><span class="muted" style="flex:0 0 auto;font-size:12px">${OA.timeAgo(new Date().toISOString())}</span></div>`;
    }

    OA.registerPage('deploys', {
      mount(el, OA) {
        let unsubChanged = null;
        let unsubActivity = null;

        async function reload() {
          const { deploys } = await OA.api('/api/deploys');
          const list = el.querySelector('#oa-deploys-list');
          if (!list) return;
          list.innerHTML = deploys.length
            ? deploys.map((d) => cardHtml(d, OA)).join('')
            : `<div class="muted" style="padding:14px 0">No deploys yet — start your first one above.</div>`;
        }

        el.innerHTML = `
          <div class="oa-page-head"><h2>🚢 Deploys</h2>
            <p>Start, finish or roll back deployments — every action is announced in the Social feed.</p></div>
          <form class="oa-card" id="oa-deploy-form" style="padding:14px">
            <h3 style="margin-bottom:10px">New deploy</h3>
            <div class="oa-form-row">
              <input class="oa-input" name="version" placeholder="Version (e.g. v1.2.6)" required>
              <select class="oa-select" name="env" style="max-width:180px">
                <option value="production">production</option>
                <option value="staging">staging</option>
              </select>
              <button class="oa-btn" style="flex:0 0 auto">🚀 Deploy</button>
            </div>
            <textarea class="oa-input" name="notes" rows="2" placeholder="Release notes (optional)"></textarea>
          </form>
          <div id="oa-deploys-list" style="margin-top:16px"></div>
          <div class="oa-card" style="margin-top:8px;padding:6px 14px">
            <h3 style="margin-bottom:4px">Deploy activity</h3>
            <div id="oa-deploy-feed" class="muted">No deploy activity yet.</div>
          </div>`;

        el.querySelector('#oa-deploy-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const version = (fd.get('version') || '').trim();
          if (!version) return;
          const btn = e.target.querySelector('button');
          btn.disabled = true;
          try {
            await OA.api('/api/deploys', {
              method: 'POST',
              body: JSON.stringify({ version, env: fd.get('env'), notes: fd.get('notes') }),
            });
            OA.toast(`🚢 Deploy <b>${OA.esc(version)}</b> started`, 'success');
            e.target.reset();
            await reload();
          } catch (err) {
            OA.toast(`Deploy failed: <b>${OA.esc(err.message)}</b>`, 'error');
          } finally {
            btn.disabled = false;
          }
        });

        el.querySelector('#oa-deploys-list').addEventListener('click', async (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const card = e.target.closest('[data-id]');
          const id = card && card.dataset.id;
          const action = btn.dataset.action;
          btn.disabled = true;
          try {
            if (action === 'succeed') {
              await OA.api(`/api/deploys/${id}/finish`, { method: 'POST', body: JSON.stringify({ status: 'succeeded' }) });
              OA.toast('✅ Deploy marked as succeeded', 'success');
            } else if (action === 'fail') {
              await OA.api(`/api/deploys/${id}/finish`, { method: 'POST', body: JSON.stringify({ status: 'failed' }) });
              OA.toast('❌ Deploy marked as failed', 'error');
            } else if (action === 'rollback') {
              await OA.api(`/api/deploys/${id}/rollback`, { method: 'POST' });
              OA.toast('↩️ Deploy rolled back', 'info');
            }
            await reload();
          } catch (err) {
            OA.toast(OA.esc(err.message), 'error');
          } finally {
            btn.disabled = false;
          }
        });

        // Live updates: own actions + external deploys arrive here too.
        unsubChanged = OA.on('deploys.changed', () => reload().catch(() => {}));

        // The deploy feed mirror: activity posts about deploys land here live.
        unsubActivity = OA.on('activity', (p) => {
          const a = p && p.activity;
          if (!a || a.source !== 'deployment-tracker') return;
          const feed = el.querySelector('#oa-deploy-feed');
          if (!feed) return;
          if (feed.textContent === 'No deploy activity yet.') feed.innerHTML = '';
          feed.insertAdjacentHTML('afterbegin', feedHtml(a, OA));
          while (feed.children.length > 8) feed.lastElementChild.remove();
        });

        reload().catch((err) => { el.innerHTML = OA.crashCard('deployment-tracker', err.message); });

        return () => {
          if (unsubChanged) unsubChanged();
          if (unsubActivity) unsubActivity();
        };
      },
    });

    OA.registerWidget('deploys-current', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const { deploys } = await OA.api('/api/deploys');
          const d = deploys[0];
          if (!d) {
            el.innerHTML = `<div class="oa-card muted">🚢 No deploys yet.</div>`;
            return;
          }
          const statusCls = STATUS_CLASS[d.status] || 'info';
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${OA.esc(d.version)}</span>
              <span class="lbl">🚢 Latest deploy — <span class="oa-chip ${statusCls}">${OA.esc(d.status)}</span> <span class="oa-chip info">${OA.esc(d.env)}</span></span>
              <a href="#/deploys" style="font-size:13px;font-weight:600">Manage deploys →</a>
            </div>`;
        }

        unsub = OA.on('deploys.changed', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('deployment-tracker', err.message); });

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
