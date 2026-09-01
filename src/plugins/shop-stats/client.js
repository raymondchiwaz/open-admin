/** Shop Stats client — revenue table page + dashboard widget. */

export default {
  register(OA) {
    OA.registerPage('shop-stats', {
      mount(el, OA) {
        OA.api('/api/shop-stats/metrics').then(({ metrics }) => {
          const max = Math.max(...metrics.map((m) => m.revenue));
          el.innerHTML = `
            <div class="oa-page-head"><h2>🛍️ Shop Stats</h2>
              <p>A third-party example plugin — it contributes this page, a dashboard widget and live activity in the Social feed.</p></div>
            <div class="oa-grid">
              <div class="oa-card" style="grid-column: span 2">
                <h3 style="margin-bottom:12px">Revenue this week</h3>
                <table class="oa-table">
                  <thead><tr><th>Day</th><th>Orders</th><th>Revenue</th><th style="width:40%"></th></tr></thead>
                  <tbody>
                    ${metrics.map((m) => `
                      <tr><td><b>${OA.esc(m.day)}</b></td><td>${m.orders}</td><td>$${m.revenue.toLocaleString()}</td>
                      <td><div style="height:8px;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:${(m.revenue / max) * 100}%"></div></td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <div class="oa-card oa-stat">
                <span class="num">$${metrics.at(-1).revenue.toLocaleString()}</span>
                <span class="lbl">Total this week</span>
                <span class="oa-chip ok">▲ 18% vs last week</span>
              </div>
            </div>`;
        });
      },
    });

    OA.registerWidget('shop-revenue', {
      mount(el, OA) {
        OA.api('/api/shop-stats/metrics').then(({ metrics }) => {
          const last = metrics.at(-1);
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">$${last.revenue.toLocaleString()}</span>
              <span class="lbl">🛍️ Shop revenue (${OA.esc(last.day)})</span>
              <a href="#/shop-stats" style="font-size:13px;font-weight:600">Open Shop Stats →</a>
            </div>`;
        }).catch((err) => { el.innerHTML = OA.crashCard('shop-stats', err.message); });
      },
    });
  },
};
