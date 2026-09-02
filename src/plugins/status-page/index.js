'use strict';

/**
 * Status Page — a public, zero-asset status page.
 *
 * The kernel treats GET /status-page and GET /api/status as public escape
 * hatches (auth-exempt), so this page is reachable by visitors without an
 * admin session. Data is assembled exclusively through capabilities:
 *
 *   health.snapshot   (Health Checks)  → components
 *   incidents.active  (Incident Manager) → active incidents
 *
 * Both are optional — with no providers the page reports Open Admin itself as
 * operational and lists no incidents, so ordering/arbitrary subsets work.
 *
 * Capability: `status-page.public` → '/status-page'
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const META = {
  operational: ['All systems operational', 'green'],
  degraded: ['Partial degradation', 'yellow'],
  outage: ['Major outage', 'red'],
};

const POSSIBLE_LEVELS = new Set(['ok', 'warn', 'error']);

function componentRow(c, msLabel) {
  const lvl = c.level === 'error' ? 'red' : c.level === 'warn' ? 'yellow' : 'green';
  const side = c.ms != null
    ? `<span class="oa-sp-sub">${msLabel(c.ms)}</span>`
    : '<span class="oa-sp-sub">no data</span>';
  return `<div class="oa-sp-row">
    <span class="oa-sp-dot ${lvl}"></span>
    <div class="oa-sp-row-body"><strong>${esc(c.name)}</strong>${side}</div>
  </div>`;
}

function incidentRow(i) {
  const lvl = i.severity === 'critical' ? 'red' : 'yellow';
  return `<div class="oa-sp-row">
    <span class="oa-sp-dot ${lvl}"></span>
    <div class="oa-sp-row-body">
      <strong>${esc(i.title)}</strong>
      <span class="oa-sp-sub">${esc(i.severity)} · ${esc(i.status)}</span>
    </div>
  </div>`;
}

function msLabel(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

module.exports = {
  init(ctx) {
    const siteName = () => {
      const settings = ctx.store.kvAll().settings || {};
      return settings.siteName || 'Open Admin';
    };

    /** Components: prefer Health Checks, fall back to the panel itself. */
    function components() {
      if (ctx.capabilities.has('health.snapshot')) {
        const snap = ctx.capabilities.use('health.snapshot')();
        return (Array.isArray(snap) ? snap : []).map((c) => ({
          name: String(c.name || 'Component').slice(0, 80),
          level: POSSIBLE_LEVELS.has(c.level) ? c.level : 'ok',
          ms: c.ms == null ? null : Math.max(0, Number(c.ms) || 0),
          at: c.at || null,
        }));
      }
      return [{ name: 'Open Admin', level: 'ok' }];
    }

    /** Active incidents: optional — empty list when the plugin is off. */
    function activeIncidents() {
      if (!ctx.capabilities.has('incidents.active')) return [];
      const list = ctx.capabilities.use('incidents.active')();
      return (Array.isArray(list) ? list : []).map((i) => ({
        title: String(i.title || 'Untitled incident').slice(0, 120),
        severity: ['minor', 'major', 'critical'].includes(i.severity) ? i.severity : 'minor',
        status: i.status || 'investigating',
      }));
    }

    function overall() {
      const comps = components();
      const incs = activeIncidents();
      if (comps.some((c) => c.level === 'error') || incs.some((i) => i.severity === 'critical')) {
        return 'outage';
      }
      if (comps.some((c) => c.level === 'warn') || incs.some((i) => i.severity === 'minor' || i.severity === 'major')) {
        return 'degraded';
      }
      return 'operational';
    }

    function statusSnapshot() {
      return {
        overall: overall(),
        components: components(),
        activeIncidents: activeIncidents(),
        generatedAt: new Date().toISOString(),
      };
    }

    /** The complete public document: inline CSS + JS only, no admin assets. */
    function pageHtml(data, name) {
      const [label, dotClass] = META[data.overall] || META.operational;
      const comps = data.components.map((c) => componentRow(c, msLabel)).join('') ||
        '<p class="oa-sp-sub">No components configured.</p>';
      const incs = data.activeIncidents.map(incidentRow).join('') ||
        '<p class="oa-sp-sub">No active incidents — all clear.</p>';
      const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');
      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Status · ${esc(name)}</title>
<style>
  :root { --bg:#f4f5f9; --panel:#fff; --border:#e4e7ef; --text:#1c2030; --muted:#6b7280;
          --green:#16a34a; --yellow:#d97706; --red:#dc2626; --radius:14px; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 16px 48px; background:var(--bg); color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;
         font-size:15px; line-height:1.5; }
  .oa-sp-wrap { max-width:680px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
  .oa-sp-head { display:flex; align-items:center; gap:14px; padding:12px 2px; }
  .oa-sp-logo { width:46px; height:46px; border-radius:14px; font-size:24px; display:grid; place-items:center;
                background:linear-gradient(135deg,#6d5cff,#b45cff); color:#fff; box-shadow:0 6px 18px rgba(109,92,255,.35); }
  h1 { font-size:20px; margin:0; } h2 { font-size:15px; margin:0 0 12px; }
  .oa-sp-sub { color:var(--muted); font-size:13px; margin:0; }
  .oa-sp-banner { display:flex; align-items:center; gap:12px; padding:16px 18px; border-radius:var(--radius);
                  border:1px solid var(--border); background:var(--panel); box-shadow:0 1px 2px rgba(16,20,40,.05),0 8px 24px rgba(16,20,40,.06); }
  .oa-sp-banner strong { font-size:16px; }
  .oa-sp-banner .oa-sp-dot { width:14px; height:14px; }
  .oa-sp-banner.green .oa-sp-dot { background:var(--green); box-shadow:0 0 0 5px rgba(22,163,74,.15); }
  .oa-sp-banner.yellow .oa-sp-dot { background:var(--yellow); box-shadow:0 0 0 5px rgba(217,119,6,.15); }
  .oa-sp-banner.red .oa-sp-dot { background:var(--red); box-shadow:0 0 0 5px rgba(220,38,38,.15); }
  .oa-sp-card { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius);
                padding:18px; box-shadow:0 1px 2px rgba(16,20,40,.05),0 8px 24px rgba(16,20,40,.06); }
  .oa-sp-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border); }
  .oa-sp-row:last-child { border-bottom:none; }
  .oa-sp-row-body { flex:1; display:flex; flex-direction:column; gap:2px; min-width:0; }
  .oa-sp-row-body strong { overflow-wrap:anywhere; }
  .oa-sp-dot { width:10px; height:10px; border-radius:50%; flex:0 0 10px; }
  .oa-sp-dot.green { background:var(--green); } .oa-sp-dot.yellow { background:var(--yellow); } .oa-sp-dot.red { background:var(--red); }
  .oa-sp-foot { text-align:center; color:var(--muted); font-size:12.5px; }
</style>
</head>
<body>
<main class="oa-sp-wrap">
  <header class="oa-sp-head">
    <div class="oa-sp-logo">🌍</div>
    <div><h1>${esc(name)} — Status</h1><p class="oa-sp-sub">Live system status for ${esc(name)}</p></div>
  </header>

  <div class="oa-sp-banner ${dotClass}" id="oa-sp-banner">
    <span class="oa-sp-dot ${dotClass}"></span>
    <div><strong id="oa-sp-overall">${label}</strong><p class="oa-sp-sub" id="oa-sp-note">Last updated ${data.generatedAt ? esc(data.generatedAt) : 'just now'} — this page refreshes itself every 30 s.</p></div>
  </div>

  <section class="oa-sp-card">
    <h2>Components</h2>
    <div id="oa-sp-components">${comps}</div>
  </section>

  <section class="oa-sp-card">
    <h2>Active incidents</h2>
    <div id="oa-sp-incidents">${incs}</div>
  </section>

  <footer class="oa-sp-foot">
    <span id="oa-sp-updated"></span> Auto-refresh every 30 s · ${esc(name)}
  </footer>
</main>
<script>
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var LABELS = { operational: 'All systems operational', degraded: 'Partial degradation', outage: 'Major outage' };
  var COLORS = { operational: 'green', degraded: 'yellow', outage: 'red' };
  function msLabel(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
  function rowHtml(name, level, ms) {
    var lvl = level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'green';
    return '<div class="oa-sp-row"><span class="oa-sp-dot ' + lvl + '"></span><div class="oa-sp-row-body"><strong>' +
      esc(name) + '</strong>' + (ms != null ? '<span class="oa-sp-sub">' + msLabel(ms) + '</span>' : '<span class="oa-sp-sub">no data</span>') +
      '</div></div>';
  }
  function incHtml(title, severity, status) {
    var lvl = severity === 'critical' ? 'red' : 'yellow';
    return '<div class="oa-sp-row"><span class="oa-sp-dot ' + lvl + '"></span><div class="oa-sp-row-body"><strong>' +
      esc(title) + '</strong><span class="oa-sp-sub">' + esc(severity) + ' · ' + esc(status) + '</span></div></div>';
  }
  function render(d) {
    if (!d || !d.overall) return;
    var banner = document.getElementById('oa-sp-banner');
    banner.className = 'oa-sp-banner ' + (COLORS[d.overall] || 'green');
    banner.querySelector('.oa-sp-dot').className = 'oa-sp-dot ' + (COLORS[d.overall] || 'green');
    document.getElementById('oa-sp-overall').textContent = LABELS[d.overall] || d.overall;
    document.getElementById('oa-sp-components').innerHTML = (d.components || []).length
      ? d.components.map(function (c) { return rowHtml(c.name, c.level, c.ms); }).join('')
      : '<p class="oa-sp-sub">No components configured.</p>';
    document.getElementById('oa-sp-incidents').innerHTML = (d.activeIncidents || []).length
      ? d.activeIncidents.map(function (i) { return incHtml(i.title, i.severity, i.status); }).join('')
      : '<p class="oa-sp-sub">No active incidents — all clear.</p>';
    var note = document.getElementById('oa-sp-note');
    if (d.generatedAt && note) note.textContent = 'Last updated ' + new Date(d.generatedAt).toLocaleString();
    var updated = document.getElementById('oa-sp-updated');
    if (updated && d.generatedAt) updated.textContent = 'Updated ' + new Date(d.generatedAt).toLocaleTimeString() + ' · ';
  }
  render(window.__OA_STATUS__ || null);
  setInterval(function () {
    fetch('/api/status').then(function (r) { return r.json(); }).then(render).catch(function () {});
  }, 30000);
})();
</script>
<noscript><p class="oa-sp-sub" style="text-align:center">Enable JavaScript for live auto-refresh.</p></noscript>
</body>
</html>`;
    }

    /* ── Routes ─────────────────────────────────────────────────────────── */

    ctx.registerRoute('GET', '/api/status', (req, res) => {
      ctx.json(res, 200, statusSnapshot());
    });

    ctx.registerRoute('GET', '/status-page', (req, res) => {
      const html = pageHtml(statusSnapshot(), siteName());
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
    });

    ctx.capabilities.provide('status-page.public', () => '/status-page', ctx.pluginId);
  },
};
