/** Uptime Monitor client — status page from the plugin's ping history. */

export default {
  register(OA) {
    OA.registerPage('uptime', {
      mount(el, OA) {
        async function load() {
          const { pings } = await OA.api('/api/uptime/history');
          const last = pings[0];
          const okShare = pings.length
            ? Math.round((pings.filter((p) => p.level === 'ok').length / pings.length) * 100)
            : 100;
          el.innerHTML = `
            <div class="oa-page-head"><h2>🩺 Uptime</h2>
              <p>Pings every 30s — failures and slowdowns are posted to the Social feed automatically.</p></div>
            <div class="oa-grid">
              <div class="oa-card oa-stat">
                <span class="num" style="color:${okShare > 95 ? 'var(--ok)' : 'var(--warn)'}">${okShare}%</span>
                <span class="lbl">healthy pings (recent)</span>
              </div>
              <div class="oa-card oa-stat">
                <span class="num">${last ? last.ms : '—'}<small style="font-size:14px;color:var(--muted)"> ms</small></span>
                <span class="lbl">last response · ${OA.esc(last?.service || '—')}</span>
              </div>
              <div class="oa-card" style="grid-column: span 2">
                <h3 style="margin-bottom:10px">Recent pings</h3>
                ${pings.length ? pings.slice(0, 12).map((p) => `
                  <div class="oa-trend-row">
                    <span>${p.level === 'ok' ? '🟢' : p.level === 'warn' ? '🟡' : '🔴'} <b>${OA.esc(p.service)}</b></span>
                    <span class="t-count">${p.ms} ms · ${OA.timeAgo(p.at)} ago</span>
                  </div>`).join('') : '<p class="muted">No pings yet — wait 30 seconds.</p>'}
              </div>
            </div>`;
        }
        load();
        const t = setInterval(load, 31000);
        return () => clearInterval(t);
      },
    });
  },
};
