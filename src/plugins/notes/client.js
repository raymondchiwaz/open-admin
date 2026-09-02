/** Notes client — a responsive wall of colored sticky notes, with inline edit, pin + dashboard widget. */

const STYLE = `
.oa-notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
.oa-notes-card {
  border-radius: var(--radius); padding: 14px 16px; border: 1px solid transparent;
  box-shadow: var(--shadow); cursor: pointer; display: flex; flex-direction: column; gap: 10px;
  min-height: 132px; transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.oa-notes-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(16, 20, 40, 0.12); }
.oa-notes-c0 { background: color-mix(in srgb, #fb923c 16%, var(--panel)); border-color: color-mix(in srgb, #fb923c 35%, var(--border)); }
.oa-notes-c1 { background: color-mix(in srgb, #ec4899 14%, var(--panel)); border-color: color-mix(in srgb, #ec4899 32%, var(--border)); }
.oa-notes-c2 { background: color-mix(in srgb, #22c55e 14%, var(--panel)); border-color: color-mix(in srgb, #22c55e 32%, var(--border)); }
.oa-notes-c3 { background: color-mix(in srgb, #3b82f6 14%, var(--panel)); border-color: color-mix(in srgb, #3b82f6 32%, var(--border)); }
.oa-notes-c4 { background: color-mix(in srgb, #8b5cf6 14%, var(--panel)); border-color: color-mix(in srgb, #8b5cf6 32%, var(--border)); }
.oa-notes-c5 { background: color-mix(in srgb, #eab308 16%, var(--panel)); border-color: color-mix(in srgb, #eab308 35%, var(--border)); }
.oa-notes-body { flex: 1; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.oa-notes-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
.oa-notes-pin { margin-left: auto; }
.oa-notes-actions { display: inline-flex; gap: 4px; flex: 0 0 auto; }
.oa-notes-btn { width: 28px; height: 28px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--muted) 30%, var(--border)); background: color-mix(in srgb, var(--panel) 70%, transparent); font-size: 13px; display: grid; place-items: center; }
.oa-notes-btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.oa-notes-btn[data-act="pin"].on { background: var(--accent-soft); border-color: var(--accent); }
.oa-notes-btn[data-act="del"]:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); }
.oa-notes-edit { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.oa-notes-add { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; cursor: default; }
.oa-notes-add textarea { min-height: 72px; resize: vertical; }
.oa-notes-colors { display: flex; gap: 8px; }
.oa-notes-dot { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.oa-notes-dot.sel { border-color: var(--text); transform: scale(1.12); }
.oa-notes-live { animation: oa-fadein 0.18s ease; }
.oa-notes-widget-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; min-width: 0; }
.oa-notes-widget-item .oa-notes-widget-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-notes-widget-swatch { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px; }
`;

