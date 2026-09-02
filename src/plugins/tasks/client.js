/** Tasks client — a three-column board (Todo / Doing / Done) with live updates + dashboard summary widget. */

const STYLE = `
.oa-tasks-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; margin-top: 16px; }
@media (max-width: 960px) { .oa-tasks-board { grid-template-columns: 1fr; } }
.oa-tasks-col { background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; min-height: 120px; }
.oa-tasks-col h3 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); margin: 4px 4px 10px; display: flex; align-items: center; gap: 8px; }
.oa-tasks-col h3 .oa-tasks-count { background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; font-size: 11px; font-weight: 700; }
.oa-tasks-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 9px; box-shadow: 0 1px 2px rgba(16, 20, 40, 0.05); transition: border-color 0.15s, transform 0.15s; }
.oa-tasks-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.oa-tasks-title { font-weight: 600; font-size: 14.5px; line-height: 1.35; }
.oa-tasks-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.oa-tasks-assignee { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); min-width: 0; }
.oa-tasks-initial { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent-2)); flex: 0 0 auto; }
.oa-tasks-muted-init { background: var(--border); color: var(--muted); }
.oa-tasks-actions { display: inline-flex; gap: 4px; flex: 0 0 auto; }
.oa-tasks-act { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); font-size: 12px; display: grid; place-items: center; }
.oa-tasks-act:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.oa-tasks-act:disabled { opacity: 0.35; cursor: default; }
.oa-tasks-act.del:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: var(--danger); color: var(--danger); }
.oa-tasks-empty { color: var(--muted); font-size: 13px; text-align: center; padding: 18px 8px; border: 1px dashed var(--border); border-radius: 10px; }
.oa-tasks-summary-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; min-width: 0; }
.oa-tasks-summary-item .oa-tasks-summary-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

const PRIORITY_META = {
  high: { cls: 'error', label: 'High' },
  medium: { cls: 'warn', label: 'Medium' },
  low: { cls: 'info', label: 'Low' },
};
const STATUS_ORDER = ['todo', 'doing', 'done'];
const STATUS_LABELS = { todo: 'Todo', doing: 'Doing', done: 'Done' };

function taskCard(t, i, OA) {
  const p = PRIORITY_META[t.priority] || PRIORITY_META.medium;
  const idx = STATUS_ORDER.indexOf(t.status);
  const canLeft = idx > 0;
  const canRight = idx < STATUS_ORDER.length - 1;
  const who = t.assignee || 'Unassigned';
  const initial = t.assignee ? OA.esc(t.assignee[0].toUpperCase()) : '·';
  return `
    <div class="oa-tasks-card" data-id="${OA.esc(t.id)}" style="animation:oa-fadein .18s ease">
      <div class="oa-tasks-title">${OA.esc(t.title)}</div>
      <div><span class="oa-chip ${p.cls}">${p.label}</span></div>
      <div class="oa-tasks-foot">
        <span class="oa-tasks-assignee">
          <span class="oa-tasks-initial ${t.assignee ? '' : 'oa-tasks-muted-init'}">${initial}</span>${OA.esc(who)}
        </span>
        <span class="oa-tasks-actions">
          <button class="oa-tasks-act" data-move="left" title="Move to ${STATUS_LABELS[STATUS_ORDER[idx - 1]] || ''}" ${canLeft ? '' : 'disabled'}>◀</button>
          <button class="oa-tasks-act" data-move="right" title="Move to ${STATUS_LABELS[STATUS_ORDER[idx + 1]] || ''}" ${canRight ? '' : 'disabled'}>▶</button>
          <button class="oa-tasks-act del" data-del title="Delete">✕</button>
        </span>
      </div>
    </div>`;
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'tasks';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page: the board ────────────────────────────────────────────────── */
    OA.registerPage('tasks', {
      mount(el, OA) {
        let unsub = null;
        let tasks = [];

        function render() {
          const cols = { todo: [], doing: [], done: [] };
          for (const t of tasks) {
            if (cols[t.status]) cols[t.status].push(t);
          }
          el.innerHTML = `
            <div class="oa-page-head"><h2>✅ Tasks</h2>
              <p>${tasks.length} tasks · ${cols.todo.length} todo · ${cols.doing.length} in progress · ${cols.done.length} done — everything updates live</p></div>
            <form class="oa-card" id="oa-tasks-form">
              <h3 style="margin-bottom:10px">Add a task</h3>
              <div class="oa-form-row" style="margin:0">
                <input class="oa-input" name="title" placeholder="What needs doing?" required maxlength="120">
                <input class="oa-input" name="assignee" placeholder="Assignee (optional)" maxlength="60" style="flex:0 0 190px">
                <select class="oa-select" name="priority" style="flex:0 0 130px">
                  <option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option>
                </select>
                <button class="oa-btn" style="flex:0 0 auto">+ Add task</button>
              </div>
            </form>
            <div class="oa-tasks-board">
              ${STATUS_ORDER.map((s) => `
                <div class="oa-tasks-col">
                  <h3>${STATUS_LABELS[s]} <span class="oa-tasks-count">${cols[s].length}</span></h3>
                  ${cols[s].map((t) => taskCard(t, OA)).join('') || (s === 'todo'
                    ? '<div class="oa-tasks-empty">Nothing queued — add the first task above.</div>'
                    : `<div class="oa-tasks-empty">No ${s === 'doing' ? 'work in progress' : 'completed'} tasks. ${s === 'done' ? 'Move tasks here when they ship.' : 'Move one from Todo to start.'}</div>`)}
                </div>`).join('')}
            </div>`;

          el.querySelector('#oa-tasks-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
              await OA.api('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: fd.get('title'), assignee: fd.get('assignee'), priority: fd.get('priority') }),
              });
              OA.toast('✅ Task added to the board', 'success');
              e.target.reset();
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('.oa-tasks-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelectorAll('[data-move]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const t = tasks.find((x) => x.id === id);
                if (!t) return;
                const idx = STATUS_ORDER.indexOf(t.status);
                const next = btn.dataset.move === 'left' ? STATUS_ORDER[idx - 1] : STATUS_ORDER[idx + 1];
                if (!next) return;
                try {
                  await OA.api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
                } catch (err) {
                  OA.toast('⚠️ ' + OA.esc(err.message), 'error');
                }
              });
            });
            card.querySelector('[data-del]').addEventListener('click', async () => {
              try {
                await OA.api(`/api/tasks/${id}`, { method: 'DELETE' });
                OA.toast('🗑 Task removed', 'info');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
            });
          });
        }

        async function load() {
          const d = await OA.api('/api/tasks');
          tasks = d.tasks || [];
          render();
        }

        unsub = OA.on('tasks.changed', (p) => {
          if (p && Array.isArray(p.tasks)) { tasks = p.tasks; render(); }
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('tasks', err.message); });
        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: open count + next 3 by priority ──────────────── */
    OA.registerWidget('tasks-summary', {
      mount(el, OA) {
        let unsub = null;

        function renderTasks(tasks) {
          const open = tasks.filter((t) => t.status !== 'done');
          const rank = { high: 0, medium: 1, low: 2 };
          const next = [...open]
            .sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
              || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
            .slice(0, 3);
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${open.length}</span>
              <span class="lbl">✅ Open tasks</span>
              ${next.length ? next.map((t) => {
                const p = PRIORITY_META[t.priority] || PRIORITY_META.medium;
                return `<div class="oa-tasks-summary-item" title="${OA.esc(t.title)}">
                  <span class="oa-chip ${p.cls}">${p.label}</span>
                  <span class="oa-tasks-summary-title">${OA.esc(t.title)}</span></div>`;
              }).join('') : '<div class="muted" style="font-size:13px">All caught up — nothing open.</div>'}
              <a href="#/tasks" style="font-size:13px;font-weight:600">Open Tasks →</a>
            </div>`;
        }

        async function load() {
          const d = await OA.api('/api/tasks');
          renderTasks(d.tasks || []);
        }

        unsub = OA.on('tasks.changed', (p) => {
          if (p && Array.isArray(p.tasks)) renderTasks(p.tasks);
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('tasks', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
