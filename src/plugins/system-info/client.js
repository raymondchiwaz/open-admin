/** System Info client — stat cards, collections table, 10s auto-refresh + dashboard card. */

const STYLE = `
.oa-sys-mem-wrap { width: 100%; height: 10px; border-radius: 6px; background: var(--panel-2); overflow: hidden; margin: 6px 0 4px; border: 1px solid var(--border); }
.oa-sys-mem-wrap i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.5s ease; }
.oa-sys-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
.oa-sys-refresh-hint { font-size: 12px; color: var(--muted); }
`;

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'system-info';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('system-info', {
      mount(el, OA) {
        let timer = null;

        async function load() {
          const s = await OA.api('/api/system-info');
          const usedMB = s.totalMemMB - s.freeMemMB;
          const pct = s.totalMemMB ? Math.round((usedMB / s.totalMemMB) * 100) : 0;
          el.innerHTML = `
            <div class="oa-page-head"><h2>🖥️ System Info</h2>
              <p class="oa-sys-refresh-hint">Refreshes every 10s · last check ${new Date().toLocaleTimeString()} · running on ${OA.esc(s.hostname)}</p></div>
            <div class="oa-grid">
              <div class="oa-card oa-stat">
                <span class="num">${OA.esc(s.node)}</span>
                <span class="lbl">🟢 Node.js runtime</span>
              </div>
              <div class="oa-card oa-stat">
                <span class="num">${OA.esc(fmtUptime(s.uptimeSec))}</span>
                <span class="lbl">⏱️ Process uptime</span>
              </div>
              <div class="oa-card oa-stat">
                <span class="num">${pct}%</span>
                <span class="lbl">🧠 ${usedMB.toLocaleString()} MB of ${s.totalMemMB.toLocaleString()} MB in use</span>
                <div class="oa-sys-mem-wrap" title="${usedMB.toLocaleString()} MB used of ${s.totalMemMB.toLocaleString()} MB"><i style="width:${pct}%"></i></div>
              </div>
              <div class="oa-card oa-stat">
                <span class="num">${s.cpus}</span>
                <span class="lbl">🧩 CPU cores · ${OA.esc(s.platform)}/${OA.esc(s.arch)}</span>
              </div>
              <div class="oa-card oa-stat" style="grid-column: span 2">
                <span class="lbl" style="font-size:12px;text-transform:uppercase;letter-spacing:0.4px">📁 Data directory</span>
                <div class="oa-sys-mono">${OA.esc(s.dataDir)}</div>
                <span class="oa-chip info">${s.kvKeys} kv keys</span>
              </div>
            </div>
            <div class="oa-card" style="margin-top:16px;padding:6px 10px;overflow:auto">
              <h3 style="margin-bottom:6px">Collections</h3>
              ${s.collections.length ? `
              <table class="oa-table">
                <thead><tr><th>Collection</th><th>Docs</th><th style="text-align:right">Size</th></tr></thead>
                <tbody>
                  ${s.collections.map((c) => `
                    <tr>
                      <td class="oa-sys-mono">${OA.esc(c.name)}</td>
                      <td>${c.docs.toLocaleString()}</td>
                      <td style="text-align:right" class="muted">${OA.esc(fmtSize(c.sizeBytes))}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : '<div class="muted" style="padding:12px 0">No collections loaded yet.</div>'}
            </div>`;
        }

        load().catch((err) => { el.innerHTML = OA.crashCard('system-info', err.message); return; });
        timer = setInterval(() => { load().catch(() => {}); }, 10000);

        return () => clearInterval(timer);
      },
    });

    OA.registerWidget('system-info-card', {
      mount(el, OA) {
        OA.api('/api/system-info').then((s) => {
          const usedMB = s.totalMemMB - s.freeMemMB;
          const pct = s.totalMemMB ? Math.round((usedMB / s.totalMemMB) * 100) : 0;
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${OA.esc(s.node)}</span>
              <span class="lbl">🖥️ ${OA.esc(s.platform)}/${OA.esc(s.arch)} · up ${OA.esc(fmtUptime(s.uptimeSec))}</span>
              <div class="oa-sys-mem-wrap" title="${pct}% memory in use"><i style="width:${pct}%"></i></div>
              <span class="muted" style="font-size:12px">${pct}% memory used</span>
              <a href="#/system-info" style="font-size:13px;font-weight:600">System details →</a>
            </div>`;
        }).catch((err) => { el.innerHTML = OA.crashCard('system-info', err.message); });
      },
    });
  },
};
