/** Announcements client — a live sticky banner above the topbar + composer page with history. */

const STYLE = `
#oa-announce-banner {
  position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 12px;
  padding: 10px 28px; color: #fff; font-weight: 600; font-size: 14.5px;
  box-shadow: 0 2px 12px rgba(16, 20, 40, 0.18); animation: oa-fadein 0.2s ease;
}
#oa-announce-banner[hidden] { display: none !important; }
#oa-announce-banner[data-level="info"] { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
#oa-announce-banner[data-level="warn"] { background: linear-gradient(90deg, #b45309, var(--warn)); }
#oa-announce-banner[data-level="critical"] { background: linear-gradient(90deg, #b91c1c, var(--danger)); }
.oa-announce-close {
  margin-left: auto; background: rgba(255, 255, 255, 0.2); border: none; color: #fff;
  border-radius: 8px; width: 30px; height: 30px; font-size: 14px; flex: 0 0 auto;
}
.oa-announce-close:hover { background: rgba(255, 255, 255, 0.32); }
.oa-announce-composer textarea { min-height: 84px; resize: vertical; }
.oa-ann-levels { display: flex; gap: 8px; margin: 10px 0; }
.oa-ann-level {
  border: 1px solid var(--border); background: var(--panel-2); color: var(--text);
  border-radius: 999px; padding: 5px 14px; font-size: 13px; font-weight: 600;
}
.oa-ann-level.sel-info { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.oa-ann-level.sel-warn { background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: var(--warn); color: var(--warn); }
.oa-ann-level.sel-critical { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); color: var(--danger); }
.oa-ann-preview { border-radius: 12px; padding: 10px 16px; font-weight: 600; }
.oa-ann-preview[data-level="info"] { background: linear-gradient(90deg, var(--accent), var(--accent-2)); color: #fff; }
.oa-ann-preview[data-level="warn"] { background: linear-gradient(90deg, #b45309, var(--warn)); color: #fff; }
.oa-ann-preview[data-level="critical"] { background: linear-gradient(90deg, #b91c1c, var(--danger)); color: #fff; }
.oa-ann-preview[data-level="none"] { background: var(--panel-2); color: var(--muted); border: 1px dashed var(--border); }
.oa-ann-current { font-size: 13.5px; line-height: 1.5; }
`;

const BANNER_ID = 'oa-announce-banner';
const DISMISS_KEY = 'oa-ann-dismissed';

