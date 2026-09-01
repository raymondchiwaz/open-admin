/** Dashboard plugin — a widget grid + an activity chart widget. */

function activityChart(OA) {
  return OA.api('/api/events/recent').then(({ events }) => {
    const hours = [];
    for (let i = 11; i >= 0; i--) {
      const from = Date.now() - i * 3600_000 - 3600_000;
      hours.push({ label: i === 0 ? 'now' : `-${i}h`, count: 0 });
    }
    for (const e of events) {
      const d = new Date(e.at).getTime();
      const idx = 11 - Math.floor((Date.now() - d) / 3600_000);
      if (idx >= 0 && idx < 12) hours[idx].count++;
    }
    const max = Math.max(1, ...hours.map((h) => h.count));
    return `
      <h3 style="margin-bottom:12px">📈 Kernel events (last 12h)</h3>
      <div style="display:flex;align-items:flex-end;gap:6px;height:110px">
        ${hours.map((h) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px" title="${h.count} events">
            <div style="width:100%;max-width:26px;height:${Math.max(3, (h.count / max) * 90)}px;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,var(--accent),var(--accent-2))"></div>
            <small class="muted">${h.label}</small>
          </div>`).join('')}
      </div>`;
  });
}

export default {
  register(OA) {
    OA.registerPage('dashboard', {
      mount(el, OA) {
        el.innerHTML = `
          <div class="oa-page-head">
            <h2>Welcome back, ${OA.esc(OA.me.name)} 👋</h2>
            <p>This grid is assembled from widgets contributed by every enabled plugin.</p>
          </div>
          <div class="oa-grid" data-oa-slot="dashboard.grid"></div>`;
      },
    });

    OA.registerWidget('dash-activity', {
      mount(el, OA) {
        el.innerHTML = '<div class="oa-card muted">Loading chart…</div>';
        activityChart(OA)
          .then((html) => { el.innerHTML = `<div class="oa-card">${html}</div>`; })
          .catch((err) => { el.innerHTML = OA.crashCard('core-dashboard', err.message); });
      },
    });
  },
};