/** Watch `el` and run `done` once it is detached (widgets have no cleanup hook). */
function onceDetached(el, done) {
  const content = document.getElementById('content');
  if (!content) return;
  const mo = new MutationObserver(() => {
    if (!el.isConnected) { mo.disconnect(); done(); }
  });
  mo.observe(content, { childList: true, subtree: true });
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'notes';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page: the wall ─────────────────────────────────────────────────── */
    OA.registerPage('notes', {
      mount(el, OA) {
        let unsub = null;
        let notes = [];
        let editingId = null;   // note id currently in edit mode
        let color = 3;          // selected dot color for new notes

        function gridHtml() {
          return notes.map((n) => {
            const isEditing = n.id === editingId;
            return `
              <div class="oa-notes-card oa-notes-c${n.color ?? 0} oa-notes-live${isEditing ? ' oa-notes-editing' : ''}" data-id="${OA.esc(n.id)}">
                ${isEditing ? `
                  <div class="oa-notes-edit">
                    <textarea class="oa-input" data-edit-text maxlength="500" style="min-height:90px;resize:vertical">${OA.esc(n.text)}</textarea>
                    <div class="oa-form-row" style="margin:0">
                      <button class="oa-btn small" data-act="save">Save</button>
                      <button class="oa-btn secondary small" data-act="cancel">Cancel</button>
                    </div>
                  </div>` : `
                  <div class="oa-notes-body">${OA.md(n.text)}</div>`}
                <div class="oa-notes-foot">
                  <span>${OA.esc(n.author || 'Admin')} · ${OA.timeAgo(n.createdAt)}</span>
                  ${!isEditing ? `
                  <span class="oa-notes-actions">
                    <button class="oa-notes-btn ${n.pinned ? 'on' : ''}" data-act="pin" title="${n.pinned ? 'Unpin' : 'Pin'}">📌</button>
                    <button class="oa-notes-btn" data-act="edit" title="Edit">✏️</button>
                    <button class="oa-notes-btn" data-act="del" title="Delete">🗑</button>
                  </span>` : ''}
                  ${n.pinned ? '<span class="oa-notes-pin" title="Pinned">📌</span>' : ''}
                </div>
              </div>`;
          }).join('');
        }

        function render() {
          el.innerHTML = `
            <div class="oa-page-head"><h2>📝 Team Notes</h2>
              <p>${notes.length} notes · pinned first · every change appears in real time</p></div>
            <div class="oa-notes-grid">
              <div class="oa-card oa-notes-add">
                <h3 style="margin:0">＋ New note</h3>
                <textarea class="oa-input" id="oa-notes-text" maxlength="500" placeholder="Write a note… (up to 500 chars)"></textarea>
                <div class="oa-notes-colors">
                  ${[0, 1, 2, 3, 4, 5].map((c) =>
                    `<button class="oa-notes-dot oa-notes-c${c} ${c === color ? 'sel' : ''}" data-color="${c}" title="Color ${c + 1}"></button>`).join('')}
                </div>
                <div class="oa-form-row" style="margin:0">
                  <button class="oa-btn" id="oa-notes-add" style="flex:0 0 auto">+ Add note</button>
                  <span class="muted" style="align-self:center;font-size:12.5px">Tip: click a note to edit it in place.</span>
                </div>
              </div>
              ${gridHtml() || '<div class="oa-card muted" style="grid-column:1/-1;text-align:center;padding:40px">No notes yet — leave the first one for the team!</div>'}
            </div>`;

          el.querySelectorAll('.oa-notes-dot').forEach((dot) => {
            dot.addEventListener('click', () => {
              color = Number(dot.dataset.color);
              el.querySelectorAll('.oa-notes-dot').forEach((d) => d.classList.toggle('sel', d === dot));
            });
          });
          el.querySelector('#oa-notes-add').addEventListener('click', async () => {
            const text = el.querySelector('#oa-notes-text').value.trim();
            if (!text) { OA.toast('✏️ Write something first', 'warn'); return; }
            try {
              await OA.api('/api/notes', { method: 'POST', body: JSON.stringify({ text, color }) });
              OA.toast('📝 Note added to the wall', 'success');
              el.querySelector('#oa-notes-text').value = '';
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('.oa-notes-card:not(.oa-notes-editing)').forEach((card) => {
            const id = card.dataset.id;
            // Click the card body to edit in place (buttons handle their own actions).
            card.addEventListener('click', (e) => {
              if (e.target.closest('.oa-notes-actions')) return;
              editingId = id;
              render();
            });
            card.querySelector('[data-act="pin"]')?.addEventListener('click', async () => {
              const note = notes.find((x) => x.id === id);
              if (!note) return;
              try {
                await OA.api(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !note.pinned }) });
                OA.toast(note.pinned ? '📌 Unpinned' : '📌 Pinned to the top', 'info');
              } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
            });
            card.querySelector('[data-act="edit"]')?.addEventListener('click', () => { editingId = id; render(); });
            card.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
              try {
                await OA.api(`/api/notes/${id}`, { method: 'DELETE' });
                OA.toast('🗑 Note deleted', 'info');
              } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
            });
          });

          const editCard = el.querySelector('.oa-notes-edit');
          if (editCard) {
            editCard.querySelector('[data-act="save"]').addEventListener('click', async () => {
              const text = editCard.querySelector('[data-edit-text]').value.trim();
              if (!text) { OA.toast('✏️ Notes cannot be empty', 'warn'); return; }
              try {
                await OA.api(`/api/notes/${editingId}`, { method: 'PATCH', body: JSON.stringify({ text }) });
                editingId = null;
                OA.toast('✅ Note updated', 'success');
              } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
            });
            editCard.querySelector('[data-act="cancel"]').addEventListener('click', () => { editingId = null; render(); });
          }
        }

        async function load() {
          const d = await OA.api('/api/notes');
          notes = d.notes || [];
          render();
        }

        unsub = OA.on('notes.changed', (p) => {
          if (!p || !Array.isArray(p.notes)) return;
          // Keep an edit open if the note being edited still exists.
          if (editingId && !p.notes.some((x) => x.id === editingId)) editingId = null;
          notes = p.notes;
          render();
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('notes', err.message); });
        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: pinned + 2 latest ────────────────────────────── */
    OA.registerWidget('notes-recent', {
      mount(el, OA) {
        let unsub = null;

        function renderNotes(notes) {
          const pinned = notes.filter((n) => n.pinned).slice(0, 1);
          const latest = notes.filter((n) => !n.pinned).slice(0, 2);
          const items = [...pinned, ...latest];
          el.innerHTML = `
            <div class="oa-card">
              <h3 style="font-size:14px;margin-bottom:8px">📝 Team notes</h3>
              ${items.length ? items.map((n) => `
                <div class="oa-notes-widget-item">
                  <span class="oa-notes-widget-swatch oa-notes-c${n.color ?? 0}"></span>
                  <span class="oa-notes-widget-text" title="${OA.esc(n.text)}">${n.pinned ? '📌 ' : ''}${OA.esc(n.text.length > 64 ? n.text.slice(0, 61) + '…' : n.text)}</span>
                </div>`).join('') : '<div class="muted" style="font-size:13px">Nothing pinned yet — the latest notes show here.</div>'}
              <a href="#/notes" style="font-size:13px;font-weight:600">Open Team Notes →</a>
            </div>`;
        }

        async function load() {
          const d = await OA.api('/api/notes');
          renderNotes(d.notes || []);
        }

        unsub = OA.on('notes.changed', (p) => {
          if (p && Array.isArray(p.notes)) renderNotes(p.notes);
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('notes', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