/** Render the banner content for a banner object (or null). */
function bannerHtml(text, OA) {
  return `
    <span>📣</span><span>${OA.esc(text)}</span>
    <button class="oa-announce-close" aria-label="Dismiss announcement">✕</button>`;
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'announcements';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Global banner: first child of .oa-main ─────────────────────────── */
    const main = document.querySelector('.oa-main');
    let banner = document.getElementById(BANNER_ID);
    if (main && !banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.hidden = true;
      main.insertBefore(banner, main.firstChild);
    }

    function renderBanner(current) {
      if (!banner || !main) return;
      if (!current || !current.text) {
        banner.hidden = true;
        banner.innerHTML = '';
        banner.dataset.level = '';
        return;
      }
      // Dismissed once per browser session → stay hidden for this text.
      if (sessionStorage.getItem(DISMISS_KEY) === current.text) {
        banner.hidden = true;
        return;
      }
      banner.hidden = false;
      banner.dataset.level = current.level || 'info';
      banner.innerHTML = bannerHtml(current.text, OA);
      banner.querySelector('.oa-announce-close').addEventListener('click', () => {
        sessionStorage.setItem(DISMISS_KEY, current.text);
        banner.hidden = true;
      });
    }

    // Initial fetch + live updates (payload is the banner or null).
    OA.api('/api/announcements/current')
      .then((d) => renderBanner(d.current))
      .catch(() => { if (banner) banner.hidden = true; });
    const unsubBanner = OA.on('announcements.changed', renderBanner);

    /* ── Page: composer + history ───────────────────────────────────────── */
    OA.registerPage('announcements', {
      mount(el, OA) {
        let unsub = null;
        let level = 'info';

        function historyRows(h) {
          return h.map((item) => `
            <tr>
              <td><span class="oa-chip ${item.level === 'critical' ? 'error' : item.level === 'warn' ? 'warn' : 'info'}">${item.level || 'info'}</span></td>
              <td>${OA.esc(item.text)}</td>
              <td class="muted" style="white-space:nowrap">${OA.timeAgo(item.createdAt)}</td>
              <td class="muted" style="white-space:nowrap">${item.clearedAt ? OA.timeAgo(item.clearedAt) : '—'}</td>
            </tr>`).join('');
        }

        function setCurrentLabel(d) {
          const box = el.querySelector('#oa-ann-current');
          if (!box) return;
          box.innerHTML = d && d.current
            ? `<div class="oa-ann-current">${OA.esc(d.current.text)}
                <span class="oa-chip ${d.current.level === 'critical' ? 'error' : d.current.level === 'warn' ? 'warn' : 'info'}">${d.current.level}</span>
                <small class="muted">${OA.timeAgo(d.current.at)}</small></div>`
            : '<div class="muted">No banner is live right now.</div>';
        }

        function updatePreview() {
          const text = el.querySelector('#oa-ann-text').value.trim();
          const p = el.querySelector('#oa-ann-preview');
          if (!p) return;
          p.dataset.level = text ? level : 'none';
          p.textContent = text || 'Live preview — looks exactly like the banner above the topbar.';
        }

        async function load() {
          const [cur, hist] = await Promise.all([
            OA.api('/api/announcements/current'),
            OA.api('/api/announcements/history'),
          ]);
          el.innerHTML = `
            <div class="oa-page-head"><h2>📣 Announcements</h2>
              <p>Broadcast a banner to every admin tab — it updates live, no refresh needed</p></div>
            <div class="oa-grid">
              <div class="oa-card oa-announce-composer" style="grid-column: span 2">
                <h3 style="margin-bottom:10px">Compose</h3>
                <textarea class="oa-input" id="oa-ann-text" maxlength="240" placeholder="Write your announcement… (240 chars max)"></textarea>
                <div class="oa-ann-levels">
                  ${['info', 'warn', 'critical'].map((l) =>
                    `<button class="oa-ann-level${l === level ? ' sel-' + l : ''}" data-level="${l}">${l === 'info' ? 'ℹ Info' : l === 'warn' ? '⚠ Warn' : '🚨 Critical'}</button>`).join('')}
                </div>
                <div class="oa-form-row" style="margin:0">
                  <button class="oa-btn" id="oa-ann-publish" style="flex:0 0 auto">📣 Publish</button>
                  <button class="oa-btn secondary" id="oa-ann-clear" style="flex:0 0 auto">✕ Clear current</button>
                  <span class="muted" style="font-size:12.5px;align-self:center">Publishing replaces the current banner and posts to the Social feed.</span>
                </div>
                <h3 style="margin:16px 0 8px">Live preview</h3>
                <div id="oa-ann-preview" class="oa-ann-preview" data-level="none"></div>
              </div>
              <div class="oa-card">
                <h3 style="margin-bottom:10px">Currently live</h3>
                <div id="oa-ann-current"></div>
              </div>
            </div>
            <div class="oa-card" style="margin-top:16px">
              <h3 style="margin-bottom:10px">History <span class="muted" style="font-weight:400">(${hist.history.length})</span></h3>
              <table class="oa-table">
                <thead><tr><th>Level</th><th>Message</th><th>Published</th><th>Cleared</th></tr></thead>
                <tbody>${historyRows(hist.history) || '<tr><td colspan="4" class="muted">No past announcements yet — publish your first one.</td></tr>'}</tbody>
              </table>
            </div>`;

          setCurrentLabel(cur);
          updatePreview();

          el.querySelectorAll('.oa-ann-level').forEach((btn) => {
            btn.addEventListener('click', () => {
              level = btn.dataset.level;
              el.querySelectorAll('.oa-ann-level').forEach((b) => b.classList.remove('sel-info', 'sel-warn', 'sel-critical'));
              btn.classList.add('sel-' + level);
              updatePreview();
            });
          });
          el.querySelector('#oa-ann-text').addEventListener('input', updatePreview);
          el.querySelector('#oa-ann-publish').addEventListener('click', async () => {
            const text = el.querySelector('#oa-ann-text').value.trim();
            if (!text) { OA.toast('📣 Write something first', 'warn'); return; }
            try {
              await OA.api('/api/announcements', { method: 'POST', body: JSON.stringify({ text, level }) });
              OA.toast('📣 Announcement is live on every tab', 'success');
              el.querySelector('#oa-ann-text').value = '';
              updatePreview();
              load();
            } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
          });
          el.querySelector('#oa-ann-clear').addEventListener('click', async () => {
            try {
              await OA.api('/api/announcements/clear', { method: 'POST' });
              OA.toast('📣 Banner cleared', 'info');
              load();
            } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
          });
        }

        // Banner changes elsewhere re-render the composer + history too.
        unsub = OA.on('announcements.changed', () => load());
        load().catch((err) => { el.innerHTML = OA.crashCard('announcements', err.message); });
        return () => { if (unsub) unsub(); };
      },
    });
  },
};
