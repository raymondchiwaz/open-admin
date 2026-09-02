/**
 * Custom CSS — client. Lives in two layers:
 *
 *  (1) On register(): pulls the saved CSS and injects it as
 *      <style id="oa-custom-css"> in <head>, then re-injects whenever the
 *      'custom-css.changed' event arrives (any browser that applies a change
 *      restyles every other open one instantly).
 *  (2) A page: monospace editor with a live character count, an "Apply CSS"
 *      action, one-click preset snippets and a safety warning.
 */

const MAX_LEN = 50000;

const STYLE = `
.oa-cc-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.oa-cc-toolbar h3 { flex: 1; min-width: 140px; }
.oa-cc-count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.oa-cc-count.over { color: var(--danger); font-weight: 700; }
.oa-cc-textarea {
  min-height: 300px; width: 100%; resize: vertical; white-space: pre; overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13px; line-height: 1.55; tab-size: 2; padding: 12px 14px;
}
.oa-cc-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.oa-cc-preset {
  display: flex; flex-direction: column; gap: 6px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px;
}
.oa-cc-preset b { font-size: 13.5px; }
.oa-cc-preset p { font-size: 12px; color: var(--muted); margin: 0; }
.oa-cc-preset pre {
  margin: 2px 0 4px; font-size: 11px; line-height: 1.5; color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  word-break: break-word; background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 10px;
}
.oa-cc-preset .oa-btn { align-self: flex-start; }
.oa-cc-warn { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 7%, var(--panel)); }
`;

/** One-click snippets — clean, 2-6 lines each, built on the existing
 *  CSS variables (`--accent`, `--radius`, …) so they interact well. */
const PRESETS = [
  {
    title: 'Purple accent',
    desc: 'Swap the whole theme to a violet palette.',
    css: `:root {
  --accent: #8a5cf6;
  --accent-2: #c26bff;
}`,
  },
  {
    title: 'Compact sidebar',
    desc: 'A tighter sidebar that fits more nav items.',
    css: `.oa-sidebar {
  width: 205px;
  flex-basis: 205px;
}
.oa-nav-item { padding: 6px 10px; }`,
  },
  {
    title: 'Bigger radius',
    desc: 'Softer, rounder corners on cards and buttons.',
    css: `:root {
  --radius: 22px;
}
.oa-btn, .oa-input, .oa-icon-btn { border-radius: 14px; }`,
  },
  {
    title: 'Serif headings',
    desc: 'Classic serif for all headings and the brand.',
    css: `h1, h2, h3, h4, .oa-brand-text strong {
  font-family: Georgia, "Times New Roman", serif;
}`,
  },
];

export default {
  register(OA) {
    const myStyle = document.createElement('style');
    myStyle.dataset.plugin = 'custom-css';
    myStyle.textContent = STYLE;
    document.head.appendChild(myStyle);

    /* ── the injected user CSS (id is load-bearing: re-inject replaces) ──── */
    function ensureCssEl() {
      let el = document.getElementById('oa-custom-css');
      if (!el) {
        el = document.createElement('style');
        el.id = 'oa-custom-css';
        document.head.appendChild(el);
      }
      return el;
    }
    function applyCss(css) {
      ensureCssEl().textContent = String(css || '');
    }

    // Fresh state on load, live updates from any browser that applies CSS.
    OA.api('/api/custom-css').then((d) => applyCss(d.css)).catch(() => { /* plugin disabled — no-op */ });
    OA.on('custom-css.changed', (d) => applyCss(d && d.css));

    /* ── page: editor + presets + safety warning ─────────────────────────── */
    OA.registerPage('custom-css', {
      mount(el, OA) {
        let current = '';

        function countHtml(len) {
          return `<span class="oa-cc-count ${len > MAX_LEN ? 'over' : ''}" data-count>${len.toLocaleString()} / ${MAX_LEN.toLocaleString()}</span>`;
        }

        function render() {
          el.innerHTML = `
            <div class="oa-page-head"><h2>🎨 Custom CSS</h2>
              <p>Style the admin to match your brand. CSS is applied live across every connected browser.</p></div>
            <div class="oa-card" style="margin-bottom:16px">
              <div class="oa-cc-toolbar">
                <h3>Your CSS</h3>
                ${countHtml(current.length)}
                <button class="oa-btn small" data-apply>Apply CSS</button>
              </div>
              <textarea class="oa-input oa-cc-textarea" data-css spellcheck="false"
                placeholder="${OA.esc('/* e.g. :root { --accent: #ff6b6b; } */')}">${OA.esc(current)}</textarea>
            </div>
            <div class="oa-card" style="margin-bottom:16px">
              <h3 style="margin-bottom:4px">Presets</h3>
              <p class="muted" style="font-size:13px;margin:0 0 12px">Append a ready-made snippet to the editor above, then hit Apply CSS.</p>
              <div class="oa-cc-presets">
                ${PRESETS.map((p, i) => `
                  <div class="oa-cc-preset">
                    <b>${OA.esc(p.title)}</b>
                    <p>${OA.esc(p.desc)}</p>
                    <pre>${OA.esc(p.css)}</pre>
                    <button class="oa-btn secondary small" data-preset="${i}" type="button">＋ Add preset</button>
                  </div>`).join('')}
              </div>
            </div>
            <div class="oa-card oa-cc-warn">
              <h3 style="margin-bottom:4px">⚠️ Read this first</h3>
              <p class="muted" style="margin:0;font-size:13.5px;line-height:1.55">
                CSS runs inside the admin for you — <strong>never paste CSS you don't understand.</strong>
                A bad rule can hide buttons, break the layout or make the panel unusable. If something
                looks wrong, remove your CSS (or use the browser's view-source to spot the offending rule).
              </p>
            </div>`;

          const ta = el.querySelector('[data-css]');
          const applyEl = el.querySelector('[data-apply]');
          const countEl = el.querySelector('[data-count]');

          function syncCount() {
            const len = ta.value.length;
            countEl.textContent = `${len.toLocaleString()} / ${MAX_LEN.toLocaleString()}`;
            countEl.classList.toggle('over', len > MAX_LEN);
          }
          ta.addEventListener('input', syncCount);

          applyEl.addEventListener('click', async () => {
            try {
              await OA.api('/api/custom-css', {
                method: 'PUT',
                body: JSON.stringify({ css: ta.value }),
              });
              OA.toast('🎨 Custom CSS applied', 'success');
            } catch (err) {
              OA.toast('⚠️ ' + OA.esc(err.message), 'error');
            }
          });

          el.querySelectorAll('[data-preset]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const snippet = PRESETS[Number(btn.dataset.preset)].css;
              if (ta.value.trim()) {
                ta.value = ta.value.replace(/\s*$/, '') + '\n\n' + snippet;
              } else {
                ta.value = snippet;
              }
              syncCount();
              ta.focus();
            });
          });
        }

        async function load() {
          try {
            const d = await OA.api('/api/custom-css');
            current = String(d.css || '');
          } catch {
            current = '';
          }
          render();
        }

        load();
      },
    });
  },
};
