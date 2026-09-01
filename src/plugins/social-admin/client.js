/**
 * Social Admin — client. A social-network dashboard: stories, composer,
 * live feed with reactions/comments, a feedback board (fed by the site
 * widget), an updates tab and a right rail (trending + suggested plugins).
 *
 * Everything it shows comes from the kernel event stream — any plugin's
 * `activity` events automatically become posts here.
 */

const KIND_CHIPS = [
  { kind: 'announcement', label: '📢 Announcement' },
  { kind: 'deploy', label: '🚀 Deploy' },
  { kind: 'status', label: '🐛 Status' },
];

export default {
  register(OA) {
    OA.registerPage('social', { mount: (el, oa) => mountSocial(el, oa) });
    OA.registerWidget('social-summary', { mount: (el, oa) => mountSummary(el, oa) });
  },
};

/* ──────────────────────────────────────────────────────────────────────── */

function mountSocial(el, OA) {
  const state = { tab: 'all', tag: null, kind: 'announcement' };

  el.innerHTML = `
    <div class="oa-social">
      <div class="oa-social-col">
        <div class="oa-stories" id="stories"></div>
        <div class="oa-tabs" id="tabs"></div>
        <div id="pane"></div>
      </div>
      <aside class="oa-rail">
        <div class="oa-card oa-rail-card" id="rail-status"></div>
        <div class="oa-card oa-rail-card" id="rail-trending"></div>
        <div class="oa-card oa-rail-card" id="rail-suggest"></div>
      </aside>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const storiesEl = $('#stories'), tabsEl = $('#tabs'), paneEl = $('#pane');
  const unsubs = [];

  /* ── stories ── */
  async function loadStories() {
    try {
      const { stories } = await OA.api('/api/social/stories');
      storiesEl.innerHTML = stories.map((s) => `
        <div class="oa-story" title="${OA.esc(s.label)}: ${OA.esc(s.value)}">
          <div class="oa-story-ring ${s.ring}"><div class="inner">${s.icon}</div></div>
          <b>${OA.esc(s.value)}</b><small>${OA.esc(s.label)}</small>
        </div>`).join('');
      $('#rail-status').innerHTML = `<h3>System status</h3>` + stories.map((s) =>
        `<div class="oa-trend-row"><span>${s.icon} ${OA.esc(s.label)}</span><b>${OA.esc(s.value)}</b></div>`).join('');
    } catch { storiesEl.innerHTML = ''; }
  }

  /* ── tabs ── */
  const TABS = [
    { id: 'all', label: 'For you' },
    { id: 'updates', label: 'Updates' },
    { id: 'feedback', label: 'Feedback', badge: 'fb' },
    { id: 'announcements', label: 'Announcements' },
  ];

  async function loadTabs() {
    let fbCount = 0;
    try { fbCount = (await OA.api('/api/social/feedback')).open; } catch { /* noop */ }
    tabsEl.innerHTML = TABS.map((t) => `
      <button class="oa-tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
        ${t.label}${t.badge === 'fb' && fbCount ? `<span class="count">${fbCount}</span>` : ''}
      </button>`).join('');
    tabsEl.querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => { state.tab = b.dataset.tab; state.tag = null; renderPane(); loadTabs(); }));
  }

  /* ── pane router ── */
  async function renderPane() {
    paneEl.innerHTML = `<div class="oa-card muted">Loading…</div>`;
    if (state.tag) {
      await renderFeed();
      return;
    }
    if (state.tab === 'feedback') await renderFeedback();
    else if (state.tab === 'updates') await renderUpdates();
    else await renderFeed();
  }

  /* ── feed + composer ── */
  async function renderFeed() {
    paneEl.innerHTML = `
      ${state.tag ? `<div class="oa-card" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <span>Showing posts tagged <b class="oa-tag">#${OA.esc(state.tag)}</b></span>
        <button class="oa-btn secondary small" id="clear-tag">Clear</button></div>` : `
      <div class="oa-card oa-composer">
        ${OA.avatar(OA.me, 42)}
        <div class="oa-composer-body">
          <textarea id="composer-text" rows="2" placeholder="What's shipping, ${OA.esc(OA.me.name)}? Use #tags…"></textarea>
          <div class="oa-composer-foot">
            <div class="oa-kind-chips">${KIND_CHIPS.map((k) =>
              `<button class="oa-kind-chip ${state.kind === k.kind ? 'active' : ''}" data-kind="${k.kind}">${k.label}</button>`).join('')}</div>
            <button class="oa-btn" id="composer-post">Post</button>
          </div>
        </div>
      </div>`}
      <div class="oa-feed" id="feed"><div class="oa-card muted">Loading…</div></div>`;

    if (state.tag) $('#clear-tag').addEventListener('click', () => { state.tag = null; renderPane(); });
    else {
      paneEl.querySelectorAll('[data-kind]').forEach((b) =>
        b.addEventListener('click', () => { state.kind = b.dataset.kind; renderFeed(); }));
      $('#composer-post').addEventListener('click', post);
      $('#composer-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); });
    }

    const qs = new URLSearchParams({ tab: state.tab === 'all' ? 'all' : state.tab });
    if (state.tag) qs.set('tag', state.tag);
    const { posts } = await OA.api('/api/social/feed?' + qs);
    const feed = $('#feed');
    feed.innerHTML = posts.length
      ? posts.map((p) => postCard(p, OA)).join('')
      : `<div class="oa-card oa-caught-up">🎉 You're all caught up. Post an update or make some coffee.</div>`;
  }

  async function post() {
    const text = $('#composer-text').value.trim();
    if (!text) return OA.toast('Write something first ✍️', 'error');
    try {
      await OA.api('/api/social/posts', { method: 'POST', body: JSON.stringify({ text, kind: state.kind }) });
      $('#composer-text').value = '';
    } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
  }

  function postCard(p, OA) {
    const mine = OA.myReactions(p.id);
    const reacts = Object.entries(p.reactions || {});
    const showAdd = !reacts.some(([e]) => OA.quickReactions.includes(e));
    return `
    <article class="oa-card oa-post" data-post="${p.id}">
      <div class="oa-post-head">
        ${OA.avatar(p.author, 42)}
        <div class="oa-post-who">
          <div class="name">${OA.esc(p.author?.name || 'Unknown')}
            ${p.author?.verified ? '<span class="verified" title="Verified system account">✔️</span>' : ''}
            ${p.resolved ? '<span class="oa-chip ok">resolved</span>' : ''}</div>
          <div class="handle">${OA.esc(p.author?.handle || '')} · ${OA.esc(p.source || '')}</div>
        </div>
        <span class="oa-post-time">${OA.timeAgo(p.createdAt)} ago</span>
      </div>
      <div class="oa-post-text">${OA.md(p.text)}</div>
      <div class="oa-post-meta">${OA.statusChip(p.status)}${(p.tags || []).map((t) =>
        `<span class="oa-chip" style="cursor:pointer" data-tag="${OA.esc(t)}">#${OA.esc(t)}</span>`).join('')}</div>
      <div class="oa-post-actions">
        ${reacts.map(([emoji, n]) => `
          <button class="oa-react ${mine.includes(emoji) ? 'mine' : ''}" data-react="${OA.esc(emoji)}" title="React">
            <span>${emoji}</span><b>${n}</b></button>`).join('')}
        <button class="oa-react" data-addreact title="Add reaction">😊+</button>
        <button class="oa-act" data-comment-toggle>💬 ${(p.comments || []).length || ''} Comment</button>
        <button class="oa-act ${p.resolved ? 'resolved' : ''}" data-resolve>${p.resolved ? '↩︎ Reopen' : '✓ Resolve'}</button>
        ${p.source === 'admin' ? '<button class="oa-act" data-delete style="margin-left:auto;color:var(--danger)">Delete</button>' : ''}
      </div>
      <div class="oa-comments" data-comments hidden>
        ${(p.comments || []).map((c) => `
          <div class="oa-comment">${OA.avatar(c.author, 28)}
            <div class="bubble"><b>${OA.esc(c.author?.name)}</b> ${OA.md(c.text)}
              <br><small>${OA.timeAgo(c.at)} ago</small></div></div>`).join('')}
        <form class="oa-comment-form" data-comment-send>
          <input class="oa-input" name="text" placeholder="Write a comment…" autocomplete="off">
          <button class="oa-btn small" type="submit">Reply</button>
        </form>
      </div>
    </article>`;
  }

  // Add-reaction emoji picker (event delegation, one listener).
  paneEl.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-addreact]');
    if (addBtn) {
      const card = addBtn.closest('[data-post]');
      let menu = card.querySelector('.oa-add-react .menu');
      if (menu) { menu.remove(); return; }
      menu = document.createElement('div');
      menu.className = 'menu';
      menu.innerHTML = ['👍', '❤️', '🔥', '🎉', '👀', '🚀'].map((x) => `<button data-menuemoji="${x}">${x}</button>`).join('');
      addBtn.classList.add('oa-add-react');
      addBtn.appendChild(menu);
      return;
    }
    const emojiBtn = e.target.closest('[data-menuemoji]');
    if (emojiBtn) {
      emojiBtn.closest('.menu')?.remove();
      react(emojiBtn.closest('[data-post]').dataset.post, emojiBtn.dataset.menuemoji);
    }
  });

  async function react(postId, emoji) {
    const on = OA.toggleMyReaction(postId, emoji);
    try {
      await OA.api(`/api/social/posts/${postId}/react`, { method: 'POST', body: JSON.stringify({ emoji, on }) });
    } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); }
  }

  paneEl.addEventListener('click', async (e) => {
    const tagChip = e.target.closest('[data-tag]');
    if (tagChip) { state.tag = tagChip.dataset.tag; renderPane(); return; }
    const card = e.target.closest('[data-post]');
    if (!card) return;
    const id = card.dataset.post;
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.react) return react(id, btn.dataset.react);
    if (btn.hasAttribute('data-comment-toggle')) {
      const box = card.querySelector('[data-comments]');
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('input')?.focus();
    }
    if (btn.hasAttribute('data-resolve')) {
      const fresh = await OA.api(`/api/social/posts/${id}/resolve`, { method: 'POST' });
      replaceCard(fresh);
    }
    if (btn.hasAttribute('data-delete')) {
      await OA.api(`/api/social/posts/${id}`, { method: 'DELETE' });
    }
  });

  paneEl.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-comment-send]');
    if (!form) return;
    e.preventDefault();
    const id = form.closest('[data-post]').dataset.post;
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    await OA.api(`/api/social/posts/${id}/comments`, { method: 'POST', body: JSON.stringify({ text: input.value }) });
  });

  function replaceCard(post) {
    const old = paneEl.querySelector(`[data-post="${post.id}"]`);
    if (old) old.outerHTML = postCard(post, OA);
  }

  /* ── feedback board ── */
  const TYPE_CHIP = { idea: '💡 idea', bug: '🐞 bug', praise: '💜 praise' };
  const STATUS_CHIP = { open: 'warn', planned: 'info', shipped: 'ok' };

  async function renderFeedback() {
    paneEl.innerHTML = `
      <div class="oa-page-head"><h2>Feedback board</h2>
        <p>What visitors of your site send through the <code>social-admin-feedback.js</code> widget lands here, live.</p></div>
      <div class="oa-fb-list" id="fb-list"><div class="oa-card muted">Loading…</div></div>`;
    const { feedback } = await OA.api('/api/social/feedback');
    const list = $('#fb-list');
    list.innerHTML = feedback.length ? feedback.map(fbCard).join('')
      : '<div class="oa-card oa-caught-up">No feedback yet — embed the widget on your site!</div>';
  }

  function fbCard(f) {
    const mine = localStorage.getItem('oa-fbvote:' + f.id) === '1';
    return `
    <div class="oa-card oa-fb-item" data-fb="${f.id}">
      <button class="oa-fb-vote ${mine ? 'mine' : ''}" data-upvote title="Upvote">
        <b>▲</b><b>${f.upvotes}</b><small>votes</small>
      </button>
      <div class="oa-fb-body">
        <div class="oa-fb-top">
          <span class="oa-chip info">${TYPE_CHIP[f.type] || f.type}</span>
          <span class="oa-chip ${STATUS_CHIP[f.status]}">${OA.esc(f.status)}</span>
          <span class="muted" style="font-size:12.5px">by ${OA.esc(f.name)} · ${OA.timeAgo(f.createdAt)} ago</span>
          <div class="oa-fb-status-btns" style="margin-left:auto">
            ${['open', 'planned', 'shipped'].map((s) =>
              `<button data-status="${s}" class="${f.status === s ? 'active' : ''}">${s}</button>`).join('')}
          </div>
        </div>
        <p class="oa-fb-msg">${OA.md(f.message)}</p>
        <div class="oa-fb-comments" ${f.comments?.length ? '' : 'hidden'} data-fbcomments>
          ${(f.comments || []).map((c) => `
            <div class="oa-comment">${OA.avatar(c.author, 26)}
              <div class="bubble"><b>${OA.esc(c.author?.name)}</b> ${OA.md(c.text)}</div></div>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <form class="oa-comment-form" data-fbcomment-send style="flex:1">
            <input class="oa-input" name="text" placeholder="Reply to ${OA.esc(f.name)}…" autocomplete="off">
            <button class="oa-btn small" type="submit">Reply</button>
          </form>
          ${f.comments?.length ? '' : '<button class="oa-btn secondary small" data-fbshow>💬</button>'}
        </div>
      </div>
    </div>`;
  }

  paneEl.addEventListener('click', async (e) => {
    if (e.target.closest('[data-fbshow]')) {
      const box = e.target.closest('[data-fb]').querySelector('[data-fbcomments]');
      box.hidden = false; box.querySelector('input')?.focus();
      return;
    }
    const item = e.target.closest('[data-fb]');
    if (!item) return;
    const id = item.dataset.fb;
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-upvote')) {
      if (localStorage.getItem('oa-fbvote:' + id)) return OA.toast('You already upvoted this 💜');
      localStorage.setItem('oa-fbvote:' + id, '1');
      await OA.api(`/api/social/feedback/${id}/upvote`, { method: 'POST' });
    }
    if (btn.dataset.status) {
      await OA.api(`/api/social/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
    }
  });

  paneEl.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-fbcomment-send]');
    if (!form) return;
    e.preventDefault();
    const id = form.closest('[data-fb]').dataset.fb;
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    await OA.api(`/api/social/feedback/${id}/comments`, { method: 'POST', body: JSON.stringify({ text: input.value }) });
  });

  /* ── updates tab ── */
  async function renderUpdates() {
    paneEl.innerHTML = `
      <div class="oa-page-head"><h2>Updates</h2>
        <p>New versions across your stack. Installing bumps the version and posts to the feed.</p></div>
      <div class="oa-fb-list" id="up-list"><div class="oa-card muted">Loading…</div></div>`;
    const { updates } = await OA.api('/api/updates');
    const list = $('#up-list');
    list.innerHTML = updates.map((u) => `
      <div class="oa-card oa-update-item">
        <span class="up-ic">${u.icon}</span>
        <div class="up-main">
          <strong>${OA.esc(u.name)}</strong> ${u.hasUpdate
            ? `<span class="oa-chip info">v${OA.esc(u.current)} → v${OA.esc(u.latest)}</span>`
            : `<span class="oa-chip ok">up to date · v${OA.esc(u.current)}</span>`}
          <br><small>${OA.esc(u.notes || '')}</small>
        </div>
        ${u.hasUpdate ? `<button class="oa-btn small" data-apply="${OA.esc(u.id)}">Install update</button>` : ''}
      </div>`).join('');
    list.querySelectorAll('[data-apply]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Installing…';
        try {
          await OA.api(`/api/updates/${b.dataset.apply}/apply`, { method: 'POST' });
          OA.toast('✅ Update installed — announced in the feed', 'success');
          loadStories(); renderUpdates();
        } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); b.disabled = false; }
      }));
  }

  /* ── right rail: trending + suggested plugins ── */
  async function loadTrending() {
    const { trending } = await OA.api('/api/social/trending');
    $('#rail-trending').innerHTML = `<h3>Trending in your stack</h3>` + (trending.length
      ? trending.map((t) => `
        <div class="oa-trend-row"><span class="t-tag" data-gotag="${OA.esc(t.tag)}">#${OA.esc(t.tag)}</span>
        <span class="t-count">${t.count} post${t.count === 1 ? '' : 's'}</span></div>`).join('')
      : '<p class="muted" style="font-size:13px">No tags yet.</p>');
    $('#rail-trending').querySelectorAll('[data-gotag]').forEach((el) =>
      el.addEventListener('click', () => { state.tag = el.dataset.gotag; state.tab = 'all'; renderPane(); loadTabs(); }));
  }

  function renderSuggested() {
    const disabled = OA.data.plugins.filter((p) => !p.enabled);
    $('#rail-suggest').innerHTML = `<h3>Suggested plugins</h3>` + (disabled.length
      ? disabled.map((p) => `
        <div class="oa-suggest">
          <span style="font-size:22px">${p.icon}</span>
          <div class="s-main"><strong>${OA.esc(p.name)}</strong><p>${OA.esc(p.description || '')}</p></div>
          <button class="oa-btn small" data-install="${OA.esc(p.id)}">Install</button>
        </div>`).join('')
      : '<p class="muted" style="font-size:13px">Every available plugin is installed. 🏆</p>');
    $('#rail-suggest').querySelectorAll('[data-install]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Installing…';
        try {
          await OA.api(`/api/plugins/${b.dataset.install}/enable`, { method: 'POST' });
          OA.toast(`🎉 <b>${OA.esc(b.dataset.install)}</b> installed — it just said hi in your feed`, 'success');
          setTimeout(() => location.reload(), 900);
        } catch (err) { OA.toast('⚠️ ' + OA.esc(err.message), 'error'); b.disabled = false; }
      }));
  }

  /* ── live updates (SSE) ── */
  function inCurrentTab(p) {
    if (state.tag) return (p.tags || []).includes(state.tag);
    if (state.tab === 'all') return true;
    if (state.tab === 'updates') return ['update', 'deploy', 'status'].includes(p.kind);
    if (state.tab === 'announcements') return p.kind === 'announcement';
    return false;
  }

  unsubs.push(OA.on('social.post.created', ({ post }) => {
    if (state.tab === 'feedback' || state.tab === 'updates' || state.tag) return;
    const feed = paneEl.querySelector('#feed');
    if (!feed || !inCurrentTab(post)) return;
    feed.querySelector('.oa-caught-up')?.remove();
    feed.insertAdjacentHTML('afterbegin', postCard(post, OA));
  }));
  unsubs.push(OA.on('social.post.updated', ({ post }) => {
    if (!paneEl.querySelector(`[data-post="${post.id}"]`)) return;
    replaceCard(post);
  }));
  unsubs.push(OA.on('social.post.deleted', ({ id }) => {
    paneEl.querySelector(`[data-post="${id}"]`)?.remove();
  }));
  unsubs.push(OA.on('feedback.created', () => { loadTabs(); if (state.tab === 'feedback') renderFeedback(); }));
  unsubs.push(OA.on('feedback.updated', ({ item }) => {
    const el = paneEl.querySelector(`[data-fb="${item.id}"]`);
    if (el) el.outerHTML = fbCard(item);
  }));
  unsubs.push(OA.on('activity', () => loadStories()));

  /* ── go ── */
  loadStories(); loadTabs(); renderPane(); loadTrending(); renderSuggested();

  return () => unsubs.forEach((off) => off());
}

/* ── Dashboard widget: social summary ───────────────────────────────────── */

async function mountSummary(el, OA) {
  el.innerHTML = `<div class="oa-card"><h3 style="margin-bottom:10px">💬 Social Admin</h3><p class="muted" style="font-size:13px">Loading feed…</p></div>`;
  try {
    const { posts } = await OA.api('/api/social/feed?limit=3');
    el.innerHTML = `
      <div class="oa-card">
        <h3 style="margin-bottom:10px">💬 Latest from Social Admin</h3>
        ${posts.map((p) => `
          <div class="oa-trend-row">
            <span>${p.author?.avatar || '✨'} ${OA.md(p.text).slice(0, 90)}</span>
            <span class="t-count">${OA.timeAgo(p.createdAt)}</span>
          </div>`).join('')}
        <a href="#/social" style="display:inline-block;margin-top:10px;font-weight:600">Open the feed →</a>
      </div>`;
  } catch (err) {
    el.innerHTML = OA.crashCard('social-admin', err.message);
  }
}
