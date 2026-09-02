/** Backups client — create/delete snapshots, auto-backup toggle + a last-backup widget. */

const STYLE = `
.oa-bk-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.oa-bk-switch-row { display: flex; align-items: center; gap: 10px; }
.oa-bk-empty { text-align: center; padding: 26px 14px; color: var(--muted); font-size: 13.5px; }
`;

function onceDetached(el, done) {
  const content = document.getElementById('content');
  if (!content) return;
  const mo = new MutationObserver(() => {
    if (!el.isConnected) { mo.disconnect(); done(); }
  });
  mo.observe(content, { childList: true, subtree: true });
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'backups';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page ────────────────────────────────────────────────────────────── */
    OA.registerPage('backups', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const { backups, auto, dataDir } = await OA.api('/api/backups');
          el.innerHTML = `
            <div class="oa-page-head"><h2>💾 Backups</h2>
              <p>${backups.length} snapshot${backups.length === 1 ? '' : 's'} · auto-backup ${auto ? 'ON' : 'OFF'}</p></div>
            <div class="oa-card" style="margin-bottom:16px">
              <div class="oa-bk-actions">
                <button class="oa-btn" id="bk-create">💾 Create backup now</button>
                <label class="oa-bk-switch-row">
                  <span class="oa-switch"><input type="checkbox" id="bk-auto" ${auto ? 'checked' : ''}><span class="track"></span></span>
                  <span><b>Auto-backup</b><br><small class="muted">snapshot the data dir every 6 hours</small></span>
                </label>
              </div>
            </div>
            <div class="oa-card" style="padding:6px 10px">
              <table class="oa-table">
                <thead><tr><th>Name</th><th>Size</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
                <tbody>
                  ${backups.length ? backups.map((b) => `
                    <tr data-name="${OA.esc(b.name)}">
                      <td><strong>${OA.esc(b.name)}</strong></td>
                      <td>${(b.sizeBytes / 1024).toFixed(1)} KB</td>
                      <td>${OA.timeAgo(b.createdAt)} ago <small class="muted">(${OA.esc(new Date(b.createdAt).toLocaleString())})</small></td>
                      <td style="text-align:right"><button class="oa-btn danger small" data-del>Delete</button></td>
                    </tr>`).join('') : `
                    <tr><td colspan="4"><div class="oa-bk-empty">
                      <div style="font-size:32px;margin-bottom:6px">🗄️</div>
                      No backups yet — hit “Create backup now”.</div></td></tr>`}
                </tbody>
              </table>
            </div>
            <div class="oa-card" style="margin-top:16px">
              <h3 style="margin-bottom:8px">Where backups live</h3>
              <p class="muted" style="margin:0;font-size:13.5px">
                Everything a plugin stores is JSON inside <code>${OA.esc(dataDir)}</code>.
                Snapshots are copied to <code>${OA.esc(dataDir)}/backups</code> — the backups folder is
                excluded from its own copies. Restore by copying a backup back over the data dir.
              </p>
            </div>`;

          el.querySelector('#bk-create').addEventListener('click', async (e) => {
            e.target.disabled = true; e.target.textContent = '⏳ Backing up…';
            try {
              await OA.api('/api/backups', { method: 'POST' });
              OA.toast('💾 Backup created', 'success');
              load();
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              e.target.disabled = false; e.target.textContent = '💾 Create backup now';
            }
          });

          el.querySelector('#bk-auto').addEventListener('change', async (e) => {
            try {
              await OA.api('/api/backups/auto', {
                method: 'POST',
                body: JSON.stringify({ enabled: e.target.checked }),
              });
              OA.toast(e.target.checked ? '🕒 Auto-backup scheduled every 6h' : '🕒 Auto-backup turned off', 'info');
              load();
            } catch (err) {
              e.target.checked = !e.target.checked;
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('[data-name]').forEach((row) => {
            row.querySelector('[data-del]').addEventListener('click', async () => {
              if (!confirm(`Delete backup "${row.dataset.name}"? This removes the folder on disk.`)) return;
              await OA.api('/api/backups/' + encodeURIComponent(row.dataset.name), { method: 'DELETE' });
              OA.toast('🗑️ Backup deleted', 'info');
              load();
            });
          });
        }

        unsub = OA.on('backups.changed', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('backups', err.message); });

        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: last backup + quick create ───────────────────── */
    OA.registerWidget('backups-last', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const { backups, auto } = await OA.api('/api/backups');
          const last = backups[0];
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num" style="font-size:24px">${last ? OA.timeAgo(last.createdAt) : '—'}</span>
              <span class="lbl">💾 Last backup${auto ? ' · auto-on' : ''}</span>
              ${last ? `<small class="muted" style="font-size:12px">${OA.esc(last.name)} · ${humanSize(last.sizeBytes)}</small>` : ''}
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="oa-btn small" style="flex:1;justify-content:center" id="bk-widget-create">Create now</button>
                <a class="oa-btn secondary small" href="#/backups" style="flex:1;justify-content:center">Manage →</a>
              </div>
            </div>`;
          const btn = el.querySelector('#bk-widget-create');
          if (btn) btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = '…';
            try { await OA.api('/api/backups', { method: 'POST' }); }
            catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); btn.disabled = false; btn.textContent = 'Create now'; }
            load();
          });
        }

        unsub = OA.on('backups.changed', () => load().catch(() => {}));
        load().catch((err) => { el.innerHTML = OA.crashCard('backups', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
