/** API Keys client — create, copy one-time key, revoke and delete. */

const STYLE = `
.oa-api-keys-once { border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 8%, var(--panel-2)); border-radius: 12px; padding: 16px 18px; margin: 16px 0; }
.oa-api-keys-once code { display: block; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin: 10px 0; font-size: 13px; word-break: break-all; user-select: all; }
.oa-api-keys-once .oa-api-keys-warn { color: var(--warn); font-size: 12.5px; font-weight: 600; }
.oa-api-keys-monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
`;

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'api-keys';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('api-keys', {
      mount(el, OA) {
        /** Render the whole page. */
        async function load() {
          const { keys } = await OA.api('/api/api-keys');
          el.innerHTML = `
            <div class="oa-page-head"><h2>🔑 API Keys</h2>
              <p>Bearer tokens for scripts and integrations — the plaintext is shown <b>once</b> at creation; we only keep a SHA-256 hash.</p></div>

            <form class="oa-card" id="oa-apikeys-form" style="padding:16px">
              <h3 style="margin-bottom:10px">Create a key</h3>
              <div class="oa-form-row" style="margin:0">
                <input class="oa-input" name="label" placeholder="Label — e.g. “CI deploy token”" required maxlength="80">
                <button class="oa-btn" style="flex:0 0 auto">+ Create key</button>
              </div>
            </form>

            <div id="oa-apikeys-created"></div>

            <div class="oa-card" style="margin-top:14px">
              <h3 style="margin-bottom:10px">Active &amp; revoked keys</h3>
              <div id="oa-apikeys-list"></div>
            </div>

            <div class="oa-card" style="margin-top:16px">
              <h3 style="margin-bottom:8px">Use from a script</h3>
              <p class="muted" style="font-size:13px;margin-bottom:10px">Send the key as a bearer token on any <code>/api/…</code> request:</p>
              <pre class="oa-api-keys-monospace" style="background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow:auto;font-size:12.5px">curl -H "Authorization: Bearer &lt;your-key&gt;" \\
  ${OA.esc(location.origin + '/api/events')}</pre>
            </div>`;

          renderList(keys);

          el.querySelector('#oa-apikeys-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const res = await OA.api('/api/api-keys', {
              method: 'POST',
              body: JSON.stringify({ label: fd.get('label') }),
            });
            await load(); // re-render the table first so the one-time box survives
            showCreated(res.key, res.record);
            OA.toast('🔑 <b>API key created</b> — copy it now, it won’t be shown again', 'success');
          });
        }

        /** Keys table (prefix hidden behind bullets, chip per status). */
        function renderList(keys) {
          const list = el.querySelector('#oa-apikeys-list');
          list.innerHTML = keys.length ? `
            <table class="oa-table">
              <thead><tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
              <tbody>
                ${keys.map((k) => `
                  <tr data-id="${OA.esc(k.id)}">
                    <td><strong>${OA.esc(k.label)}</strong></td>
                    <td class="oa-api-keys-monospace muted">${OA.esc(k.prefix)}••••••••••••</td>
                    <td title="${OA.esc(k.createdAt)}">${OA.timeAgo(k.createdAt)} ago</td>
                    <td title="${OA.esc(k.lastUsedAt || '')}">${k.lastUsedAt ? OA.timeAgo(k.lastUsedAt) + ' ago' : '<span class="muted">never</span>'}</td>
                    <td><span class="oa-chip ${k.revoked ? 'error' : 'ok'}">${k.revoked ? 'Revoked' : 'Active'}</span></td>
                    <td style="text-align:right;white-space:nowrap">
                      ${k.revoked ? '' : `<button class="oa-btn secondary small" data-revoke>Revoke</button>`}
                      <button class="oa-btn danger small" data-remove>Delete</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>` : `
            <div class="muted" style="padding:14px 4px">No keys yet — create one above to get started.</div>`;

          list.querySelectorAll('[data-id]').forEach((row) => {
            const id = row.dataset.id;
            row.querySelector('[data-revoke]')?.addEventListener('click', async () => {
              await OA.api(`/api/api-keys/${id}/revoke`, { method: 'POST' });
              OA.toast('🔒 Key revoked', 'info');
              load();
            });
            row.querySelector('[data-remove]').addEventListener('click', async () => {
              await OA.api(`/api/api-keys/${id}`, { method: 'DELETE' });
              OA.toast('🗑️ Key deleted', 'info');
              load();
            });
          });
        }

        /** One-time key reveal box with a copy button. */
        function showCreated(key, record) {
          const box = el.querySelector('#oa-apikeys-created');
          box.innerHTML = `
            <div class="oa-api-keys-once">
              <strong>Key for “${OA.esc(record.label)}” created</strong>
              <code id="oa-apikeys-plain">${OA.esc(key)}</code>
              <div class="oa-api-keys-warn">⚠️ This is the only time the full key is shown — copy it now.</div>
              <button class="oa-btn" id="oa-apikeys-copy" style="margin-top:10px">📋 Copy key</button>
            </div>`;
          box.querySelector('#oa-apikeys-copy').addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(key);
              OA.toast('📋 Key copied to clipboard', 'success');
            } catch {
              OA.toast('⚠️ Clipboard unavailable — select the key text manually', 'error');
            }
          });
        }

        load().catch((err) => { el.innerHTML = OA.crashCard('api-keys', err.message); });
      },
    });
  },
};
