/**
 * Get Started (onboarding checklist) — client. A dashboard widget and a full
 * page share one checklist renderer: a progress bar, five rows (checked ones
 * strike through), live updates over SSE and a manual checkbox for the
 * "Explore the Plugins page" step.
 *
 * The explore step is completed by the server when this client reports it:
 * a tiny 1-second watcher (max 60 checks, then it stops itself) notices when
 * the admin lands on `#/plugins` and POSTs /api/onboarding/visit. Page and
 * widget mounts also fire a one-shot check so being there already counts.
 */

const STYLE = `
.oa-ob-progress {
  height: 10px; border-radius: 999px; background: var(--panel-2);
  border: 1px solid var(--border); overflow: hidden; margin: 10px 0 12px;
}
.oa-ob-progress i {
  display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.4s ease;
}
.oa-ob-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.oa-ob-head strong { font-size: 15px; }
.oa-ob-count { font-size: 12.5px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.oa-ob-row {
  display: flex; align-items: flex-start; gap: 11px; padding: 10px 2px;
  border-bottom: 1px solid var(--border);
}
.oa-ob-row:last-of-type { border-bottom: none; }
.oa-ob-check {
  width: 22px; height: 22px; flex: 0 0 auto; margin-top: 1px; border-radius: 8px;
  display: grid; place-items: center; font-size: 13px; font-weight: 800; color: #fff;
  border: 1.5px solid var(--border); background: var(--panel-2); padding: 0;
}
.oa-ob-row.done .oa-ob-check { background: var(--accent); border-color: var(--accent); }
.oa-ob-check.clickable { cursor: pointer; }
.oa-ob-check.clickable:hover { border-color: var(--accent); background: var(--accent-soft); }
.oa-ob-check.clickable:focus-visible { outline: 2px solid var(--accent-soft); }
.oa-ob-main { flex: 1; min-width: 0; }
.oa-ob-label { font-weight: 600; font-size: 14px; line-height: 1.35; }
.oa-ob-row.done .oa-ob-label { text-decoration: line-through; color: var(--muted); }
.oa-ob-hint { font-size: 12.5px; color: var(--muted); margin-top: 2px; line-height: 1.45; }
.oa-ob-meta { flex: 0 0 auto; display: flex; align-items: center; }
.oa-ob-link {
  display: inline-block; margin-top: 10px; font-size: 13.5px; font-weight: 700;
}
.oa-ob-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border-top: 1px solid var(--border); margin-top: 8px; padding-top: 14px; flex-wrap: wrap;
}
.oa-ob-page-note { max-width: 720px; }
`;

