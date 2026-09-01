/** Users plugin — table, search, invite, roles, suspend. */

export default {
  register(OA) {
    OA.registerPage('users', {
      mount(el, OA) {
        let q = '';

        async function load() {
          const { users, stats } = await OA.api('/api/users?q=' + encodeURIComponent(q));
          el.innerHTML = `
            <div class="oa-page-head"><h2>Team</h2>
              <p>${stats.total} members · ${stats.active} active · ${stats.invited} pending</p></div>
            <div class="oa-card" style="padding:14px">
              <div class="oa-form-row" style="margin:0">
                <input class="oa-input" id="u-search" placeholder="Search by name or email…" value="${OA.esc(q)}">
                <button class="oa-btn" id="u-add-btn" style="flex:0 0 auto">+ Invite member</button>
              </div>
            </div>
            <div class="oa-card" style="margin-top:14px;padding:6px 10px">
              <table class="oa-table">
                <thead><tr><th>Member</th><th>Role</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
                <tbody>
                  ${users.map((u) => `
                    <tr data-id="${u.id}">
                      <td><strong>${OA.esc(u.name)}</strong><br><small class="muted">${OA.esc(u.email)}</small></td>
                      <td>
                        <select class="oa-select" data-role style="width:110px">
                          ${['admin', 'editor', 'viewer'].map((r) =>
                            `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                        </select>
                      </td>
                      <td><span class="oa-chip ${u.status === 'active' ? 'ok' : u.status === 'invited' ? 'info' : 'error'}">${u.status}</span></td>
                      <td style="text-align:right">
                        <button class="oa-btn secondary small" data-toggle-status>${u.status === 'suspended' ? 'Activate' : 'Suspend'}</button>
                        <button class="oa-btn danger small" data-remove>Remove</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <form class="oa-card" id="u-add-form" style="margin-top:14px" hidden>
              <h3 style="margin-bottom:10px">Invite a member</h3>
              <div class="oa-form-row">
                <input class="oa-input" name="name" placeholder="Full name" required>
                <input class="oa-input" name="email" type="email" placeholder="email@mysite.com" required>
                <select class="oa-select" name="role"><option>viewer</option><option>editor</option><option>admin</option></select>
                <button class="oa-btn" style="flex:0 0 auto">Send invite</button>
              </div>
            </form>`;

          const search = el.querySelector('#u-search');
          search.addEventListener('input', () => { q = search.value; load(); search.focus(); });
          el.querySelector('#u-add-btn').addEventListener('click', () => {
            const f = el.querySelector('#u-add-form');
            f.hidden = !f.hidden;
            if (!f.hidden) f.querySelector('input').focus();
          });
          el.querySelector('#u-add-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            await OA.api('/api/users', {
              method: 'POST',
              body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), role: fd.get('role') }),
            });
            OA.toast('🎉 Invitation sent — announced in the Social feed', 'success');
            load();
          });
          el.querySelectorAll('[data-id]').forEach((row) => {
            const id = row.dataset.id;
            row.querySelector('[data-role]').addEventListener('change', (e) =>
              OA.api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }));
            row.querySelector('[data-toggle-status]').addEventListener('click', (e) => {
              const suspended = e.target.textContent === 'Activate';
              OA.api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: suspended ? 'active' : 'suspended' }) })
                .then(load);
            });
            row.querySelector('[data-remove]').addEventListener('click', () =>
              OA.api(`/api/users/${id}`, { method: 'DELETE' }).then(load));
          });
        }

        load();
      },
    });

    OA.registerWidget('users-count', {
      mount(el, OA) {
        OA.api('/api/users').then(({ stats }) => {
          el.innerHTML = `
            <div class="oa-card oa-stat">
              <span class="num">${stats.active}<small style="font-size:14px;color:var(--muted)">/${stats.total}</small></span>
              <span class="lbl">👥 Active members</span>
              <a href="#/users" style="font-size:13px;font-weight:600">Manage users →</a>
            </div>`;
        }).catch((err) => { el.innerHTML = OA.crashCard('core-users', err.message); });
      },
    });
  },
};
