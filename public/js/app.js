/**
 * app.js — boots the admin shell: loads the bootstrap payload, imports every
 * enabled plugin's client module, builds the sidebar/topbar and runs the
 * hash router. Plugin pages and widgets are ordinary contributors — the
 * shell has no idea what pages exist ahead of time.
 */

import OA from './oa.js';

OA.base = window.OA_BASE || '';

try {
  await OA.init();
} catch (err) {
  document.getElementById('content').innerHTML = `<div class="oa-card oa-empty"><h2>We couldn't reach your workspace.</h2><p class="muted">Check that OpenAdmin is running, then try again.</p><button class="oa-btn" id="boot-retry">Try again</button></div>`;
  document.getElementById('boot-retry').addEventListener('click', () => location.reload());
  throw err;
}

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
    OA.toast(`Plugin ${id} failed to load in the browser`, 'error');
  }
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */

const NAV_ICONS = { social: 'house', dashboard: 'layout-dashboard', users: 'users', tasks: 'square-check', notifications: 'bell', announcements: 'megaphone', notes: 'sticky-note', analytics: 'chart-no-axes-combined', 'activity-log': 'activity', 'system-info': 'activity', plugins: 'puzzle', settings: 'settings-2', onboarding: 'circle-help', polls: 'panels-top-left' };
const NAV_TITLES = { social: 'Home feed', dashboard: 'Overview', users: 'People', plugins: 'Apps & integrations' };
function navLink(item) {
  const icon = NAV_ICONS[item.path] ? OA.icon(NAV_ICONS[item.path]) : `<span class="oa-nav-emoji" aria-hidden="true">${OA.esc(item.icon || '•')}</span>`;
  return `<a class="oa-nav-item" data-path="${OA.esc(item.path)}" href="#/${OA.esc(item.path)}">${icon}<span>${OA.esc(NAV_TITLES[item.path] || item.title)}</span>${item.path === 'social' ? '<span class="oa-nav-live"></span>' : ''}</a>`;
}
function renderSidebar() {
  const primary = OA.data.workspace?.primaryPaths || ['social', 'dashboard', 'tasks', 'users', 'notes', 'analytics'];
  const utility = ['plugins', 'settings'];
  const extra = OA.data.nav.filter((n) => !primary.includes(n.path) && !utility.includes(n.path));
  const find = (paths) => paths.map((path) => OA.data.nav.find((n) => n.path === path)).filter(Boolean).map(navLink).join('');
  const hasUtilities = utility.some(path => OA.data.nav.some(item => item.path === path));
  const brand = OA.data.workspace?.brand || 'openadmin';
  document.getElementById('sidebar').innerHTML = `
    <a href="#/${OA.esc(OA.data.home)}" class="oa-brand"><span class="oa-brand-logo">${OA.data.workspace?.logo ? `<img src="${OA.esc(OA.data.workspace.logo)}" width="30" height="30" alt="">` : OA.icon('panels-top-left',22)}</span><span class="oa-brand-text"><strong>${OA.esc(brand)}</strong><small>Admin workspace</small></span></a>
    <div class="oa-workspace-picker"><span class="oa-workspace-letter">${OA.esc((OA.siteName[0] || 'O').toUpperCase())}</span><span><b>${OA.esc(OA.siteName)}</b><small>Your workspace</small></span></div>
    <nav class="oa-nav" aria-label="Main navigation"><div class="oa-nav-label">Workspace</div>${find(primary)}
      ${extra.length ? `<details class="oa-more-nav" ${extra.some(n => n.path === currentPath()) ? 'open' : ''}><summary>${OA.icon('panels-top-left')}<span>More tools</span>${OA.icon('chevron-down',14)}</summary>${extra.map(navLink).join('')}</details>` : ''}
      ${hasUtilities ? `<div class="oa-nav-label oa-manage-label">Manage</div>${find(utility)}` : ''}
    </nav>
    ${OA.data.nav.some(n => n.path === 'plugins') ? `<div class="oa-sidebar-note">${OA.icon('plug',21)}<strong>Your workspace. Your rules.</strong><p>Connect your tools and make room for what matters.</p><a href="#/plugins">Explore integrations ${OA.icon('arrow-up-right',14)}</a></div>` : ''}
    <div class="oa-sidebar-foot"><div class="oa-profile">${OA.avatar(OA.me,34)}<span><b>${OA.esc(OA.me.name)}</b><small>Workspace admin</small></span><button class="oa-icon-btn" id="theme-btn" aria-label="Switch to ${OA.theme === 'dark' ? 'light' : 'dark'} theme">${OA.icon(OA.theme === 'dark' ? 'sun' : 'moon')}</button></div><span class="oa-open-source">Open source, always. <span>v${OA.esc(OA.version)}</span></span></div>`;
  document.getElementById('theme-btn').addEventListener('click', () => { OA.toggleTheme(); renderSidebar(); markActive(); document.getElementById('theme-btn')?.focus(); });
}
function markActive() {
  document.querySelectorAll('.oa-nav-item').forEach((node) => {
    const active = node.dataset.path === currentPath();
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
}

/* ── Topbar ────────────────────────────────────────────────────────────── */

function setNavOpen(open) {
  const compact = OA.isCompact();
  document.querySelector('.oa-main').inert = compact && open;
  document.getElementById('sidebar').inert = compact && !open;
  document.body.classList.toggle('oa-nav-open', open);
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', String(open));
  const scrim = document.getElementById('scrim');
  if (scrim) scrim.hidden = !open;
  if (open && compact) document.querySelector('.oa-nav-item.active, .oa-nav-item')?.focus();
}

function renderTopbar(title) {
  const path = currentPath();
  document.getElementById('topbar').innerHTML = `
    <div class="oa-topbar-leading"><button class="oa-menu-btn" id="menu-btn" aria-label="Open navigation" aria-expanded="false">${OA.icon('menu')}</button><span class="oa-breadcrumb">Workspace <span>/</span></span><h1 id="page-title">${OA.esc(NAV_TITLES[path] || title || 'Home')}</h1></div>
    <div class="oa-topbar-actions">${(OA.data.workspace?.links || []).map(link => `<a class="oa-btn secondary small oa-host-link" href="${OA.esc(link.href)}">${OA.esc(link.title)}</a>`).join('')}<span class="oa-connection" id="connection-status" role="status"></span><button class="oa-icon-btn" id="refresh-btn" aria-label="Refresh workspace">${OA.icon('refresh-cw',17)}</button></div>`;
  document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
  document.getElementById('menu-btn').addEventListener('click', () => setNavOpen(!document.body.classList.contains('oa-nav-open')));
  updateConnection();
}
function updateConnection() {
  const el = document.getElementById('connection-status');
  if (el) { el.className = 'oa-connection ' + OA.connection; el.innerHTML = '<i></i>' + ({live: 'Live workspace', connecting: 'Connecting…', reconnecting: 'Reconnecting…'}[OA.connection] || 'Connecting…'); }
}
OA.on('connection.changed', updateConnection);

/* ── Router ────────────────────────────────────────────────────────────── */

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return h || OA.data.home || 'dashboard';
}

let tableObserver;
let renderVersion = 0;
async function render() {
  const version = ++renderVersion;
  tableObserver?.disconnect();
  const path = currentPath();
  const nav = OA.data.nav.find((n) => n.path === path);
  const page = OA.pages.get(path);
  const content = document.getElementById('content');

  if (OA._cleanup) { try { OA._cleanup(); } catch { /* noop */ } OA._cleanup = null; }
  content.innerHTML = '';
  const pageRoot = document.createElement('div');
  pageRoot.className = 'oa-page-body';
  content.append(pageRoot);
  const manage = OA.data.workspace?.managementLinks?.[path];
  if (manage) {
    const bar = document.createElement('div');
    bar.className = 'oa-management-bar';
    bar.innerHTML = `<span>Connected to ${OA.esc(OA.siteName)}</span><a class="oa-btn secondary small" href="${OA.esc(manage.href)}">${OA.esc(manage.title)} ${OA.icon('arrow-up-right',14)}</a>`;
    pageRoot.before(bar);
  }
  pageRoot.innerHTML = '<div class="oa-loading" role="status">Loading workspace…</div>';
  tableObserver = new MutationObserver(() => OA.enhanceTables(pageRoot));
  tableObserver.observe(pageRoot, { childList: true, subtree: true });

  if (!page) {
    content.innerHTML = `
      <div class="oa-empty">
        <h2>404 — nothing lives at <code>/${OA.esc(path)}</code></h2>
        <p class="muted">Either no plugin provides this page, or the plugin that provides it is disabled.</p>
        <a class="oa-btn" href="#/${OA.esc(OA.data.home)}">← Take me home</a>
      </div>`;
  } else {
    try {
      const cleanup = await page.mount(pageRoot, OA);
      if (version !== renderVersion) { if (typeof cleanup === 'function') cleanup(); return; }
      OA._cleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch (err) {
      console.error('[open-admin] page crashed:', path, err);
      if (version !== renderVersion) return;
      pageRoot.innerHTML = OA.crashCard(nav?.pluginId || path, err.message);
    }
  }
  OA.fillSlots(pageRoot);
  OA.enhanceTables(pageRoot);

  markActive();
  document.querySelector('.oa-nav-item.active')?.closest('details')?.setAttribute('open', '');
  document.title = `${nav ? NAV_TITLES[path] || nav.title : 'Not found'} · ${OA.siteName}`;
  renderTopbar(nav?.title);
  // Compact mode: navigating picks a page and closes the drawer.
  if (window.matchMedia('(max-width: 900px)').matches) setNavOpen(false);
}

window.addEventListener('hashchange', render);
document.getElementById('scrim')?.addEventListener('click', () => setNavOpen(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setNavOpen(false); document.getElementById('menu-btn')?.focus(); }
  if (e.key === 'Tab' && OA.isCompact() && document.body.classList.contains('oa-nav-open')) {
    const nodes = [...document.getElementById('sidebar').querySelectorAll('a, button, summary, input')].filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});
window.matchMedia('(max-width: 900px)').addEventListener('change', () => setNavOpen(false));
renderSidebar();
setNavOpen(false);
render();
