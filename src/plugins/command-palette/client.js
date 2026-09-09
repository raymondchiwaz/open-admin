/**
 * Command Palette — client-only plugin. A keyboard-first launcher
 * (Ctrl/Cmd+K or the ⌘K pill in the topbar) that indexes every page in the
 * sidebar plus a handful of built-in actions: toggle theme, open the Social
 * feed, reload the admin, copy the API URL.
 *
 * The palette is one overlay appended to <body>, so re-renders of the shell
 * never wipe it. The ⌘K pill is re-injected whenever the shell rewrites the
 * topbar (it re-sets #topbar's innerHTML on every navigation).
 */

const BTN_ID = 'oa-cmdk-btn';
const OVERLAY_ID = 'oa-cmdk-overlay';
const INPUT_ID = 'oa-cmdk-input';
const LIST_ID = 'oa-cmdk-list';

const STYLE = `
.oa-cmdk-overlay {
  position: fixed; inset: 0; z-index: 9000; display: none;
  align-items: flex-start; justify-content: center; padding: 12vh 16px 16px;
  background: rgba(8, 10, 18, 0.48); backdrop-filter: blur(3px);
}
.oa-cmdk-overlay.open { display: flex; animation: oa-cmdk-in 0.14s ease; }
@keyframes oa-cmdk-in { from { opacity: 0; } to { opacity: 1; } }
.oa-cmdk-panel {
  width: 560px; max-width: 100%; display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid var(--border); border-radius: 16px;
  box-shadow: 0 24px 70px rgba(4, 8, 20, 0.45); overflow: hidden;
}
.oa-cmdk-inputrow { display: flex; align-items: center; gap: 10px; padding: 4px 16px; border-bottom: 1px solid var(--border); }
.oa-cmdk-inputrow .oa-cmdk-glyph { font-size: 16px; opacity: 0.7; }
.oa-cmdk-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  padding: 14px 0; font: inherit; font-size: 15.5px; color: var(--text);
}
.oa-cmdk-input::placeholder { color: var(--muted); }
.oa-cmdk-esc {
  flex: 0 0 auto; font-size: 11px; color: var(--muted); border: 1px solid var(--border);
  border-radius: 6px; padding: 1px 7px; background: var(--panel-2);
}
.oa-cmdk-list { max-height: 380px; overflow-y: auto; padding: 8px; }
.oa-cmdk-group {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); padding: 8px 10px 4px;
}
.oa-cmdk-item {
  display: flex; align-items: center; gap: 12px; padding: 9px 10px;
  border-radius: 10px; cursor: pointer; border: 1px solid transparent;
}
.oa-cmdk-item.sel { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 22%, transparent); }
.oa-cmdk-icon {
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: 9px; font-size: 17px;
  display: grid; place-items: center; background: var(--panel-2); border: 1px solid var(--border);
}
.oa-cmdk-main { flex: 1; min-width: 0; }
.oa-cmdk-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oa-cmdk-sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oa-cmdk-kbd {
  flex: 0 0 auto; font-size: 10.5px; color: var(--muted); background: var(--panel-2);
  border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
}
.oa-cmdk-mark { background: transparent; color: var(--accent); font-weight: 800; }
.oa-cmdk-empty { padding: 34px 16px; text-align: center; color: var(--muted); font-size: 13.5px; }
.oa-cmdk-empty b { color: var(--text); }
.oa-cmdk-foot {
  display: flex; gap: 14px; align-items: center; padding: 8px 16px;
  border-top: 1px solid var(--border); font-size: 11.5px; color: var(--muted);
}
.oa-cmdk-foot kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px;
  background: var(--panel-2); border: 1px solid var(--border); border-bottom-width: 2px;
  border-radius: 5px; padding: 0 5px; margin-right: 3px;
}
.oa-cmdk-pill { cursor: pointer; font-weight: 700; letter-spacing: 0.4px; font-size: 11.5px; }
`;

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Highlight the first case-insensitive occurrence of q inside text.
 *  Everything is escaped through OA.esc before it touches innerHTML. */
