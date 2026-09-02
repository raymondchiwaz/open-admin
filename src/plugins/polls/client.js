/** Polls client — poll cards with inline voting, live result bars + dashboard widget. */

const STYLE = `
.oa-polls-list { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.oa-polls-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
.oa-poll-card { display: flex; flex-direction: column; gap: 12px; }
.oa-poll-question { font-size: 16px; font-weight: 700; line-height: 1.35; }
.oa-poll-options { display: flex; flex-direction: column; gap: 8px; }
.oa-poll-option {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--panel-2); cursor: pointer; font-size: 14px; transition: border-color 0.15s;
}
.oa-poll-option:hover { border-color: var(--accent); }
.oa-poll-option input[type="radio"] { accent-color: var(--accent); flex: 0 0 auto; }
.oa-poll-results { display: flex; flex-direction: column; gap: 8px; }
.oa-poll-bar-row { display: grid; grid-template-columns: minmax(90px, 130px) 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
.oa-poll-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-poll-track { height: 10px; border-radius: 7px; background: var(--panel-2); border: 1px solid var(--border); overflow: hidden; }
.oa-poll-track i { display: block; height: 100%; border-radius: 7px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.4s ease; }
.oa-poll-count { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 34px; text-align: right; }
.oa-poll-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.oa-poll-card.oa-wid { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
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

function getVoter() {
  let v = localStorage.getItem('oa-polls-voter');
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem('oa-polls-voter', v);
  }
  return v;
}

function resultsHtml(poll, OA) {
  const total = poll.options.reduce((s, o) => s + (o.votes || 0), 0);
  return `
    <div class="oa-poll-results">
      ${poll.options.map((o) => {
        const pct = total ? Math.round(((o.votes || 0) / total) * 100) : 0;
        return `<div class="oa-poll-bar-row">
          <span class="oa-poll-label" title="${OA.esc(o.label)}">${OA.esc(o.label)}</span>
          <div class="oa-poll-track"><i style="width:${pct}%"></i></div>
          <span class="oa-poll-count">${o.votes || 0}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="muted" style="font-size:12.5px;display:flex;justify-content:space-between">
      <span>${total} total vote${total === 1 ? '' : 's'}</span>
      <span>${poll.voted.length ? '🏆 winner: ' + OA.esc(topLabel(poll)) : ''}</span>
    </div>`;
}

function topLabel(poll) {
  const top = Math.max(0, ...poll.options.map((o) => o.votes || 0));
  return poll.options.filter((o) => (o.votes || 0) === top).map((o) => o.label).join(' + ') || 'nobody';
}

function pollCard(poll, OA, { widget = false } = {}) {
  const voterId = getVoter();
  const voted = (poll.voted || []).includes(voterId);
  const cls = widget ? 'oa-poll-card oa-wid' : 'oa-card oa-poll-card';
  return `
    <div class="${cls}" data-id="${OA.esc(poll.id)}" style="animation:oa-fadein .18s ease">
      <div class="oa-poll-question">${OA.esc(poll.question)}
        ${poll.open ? '<span class="oa-chip ok" style="margin-left:8px;vertical-align:2px">Open</span>'
          : '<span class="oa-chip" style="margin-left:8px;vertical-align:2px">Closed</span>'}
      </div>
      ${poll.open && !voted ? `
        <div class="oa-poll-options">
          ${poll.options.map((o) => `
            <label class="oa-poll-option">
              <input type="radio" name="oa-poll-opt-${OA.esc(poll.id)}" value="${OA.esc(o.id)}">
              <span>${OA.esc(o.label)}</span>
            </label>`).join('')}
        </div>
        <div class="oa-form-row" style="margin:0">
          <button class="oa-btn small" data-act="vote" style="flex:0 0 auto">Vote</button>
          ${poll.open && !widget ? '<button class="oa-btn secondary small" data-act="close" style="flex:0 0 auto">Close poll</button>' : ''}
        </div>` : `
        ${resultsHtml(poll, OA)}
        ${poll.open && !widget ? `
          <div class="oa-form-row" style="margin:0">
            <span class="muted" style="font-size:12.5px;align-self:center">${voted ? '✔ You voted' : 'Voting closed'}</span>
            <button class="oa-btn secondary small" data-act="close" style="flex:0 0 auto;margin-left:auto">Close poll</button>
          </div>` : ''}
        ${poll.open && widget ? `<span class="muted" style="font-size:12px">✔ You voted</span>` : ''}`}
    </div>`;
}

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'polls';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── Page ───────────────────────────────────────────────────────────── */
    OA.registerPage('polls', {
      mount(el, OA) {
        let unsub = null;
        let polls = [];

        function optionInputsHtml() {
          return `
            <div class="oa-form-row" style="margin:0">
              <input class="oa-input" data-opt placeholder="Option 1" maxlength="120">
              <input class="oa-input" data-opt placeholder="Option 2" maxlength="120">
            </div>`;
        }

        function render() {
          const open = polls.filter((p) => p.open);
          const closed = polls.filter((p) => !p.open);
          el.innerHTML = `
            <div class="oa-page-head"><h2>🗳️ Polls</h2>
              <p>${open.length} open · ${closed.length} closed — live results, one vote per browser</p></div>
            <form class="oa-card" id="oa-polls-form" style="margin-top:12px">
              <h3 style="margin-bottom:10px">Create a poll</h3>
              <input class="oa-input" name="question" placeholder="What do you want to ask?" required maxlength="200">
              <div id="oa-polls-opts" style="margin:10px 0">${optionInputsHtml()}</div>
              <div class="oa-form-row" style="margin:0">
                <button class="oa-btn secondary small" type="button" id="oa-polls-addopt">+ Add option</button>
                <button class="oa-btn" style="flex:0 0 auto">Publish poll</button>
              </div>
            </form>
            <div class="oa-polls-grid">
              ${polls.map((p) => pollCard(p, OA)).join('') || '<div class="oa-card muted" style="grid-column:1/-1;text-align:center;padding:40px">No polls yet — create the first one above.</div>'}
            </div>`;

          // Create form
          el.querySelector('#oa-polls-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const options = [...el.querySelectorAll('[data-opt]')].map((i) => i.value.trim()).filter(Boolean);
            if (options.length < 2) { OA.toast('🗳️ Add at least two options', 'warn'); return; }
            try {
              await OA.api('/api/polls', {
                method: 'POST',
                body: JSON.stringify({ question: fd.get('question'), options }),
              });
              OA.toast('🗳️ Poll published — check the Social feed', 'success');
              e.target.reset();
              el.querySelector('#oa-polls-opts').innerHTML = optionInputsHtml();
            } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
          });
          el.querySelector('#oa-polls-addopt').addEventListener('click', () => {
            const opts = el.querySelector('#oa-polls-opts');
            if (opts.querySelectorAll('[data-opt]').length >= 4) {
              OA.toast('📄 Max 4 options in the form', 'info');
              return;
            }
            const wrap = opts.querySelector('.oa-form-row');
            const input = document.createElement('input');
            input.className = 'oa-input';
            input.dataset.opt = '';
            input.placeholder = `Option ${opts.querySelectorAll('[data-opt]').length + 1}`;
            input.maxLength = 120;
            wrap.appendChild(input);
          });

          // Vote / close
          el.querySelectorAll('.oa-poll-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('[data-act="vote"]')?.addEventListener('click', async () => {
              const selected = card.querySelector('input[type="radio"]:checked');
              if (!selected) { OA.toast('🗳️ Pick an option first', 'warn'); return; }
              try {
                await OA.api(`/api/polls/${id}/vote`, {
                  method: 'POST',
                  body: JSON.stringify({ optionId: selected.value, voterId: getVoter() }),
                });
                OA.toast('🗳️ Vote counted!', 'success');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
                load();
              }
            });
            card.querySelector('[data-act="close"]')?.addEventListener('click', async () => {
              try {
                await OA.api(`/api/polls/${id}/close`, { method: 'POST' });
                OA.toast('🏁 Poll closed — winner announced', 'success');
              } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
            });
          });
        }

        async function load() {
          const d = await OA.api('/api/polls');
          polls = d.polls || [];
          render();
        }

        unsub = OA.on('polls.changed', (p) => {
          if (p && Array.isArray(p.polls)) { polls = p.polls; render(); }
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('polls', err.message); });
        return () => { if (unsub) unsub(); };
      },
    });

    /* ── Dashboard widget: first open poll, inline vote ─────────────────── */
    OA.registerWidget('polls-active', {
      mount(el, OA) {
        let unsub = null;

        function renderPolls(polls) {
          const open = polls.find((p) => p.open);
          el.innerHTML = open
            ? pollCard(open, OA, { widget: true })
            : `
              <div class="oa-card oa-stat">
                <span class="num">${polls.length}</span>
                <span class="lbl">🗳️ Polls</span>
                <div class="muted" style="font-size:13px">No open polls right now — create one from the Polls page.</div>
                <a href="#/polls" style="font-size:13px;font-weight:600">Go to Polls →</a>
              </div>`;

          const voteBtn = el.querySelector('[data-act="vote"]');
          if (voteBtn) {
            voteBtn.addEventListener('click', async () => {
              const card = voteBtn.closest('.oa-poll-card');
              const selected = card && card.querySelector('input[type="radio"]:checked');
              if (!selected) { OA.toast('🗳️ Pick an option first', 'warn'); return; }
              try {
                await OA.api(`/api/polls/${card.dataset.id}/vote`, {
                  method: 'POST',
                  body: JSON.stringify({ optionId: selected.value, voterId: getVoter() }),
                });
                OA.toast('🗳️ Vote counted!', 'success');
              } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); load(); }
            });
          }
        }

        async function load() {
          const d = await OA.api('/api/polls');
          renderPolls(d.polls || []);
        }

        unsub = OA.on('polls.changed', (p) => {
          if (p && Array.isArray(p.polls)) renderPolls(p.polls);
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('polls', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });
  },
};
