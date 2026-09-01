/** Settings plugin — site name + theme. Uses the kernel's core settings API. */

export default {
  register(OA) {
    OA.registerPage('settings', {
      mount(el, OA) {
        el.innerHTML = `
          <div class="oa-page-head"><h2>Settings</h2><p>Stored server-side in the JSON kv store.</p></div>
          <form class="oa-card" id="s-form" style="max-width:520px">
            <h3>General</h3>
            <label class="muted" style="font-size:13px">Site name</label>
            <input class="oa-input" name="siteName" value="${OA.esc(OA.siteName)}" style="margin:6px 0 14px">
            <label class="muted" style="font-size:13px">Theme</label>
            <select class="oa-select" name="theme" style="margin:6px 0 14px">
              <option value="light" ${OA.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${OA.theme === 'dark' ? 'selected' : ''}>Dark</option>
            </select>
            <button class="oa-btn" type="submit">Save settings</button>
          </form>
          <div class="oa-card" style="max-width:520px;margin-top:14px">
            <h3>About</h3>
            <p class="muted" style="font-size:13.5px">
              Open Admin v${OA.esc(OA.version)} — MIT licensed, zero dependencies.
              Everything you see is a plugin: drop a folder with a <code>plugin.json</code>
              into <code>src/plugins/</code> (or pass <code>--plugins ./your-plugins</code>).
            </p>
          </div>`;

        el.querySelector('#s-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const theme = fd.get('theme');
          OA.setTheme(theme);
          await OA.api('/api/settings', { method: 'PUT', body: JSON.stringify({ siteName: fd.get('siteName') }) });
          OA.toast('✅ Settings saved', 'success');
          setTimeout(() => location.reload(), 500);
        });
      },
    });
  },
};
