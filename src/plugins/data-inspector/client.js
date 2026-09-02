/** Data Inspector client — read-only JSON store explorer. */

const STYLE = `
.oa-inspector-layout { display: flex; gap: 16px; align-items: flex-start; }
.oa-inspector-side { flex: 0 0 230px; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 14px; }
@media (max-width: 900px) { .oa-inspector-layout { flex-direction: column; } .oa-inspector-side { position: static; width: 100%; flex: 1; } }
.oa-inspector-nav-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 0; padding: 9px 10px; border-radius: 9px; cursor: pointer; font-size: 13.5px; color: var(--text); font-family: inherit; }
.oa-inspector-nav-item:hover { background: var(--panel-2); }
.oa-inspector-nav-item.active { background: var(--accent-soft); font-weight: 600; }
.oa-inspector-nav-item .oa-inspector-count { margin-left: auto; font-size: 11px; color: var(--muted); }
.oa-inspector-main { flex: 1; min-width: 0; }
.oa-inspector-doc { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; }
.oa-inspector-doc:hover { border-color: var(--accent); }
.oa-inspector-doc .oa-inspector-json { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; margin-top: 6px; white-space: pre-wrap; word-break: break-all; }
.oa-inspector-doc .oa-inspector-preview { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'data-inspector';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('data-inspector', {
      mount(el, OA) {
        const state = { mode: 'welcome', collection: null, skip: 0, limit: 50, q: '' };

        /** Re-render the whole page shell (sidebar + main). */
        async function render() {
          const o = await OA.api('/api/data-inspector/overview');
          const collections = o.collections.filter((c) => c.name !== 'kv');
          el.innerHTML = `
            <div class="oa-page-head"><h2>🗄️ Data Inspector</h2>
              <p>Read-only peek at the JSON store behind Open Admin — no edits, no writes. Data lives in <code>${OA.esc(o.dataDir)}</code>.</p></div>
            <div class="oa-inspector-layout">
              <div class="oa-inspector-side">
                <div class="oa-card" style="padding:10px">
                  <h3 style="margin-bottom:6px;font-size:13px">Collections</h3>
                  ${collections.length ? collections.map((c) => `
                    <button class="oa-inspector-nav-item" data-nav-collection="${OA.esc(c.name)}">
                      <span>${OA.esc(c.name)}</span><span class="oa-inspector-count">${c.docs ?? '—'}</span>
                    </button>`).join('') : '<div class="muted" style="font-size:12px;padding:4px 2px">No collection files yet.</div>'}
                  <button class="oa-inspector-nav-item" data-nav-kv style="margin-top:6px;border-top:1px solid var(--border);border-radius:0 0 9px 9px;padding-top:12px">🔑 kv store</button>
                </div>
                <div class="oa-card" style="padding:10px">
                  <input class="oa-input" id="oa-inspector-q" placeholder="Search docs…" value="${OA.esc(state.q)}" style="width:100%">
                  <button class="oa-btn secondary small" id="oa-inspector-search" style="margin-top:8px;width:100%">🔍 Search</button>
                </div>
              </div>
              <div class="oa-inspector-main" id="oa-inspector-main"></div>
            </div>`;

          // wire sidebar
          el.querySelectorAll('[data-nav-collection]').forEach((b) => {
            b.addEventListener('click', () => {
              state.mode = 'collection';
              state.collection = b.dataset.navCollection;
              state.skip = 0;
              renderMain();
              markActive();
            });
          });
          el.querySelector('[data-nav-kv]').addEventListener('click', () => {
            state.mode = 'kv';
            renderMain();
            markActive();
          });
          el.querySelector('#oa-inspector-search').addEventListener('click', doSearch);
          el.querySelector('#oa-inspector-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
          markActive();
          renderMain();
        }

        function markActive() {
          el.querySelectorAll('[data-nav-collection]').forEach((b) => {
            b.classList.toggle('active', state.mode === 'collection' && b.dataset.navCollection === state.collection);
          });
          el.querySelector('[data-nav-kv]').classList.toggle('active', state.mode === 'kv');
        }

        async function doSearch() {
          const q = el.querySelector('#oa-inspector-q').value.trim();
          if (!q) return;
          state.mode = 'search';
          state.q = q;
          renderMain();
        }

        async function renderMain() {
          const main = el.querySelector('#oa-inspector-main');
          if (!main) return;
          if (state.mode === 'collection') return renderCollection(main);
          if (state.mode === 'kv') return renderKv(main);
          if (state.mode === 'search') return renderSearch(main);
          main.innerHTML = `
            <div class="oa-card">
              <h3 style="margin-bottom:8px">Welcome 👋</h3>
              <p class="muted" style="font-size:13.5px;line-height:1.55">The store is a handful of JSON files inside <code>.open-admin-data</code> (see the path above):
                one array file per plugin collection, plus a shared <code>kv.json</code> key/value store.
                Pick a collection on the left to browse docs, open <b>🔑 kv store</b> for the namespaced keys
                (secret-looking values are masked as <b>•••</b>), or search everything on the right.
                This inspector is strictly read-only.</p>
            </div>`;
        }

        function pagination(total, onPrev, onNext) {
          const page = Math.floor(state.skip / state.limit) + 1;
          const pages = Math.max(1, Math.ceil(total / state.limit));
          return `
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
              <button class="oa-btn secondary small" data-docs-prev ${state.skip <= 0 ? 'disabled' : ''}>← Prev</button>
              <span class="muted" style="font-size:12.5px">page ${page} / ${pages} · ${total} docs</span>
              <button class="oa-btn secondary small" data-docs-next ${state.skip + state.limit >= total ? 'disabled' : ''}>Next →</button>
              <button class="oa-btn secondary small" data-docs-refresh style="margin-left:auto">↻ Refresh</button>
            </div>`;
        }

        function wirePagination(main, total) {
          main.querySelector('[data-docs-refresh]')?.addEventListener('click', renderMain);
          main.querySelector('[data-docs-prev]')?.addEventListener('click', () => {
            state.skip = Math.max(0, state.skip - state.limit);
            renderMain();
          });
          main.querySelector('[data-docs-next]')?.addEventListener('click', () => {
            state.skip += state.limit;
            renderMain();
          });
        }

        async function renderCollection(main) {
          main.innerHTML = '<div class="muted" style="padding:12px 2px">Loading…</div>';
          const data = await OA.api(`/api/data-inspector/collections/${encodeURIComponent(state.collection)}?limit=${state.limit}&skip=${state.skip}`);
          main.innerHTML = `
            <div class="oa-card">
              <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap">
                <h3 style="margin:0">${OA.esc(data.name)}</h3>
                <span class="muted" style="font-size:12.5px">${data.total} docs · ${encodeURIComponent(state.collection)}</span>
              </div>
              ${data.docs.length ? data.docs.map((doc) => safeDoc(doc)).join('') :
                '<div class="muted" style="padding:14px 2px">This collection has no docs (yet).</div>'}
              ${pagination(data.total)}
            </div>`;
          wirePagination(main, data.total);
          main.querySelectorAll('[data-doc]').forEach((row) => {
            row.addEventListener('click', () => {
              const pre = row.querySelector('pre');
              if (!pre) return;
              const hidden = pre.hidden;
              pre.hidden = !hidden;
              const meta = row.querySelector('[data-doc-preview]');
              if (meta) meta.style.display = hidden ? 'none' : 'block';
            });
          });
        }

        function safeDoc(doc) {
          const id = OA.esc(doc && doc.id || '—');
          const created = doc && doc.createdAt ? OA.esc(doc.createdAt) : null;
          const json = JSON.stringify(doc, null, 2);
          return `
            <div class="oa-inspector-doc" data-doc>
              <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
                <strong class="muted" style="font-size:12px">${id}</strong>
                ${created ? `<span class="muted" style="font-size:11.5px" title="${created}">created ${OA.timeAgo(created)} ago</span>` : ''}
              </div>
              <div class="oa-inspector-preview" data-doc-preview>${OA.esc(json)}</div>
              <pre class="oa-inspector-json" hidden>${OA.esc(json)}</pre>
            </div>`;
        }

        async function renderKv(main) {
          main.innerHTML = '<div class="muted" style="padding:12px 2px">Loading…</div>';
          const { kv } = await OA.api('/api/data-inspector/kv');
          main.innerHTML = `
            <div class="oa-card">
              <h3 style="margin-bottom:8px">Key/value store <span class="muted" style="font-size:12px;font-weight:400">(${kv.length} keys · secret-looking values masked)</span></h3>
              ${kv.length ? `
                <table class="oa-table">
                  <thead><tr><th>Key</th><th>Value</th></tr></thead>
                  <tbody>
                    ${kv.map((e) => `
                      <tr><td><code>${OA.esc(e.key)}</code></td><td class="muted" style="word-break:break-all;font-size:12.5px">${OA.esc(e.value)}</td></tr>`).join('')}
                  </tbody>
                </table>` : '<div class="muted">kv store is empty.</div>'}
              <div style="margin-top:10px"><button class="oa-btn secondary small" data-docs-refresh>↻ Refresh</button></div>
            </div>`;
          main.querySelector('[data-docs-refresh]').addEventListener('click', renderMain);
        }

        async function renderSearch(main) {
          main.innerHTML = '<div class="muted" style="padding:12px 2px">Searching…</div>';
          const { matches } = await OA.api('/api/data-inspector/search?q=' + encodeURIComponent(state.q));
          main.innerHTML = `
            <div class="oa-card">
              <h3 style="margin-bottom:8px">Search: “${OA.esc(state.q)}”</h3>
              ${matches.length ? matches.map((m) => `
                <div class="oa-inspector-doc" data-doc>
                  <div><span class="oa-chip info">${OA.esc(m.collection)}</span></div>
                  <div class="oa-inspector-preview" data-doc-preview>${OA.esc(JSON.stringify(m.doc))}</div>
                  <pre class="oa-inspector-json" hidden>${OA.esc(JSON.stringify(m.doc, null, 2))}</pre>
                </div>`).join('') : `<div class="muted">No docs match “${OA.esc(state.q)}”.</div>`}
            </div>`;
          main.querySelectorAll('[data-doc]').forEach((row) => {
            row.addEventListener('click', () => {
              const pre = row.querySelector('pre');
              if (!pre) return;
              const hidden = pre.hidden;
              pre.hidden = !hidden;
              const meta = row.querySelector('[data-doc-preview]');
              if (meta) meta.style.display = hidden ? 'none' : 'block';
            });
          });
        }

        render().catch((err) => { el.innerHTML = OA.crashCard('data-inspector', err.message); });
      },
    });
  },
};
