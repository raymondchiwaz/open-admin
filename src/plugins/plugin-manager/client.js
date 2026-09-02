/** Plugin Manager plugin — enable/disable/inspect every plugin, including itself. */

export default {
  register(OA) {
    OA.registerPage('plugins', {
      mount(el, OA) {
        async function load() {
          const { plugins } = await OA.api('/api/plugins');
          const groups = new Map();
          for (const p of plugins) {
            const cat = p.category || 'General';
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(p);
          }
          const ORDER = ['General', 'Content', 'Insights', 'System', 'Tools'];
          const cats = [...groups.keys()].sort((a, b) =>
            ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
          el.innerHTML = `
            <div class="oa-page-head"><h2>Plugins</h2>
              <p>Everything in Open Admin is a plugin — including this page. Toggle one off and watch it vanish (Social Admin will report it). Disabled plugins appear in Social Admin's "Suggested plugins" rail.</p></div>
            ${cats.map((cat) => `
              <h3 class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.8px;margin:22px 2px 10px">${OA.esc(cat)}</h3>
              <div class="oa-grid">
                ${groups.get(cat).map((p) => `
                  <div class="oa-card" data-id="${OA.esc(p.id)}">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                      <span style="font-size:24px">${p.icon}</span>
                      <div style="flex:1;min-width:0">
                        <strong>${OA.esc(p.name)}</strong>
                        <small class="muted" style="display:block">v${OA.esc(p.version)} · by ${OA.esc(p.author || 'unknown')}</small>
                      </div>
                      <label class="oa-switch" title="${p.enabled ? 'Disable' : 'Enable'} ${OA.esc(p.name)}">
                        <input type="checkbox" data-toggle ${p.enabled ? 'checked' : ''}>
                        <span class="track"></span>
                      </label>
                    </div>
                    <p class="muted" style="font-size:13px;min-height:36px">${OA.esc(p.description || '')}</p>
                    <div class="oa-pill-row">
                      <code style="font-size:11px">${OA.esc(p.id)}</code>
                      ${p.requires.map((r) => `<span class="oa-pill">requires ${OA.esc(r)}</span>`).join('')}
                      ${p.provides.map((c) => `<span class="oa-pill">provides ${OA.esc(c)}</span>`).join('')}
                    </div>
                  </div>`).join('')}
              </div>`).join('')}`;

          el.querySelectorAll('[data-toggle]').forEach((input) =>
            input.addEventListener('change', async () => {
              const id = input.closest('[data-id]').dataset.id;
              const action = input.checked ? 'enable' : 'disable';
              try {
                await OA.api(`/api/plugins/${id}/${action}`, { method: 'POST' });
                OA.toast(`${input.checked ? '✅' : '⛔'} <b>${OA.esc(id)}</b> ${input.checked ? 'enabled' : 'disabled'} — reloading…`, 'success');
                setTimeout(() => location.reload(), 700);
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
                input.checked = !input.checked;
              }
            }));
        }
        load();
      },
    });
  },
};