function highlight(OA, text, q) {
  const raw = String(text ?? '');
  const i = q ? raw.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return OA.esc(raw);
  return OA.esc(raw.slice(0, i))
    + '<mark class="oa-cmdk-mark">' + OA.esc(raw.slice(i, i + q.length)) + '</mark>'
    + OA.esc(raw.slice(i + q.length));
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'command-palette';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── command index (rebuilt on every open so it reflects live data) ── */
    function commands() {
      const cmds = [];
      for (const n of OA.data?.nav || []) {
        cmds.push({
          id: 'page:' + n.path,
          group: 'Pages',
          title: n.title || n.path,
          icon: n.icon || '📄',
          type: 'page',
          subtitle: `page · ${n.pluginId || 'unknown'}`,
          run: () => OA.navigate(n.path),
        });
      }
      cmds.push(
        {
          id: 'action:theme', group: 'Actions', title: 'Toggle theme', icon: '🌗',
          type: 'action', keywords: 'dark light appearance mode',
          subtitle: 'action · switch light / dark', run: () => OA.toggleTheme(),
        },
        {
          id: 'action:social', group: 'Actions', title: 'Go to Social feed', icon: '💬',
          type: 'action', keywords: 'feed posts activity',
          subtitle: 'action · open #/social', run: () => OA.navigate('social'),
        },
        {
          id: 'action:reload', group: 'Actions', title: 'Reload admin', icon: '⟳',
          type: 'action', keywords: 'refresh browser window',
          subtitle: 'action · window.location.reload()', run: () => location.reload(),
        },
        {
          id: 'action:copyapi', group: 'Actions', title: 'Copy admin API URL', icon: '🔗',
          type: 'action', keywords: 'clipboard copy link endpoint',
          subtitle: 'action · copies the /api base URL', run: () => {
            const url = location.origin + (OA.base || '') + '/api';
            const done = () => OA.toast('🔗 API URL copied: <code>' + OA.esc(url) + '</code>', 'success');
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(url).then(done, () => OA.toast('⚠️ Could not access the clipboard', 'error'));
            } else {
              OA.toast('⚠️ Clipboard is not available in this browser', 'error');
            }
          },
        },
      );
      return cmds;
    }

    /* ── overlay DOM (built once) ────────────────────────────────────────── */
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'oa-cmdk-overlay';
    overlay.innerHTML = `
      <div class="oa-cmdk-panel" role="dialog" aria-label="Command palette">
        <div class="oa-cmdk-inputrow">
          <span class="oa-cmdk-glyph">⌘</span>
          <input id="${INPUT_ID}" class="oa-cmdk-input" type="text" autocomplete="off"
            placeholder="Search pages and actions…" spellcheck="false">
          <span class="oa-cmdk-esc">esc</span>
        </div>
        <div class="oa-cmdk-list" id="${LIST_ID}"></div>
        <div class="oa-cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
          <span style="margin-left:auto">Open Admin · Command Palette</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#' + INPUT_ID);
    const list = overlay.querySelector('#' + LIST_ID);
    const state = { open: false, q: '', sel: 0, filtered: [], all: [] };

    /* ── filtering + rendering ───────────────────────────────────────────── */
    function rank(cmd) {
      const q = state.q.toLowerCase();
      if (!q) return 0;
      return cmd.title.toLowerCase().startsWith(q) ? 0 : 1;
    }
    function matches(cmd) {
      const q = state.q.trim().toLowerCase();
      if (!q) return true;
      return cmd.title.toLowerCase().includes(q)
        || cmd.type.toLowerCase().includes(q)
        || (cmd.subtitle || '').toLowerCase().includes(q)
        || (cmd.keywords || '').toLowerCase().includes(q);
    }
    function refilter(keepSelection = false) {
      const prev = keepSelection ? (state.filtered[state.sel] || {}).id : null;
      state.filtered = state.all.filter(matches).sort((a, b) =>
        rank(a) - rank(b) || a.title.localeCompare(b.title));
      const prevIdx = state.filtered.findIndex((c) => c.id === prev);
      state.sel = prevIdx >= 0 ? prevIdx : 0;
      render();
    }

    function render() {
      const q = state.q.trim();
      if (!state.filtered.length) {
        list.innerHTML = `<div class="oa-cmdk-empty">${q
          ? `No commands match <b>“${OA.esc(q)}”</b> — try something else.`
          : 'Nothing to run yet.'}</div>`;
        return;
      }
      let lastGroup = null;
      list.innerHTML = state.filtered.map((c, i) => {
        const head = c.group !== lastGroup
          ? `<div class="oa-cmdk-group">${OA.esc(c.group)}</div>` : '';
        lastGroup = c.group;
        return `${head}
          <div class="oa-cmdk-item ${i === state.sel ? 'sel' : ''}" data-i="${i}" data-cmd="${OA.esc(c.id)}">
            <span class="oa-cmdk-icon">${OA.esc(c.icon || '⌘')}</span>
            <span class="oa-cmdk-main">
              <span class="oa-cmdk-title">${highlight(OA, c.title, q)}</span><br>
              <span class="oa-cmdk-sub">${highlight(OA, c.subtitle || '', q)}</span>
            </span>
            <span class="oa-cmdk-kbd">${OA.esc(c.type)}</span>
          </div>`;
      }).join('');
      list.querySelector('.oa-cmdk-item.sel')?.scrollIntoView({ block: 'nearest' });
    }

    /* ── open / close / run ──────────────────────────────────────────────── */
    function open() {
      if (state.open) return;
      state.open = true;
      state.q = '';
      state.all = commands();
      overlay.classList.add('open');
      input.value = '';
      refilter();
      input.focus();
    }
    function close() {
      if (!state.open) return;
      state.open = false;
      overlay.classList.remove('open');
      input.blur();
    }
    function run(cmd) {
      close();
      if (cmd) setTimeout(() => { try { cmd.run(); } catch (err) { console.error('[command-palette]', err); } }, 0);
    }
    function move(delta) {
      if (!state.filtered.length) return;
      state.sel = (state.sel + delta + state.filtered.length) % state.filtered.length;
      render();
    }

    /* ── events ──────────────────────────────────────────────────────────── */
    input.addEventListener('input', () => { state.q = input.value; refilter(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(state.filtered[state.sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); } // trap focus in the input
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.oa-cmdk-item');
      if (row) run(state.filtered[Number(row.dataset.i)]);
    });
    list.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.oa-cmdk-item');
      if (row && Number(row.dataset.i) !== state.sel) { state.sel = Number(row.dataset.i); render(); }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        state.open ? close() : open();
      }
    }, true);
    // Escape closes from anywhere while the palette is open (the input
    // handler already handles it when focus is in the input).
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) {
        e.preventDefault();
        close();
      }
    });
    window.addEventListener('oa-cmdk:open', open);

    /* ── ⌘K pill — survives topbar re-renders via MutationObserver ───────── */
    function injectPill() {
      const actions = document.querySelector('.oa-topbar-actions');
      if (!actions || document.getElementById(BTN_ID)) return;
      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.className = 'oa-pill oa-cmdk-pill';
      btn.type = 'button';
      btn.title = 'Command palette (Ctrl/Cmd+K)';
      btn.setAttribute('aria-label', 'Open command palette');
      btn.innerHTML = `${OA.icon('search', 14)}<span class="oa-search-label">Find a page or action</span><kbd>Ctrl K</kbd>`;
      btn.addEventListener('click', open);
      actions.appendChild(btn);
    }
    injectPill();
    const mo = new MutationObserver(() => injectPill());
    const topbar = document.getElementById('topbar');
    if (topbar) mo.observe(topbar, { childList: true, subtree: true });
  },
};
