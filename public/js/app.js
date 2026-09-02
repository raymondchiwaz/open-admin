/**
 * app.js — boots the admin shell: loads the bootstrap payload, imports every
 * enabled plugin's client module, builds the sidebar/topbar and runs the
 * hash router. Plugin pages and widgets are ordinary contributors — the
 * shell has no idea what pages exist ahead of time.
 */

import OA from './oa.js';

OA.base = window.OA_BASE || '';

await OA.init();

// Load client modules contributed by enabled plugins. A failing third-party
// module must never take the whole admin down.
for (const id of OA.data.clients || []) {
  try {
    const mod = await import(`${OA.base}/oa/plugins/${id}/client.js`);
    const def = mod.default;
    if (typeof def === 'function') def(OA);
    else if (def && typeof def.register === 'function') def.register(OA);
    else if (def && (def.pages || def.widgets)) {
      // declarative form: { pages: { path: { mount } }, widgets: { id: { mount } } }
      for (const [path, page] of Object.entries(def.pages || {})) OA.registerPage(path, page);
      for (const [wid, widget] of Object.entries(def.widgets || {})) OA.registerWidget(wid, widget);
    }
  } catch (err) {
    console.error('[open-admin] client module failed:', id, err);
    OA.toast(`⚠️ Plugin <b>${OA.esc(id)}</b> failed to load in the browser`, 'error');
  }
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */

const NAV_ORDER = ['General', 'Content', 'Insights', 'System', 'Tools'];

function renderSidebar() {
  const nav = OA.data.nav;
  const groups = new Map();
  for (const item of nav) {
    const cat = item.category || 'General';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(item);
  }
  const cats = [...groups.keys()].sort((a, b) =>
    ((NAV_ORDER.indexOf(a) + 1 || 99) - (NAV_ORDER.indexOf(b) + 1 || 99)) ||
    a.localeCompare(b));
  const showLabels = cats.length > 1;
  const navHtml = cats.map((cat) => `
    ${showLabels ? `<div class="oa-nav-label">${OA.esc(cat)}</div>` : ''}
    ${groups.get(cat).map((item) => `
      <a class="oa-nav-item" data-path="${OA.esc(item.path)}" href="#/${OA.esc(item.path)}">
        <span class="oa-nav-icon">${item.icon || '📄'}</span>
        <span>${OA.esc(item.title)}</span>
      </a>`).join('')}`).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="oa-brand">
      <span class="oa-brand-logo">💬</span>
      <span class="oa-brand-text"><strong>${OA.esc(OA.siteName)}</strong><small>Open Admin</small></span>
    </div>
    <nav class="oa-nav">${navHtml}</nav>
    <div class="oa-sidebar-foot">
      <div class="oa-pill-row">
        <span class="oa-pill">${OA.data.plugins.filter((p) => p.enabled).length} plugins</span>
        <span class="oa-pill">v${OA.esc(OA.version)}</span>
      </div>
      <button class="oa-theme-btn" id="theme-btn" title="Toggle theme">${OA.theme === 'dark' ? '☀️' : '🌙'} <span>Theme</span></button>
    </div>`;
  document.getElementById('theme-btn').addEventListener('click', () => {
    OA.toggleTheme();
    renderSidebar();
  });
}

/* ── Topbar ────────────────────────────────────────────────────────────── */

function renderTopbar(title, subtitle) {
  document.getElementById('topbar').innerHTML = `
    <div class="oa-topbar-title"><h1 id="page-title">${OA.esc(title || '')}</h1>
      <span class="oa-topbar-sub">${OA.esc(subtitle || '')}</span></div>
    <div class="oa-topbar-actions">
      <button class="oa-icon-btn" id="refresh-btn" title="Reload admin">⟳</button>
      <div class="oa-me" title="Signed in as ${OA.esc(OA.me.name)}">${OA.avatar(OA.me, 34)}</div>
    </div>`;
  document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
}

/* ── Router ────────────────────────────────────────────────────────────── */

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return h || OA.data.home || 'dashboard';
}

function render() {
  const path = currentPath();
  const nav = OA.data.nav.find((n) => n.path === path);
  const page = OA.pages.get(path);
  const content = document.getElementById('content');

  if (OA._cleanup) { try { OA._cleanup(); } catch { /* noop */ } OA._cleanup = null; }
  content.innerHTML = '';

  if (!page) {
    content.innerHTML = `
      <div class="oa-empty">
        <h2>404 — nothing lives at <code>/${OA.esc(path)}</code></h2>
        <p class="muted">Either no plugin provides this page, or the plugin that provides it is disabled.</p>
        <a class="oa-btn" href="#/${OA.esc(OA.data.home)}">← Take me home</a>
      </div>`;
  } else {
    try {
      OA._cleanup = page.mount(content, OA) || null;
    } catch (err) {
      console.error('[open-admin] page crashed:', path, err);
      content.innerHTML = OA.crashCard(nav?.pluginId || path, err.message);
    }
  }
  OA.fillSlots(content);

  document.querySelectorAll('.oa-nav-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.path === path));
  document.title = `${nav ? nav.title : 'Not found'} · ${OA.siteName}`;
  renderTopbar(nav?.title, nav ? 'by plugin ' + nav.pluginId : '');
}

window.addEventListener('hashchange', render);
renderSidebar();
render();