/** Watch `el`, call `done` once it has been removed from the DOM. */
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
    style.dataset.plugin = 'onboarding-checklist';
    style.textContent = STYLE;
    document.head.appendChild(style);

    /* ── explore watcher: reports the Plugins page visit to the server ───── */
    let exploreTimer = null;
    let exploreChecks = 0;
    const MAX_CHECKS = 60;

    function visitExplore() {
      return OA.api('/api/onboarding/visit', {
        method: 'POST',
        body: JSON.stringify({ step: 'explore' }),
      }).catch(() => { /* server may be briefly unreachable; keep watching */ });
    }
    function stopExploreWatch() {
      if (exploreTimer) { clearInterval(exploreTimer); exploreTimer = null; }
    }
    function checkExploreNow() {
      const path = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
      if (path === 'plugins') {
        visitExplore();
        stopExploreWatch(); // done — stop checking
      }
    }
    function watchPluginsPage() {
      if (exploreTimer) return;
      exploreTimer = setInterval(() => {
        exploreChecks += 1;
        checkExploreNow();
        if (exploreChecks >= MAX_CHECKS) stopExploreWatch(); // bounded — never loops forever
      }, 1000);
      checkExploreNow();
    }
    watchPluginsPage();

    /* ── shared renderers ────────────────────────────────────────────────── */
    function pct(n) {
      return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    }

    function progressHtml(sum) {
      const done = sum.steps.filter((s) => s.done).length;
      return `
        <div class="oa-ob-head">
          <strong>🧭 Get Started</strong>
          <span class="oa-ob-count">${done}/${sum.steps.length} done · ${pct(sum.progress)}%</span>
        </div>
        <div class="oa-ob-progress" title="${pct(sum.progress)}% complete"><i style="width:${pct(sum.progress)}%"></i></div>`;
    }

    function rowsHtml(steps, { hints = false } = {}) {
      return steps.map((s) => {
        const manual = s.id === 'explore';
        const check = manual && !s.done
          ? `<button class="oa-ob-check clickable" data-check="${OA.esc(s.id)}"
               title="Mark it done — you\'ve explored the Plugins page"></button>`
          : `<button class="oa-ob-check" data-check="${OA.esc(s.id)}" disabled
               title="${s.done ? 'Done' : manual ? 'Mark it done' : 'Completes automatically'}">${s.done ? '✓' : ''}</button>`;
        return `
        <div class="oa-ob-row ${s.done ? 'done' : ''}" data-step="${OA.esc(s.id)}">
          ${check}
          <div class="oa-ob-main">
            <div class="oa-ob-label">${OA.esc(s.label)}</div>
            ${hints && !s.done && s.hint ? `<div class="oa-ob-hint">${OA.esc(s.hint)}</div>` : ''}
          </div>
          <div class="oa-ob-meta">${s.done ? '<span class="oa-chip ok">done</span>' : manual ? '<span class="oa-chip info">manual</span>' : '<span class="oa-chip">auto</span>'}</div>
        </div>`;
      }).join('');
    }

    /** Wire the manual (explore) checkboxes: click → POST visit (idempotent). */
    function bindChecks(root) {
      root.querySelectorAll('[data-check].clickable').forEach((btn) => {
        btn.addEventListener('click', () => {
          btn.disabled = true;
          visitExplore().finally(() => { /* the SSE event refreshes the UI */ });
        });
      });
    }

    /* ── dashboard widget ────────────────────────────────────────────────── */
    OA.registerWidget('onboarding-checklist', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const sum = await OA.api('/api/onboarding');
          el.innerHTML = `
            <div class="oa-card">
              ${progressHtml(sum)}
              ${rowsHtml(sum.steps)}
              <a href="#/onboarding" class="oa-ob-link">Get started →</a>
            </div>`;
          bindChecks(el);
        }

        checkExploreNow(); // being on the plugins page already counts
        unsub = OA.on('onboarding.changed', () => load());
        load().catch((err) => { el.innerHTML = OA.crashCard('onboarding-checklist', err.message); });
        onceDetached(el, () => { if (unsub) unsub(); });
      },
    });

    /* ── full page ───────────────────────────────────────────────────────── */
    OA.registerPage('onboarding', {
      mount(el, OA) {
        let unsub = null;

        async function load() {
          const sum = await OA.api('/api/onboarding');
          el.innerHTML = `
            <div class="oa-page-head"><h2>🧭 Get Started</h2>
              <p>${sum.complete
                ? 'Everything is done — welcome aboard! You can reset the checklist any time to run through it again.'
                : 'A short setup path to make the admin yours. Steps marked <b>auto</b> complete themselves as you use Open Admin.'}</p></div>
            <div class="oa-card oa-ob-page-note">
              ${progressHtml(sum)}
              ${rowsHtml(sum.steps, { hints: true })}
              <div class="oa-ob-foot">
                <span class="muted" style="font-size:12.5px">Reset the checklist to start over — your data is untouched.</span>
                <button class="oa-btn secondary small" data-reset>Reset checklist</button>
              </div>
            </div>`;
          bindChecks(el);

          /* reset: double-click pattern (second click within 3s really resets) */
          const reset = el.querySelector('[data-reset]');
          let armed = false;
          let resetTimer = null;
          reset.addEventListener('click', async () => {
            if (!armed) {
              armed = true;
              reset.textContent = 'Really reset?';
              resetTimer = setTimeout(() => {
                armed = false;
                reset.textContent = 'Reset checklist';
              }, 3000);
              return;
            }
            clearTimeout(resetTimer);
            armed = false;
            reset.textContent = 'Reset checklist';
            try {
              await OA.api('/api/onboarding/reset', { method: 'POST' });
              OA.toast('🧭 Checklist reset — fresh start!', 'success');
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });
        }

        checkExploreNow(); // also trigger from page mount
        unsub = OA.on('onboarding.changed', () => load());
        load().catch((err) => { el.innerHTML = OA.crashCard('onboarding-checklist', err.message); });
        return () => { if (unsub) unsub(); };
      },
    });
  },
};
