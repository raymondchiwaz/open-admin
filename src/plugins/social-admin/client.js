/** Social workspace: real server data, persistent drafts, and live activity. */
const KINDS = [['announcement', 'megaphone', 'Update'], ['deploy', 'rocket', 'Deploy'], ['status', 'activity', 'Status']];
const TABS = [['all', 'All activity'], ['attention', 'Needs attention'], ['announcements', 'Team updates'], ['feedback', 'Feedback'], ['saved', 'Saved'], ['updates', 'App updates']];

export default {
  register(OA) {
    OA.registerPage('social', { mount: (el) => mountWorkspace(el, OA) });
    OA.registerWidget('social-summary', { mount: async (el) => {
      try {
        const { posts } = await OA.api('/api/social/feed?limit=3');
        el.innerHTML = `<div class="oa-card"><h3>Latest activity</h3>${posts.map(p => `<p>${OA.md(p.text)}</p>`).join('') || '<p class="muted">No activity yet.</p>'}<a href="#/social">Open home feed →</a></div>`;
      } catch { el.innerHTML = '<div class="oa-card">Activity is unavailable. Try refreshing.</div>'; }
    }});
  },
};

function mountWorkspace(el, OA) {
  const key = 'oa-workspace:' + location.pathname;
  const read = (name, fallback) => { try { return JSON.parse(localStorage.getItem(key + name)) ?? fallback; } catch { return fallback; } };
  const write = (name, value) => { try { localStorage.setItem(key + name, JSON.stringify(value)); } catch { /* storage may be unavailable */ } };
  const state = { tab: 'all', kind: 'announcement', draft: read(':draft', ''), saved: new Set(read(':saved', [])), q: '', source: '', offset: 0, posts: [], generation: 0, disposed: false, pending: new Set(), incoming: [], overviewGeneration: 0 };
  const esc = OA.esc, icon = (name, size) => OA.icon(name, size);
  const $ = (s) => el.querySelector(s);
  const unsubs = [];
  const hasPage = (path) => OA.data.nav.some(n => n.path === path);
  const date = new Date();
  const hour = date.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `
    <div class="oa-workspace-home">
      <section class="oa-welcome"><div><div class="oa-eyebrow">${esc(date.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'}))}</div><h2>${greeting}, ${esc(OA.me.name)}<span class="oa-greeting-dot">.</span></h2><p>A little less noise. Everything you need to stay in the loop.</p></div><button class="oa-btn" data-compose>${icon('plus',17)} Share an update</button></section>
      <section class="oa-metrics" id="workspace-metrics" aria-label="Workspace overview"><div class="oa-card muted">Loading your workspace…</div></section>
      <div class="oa-social">
        <section class="oa-social-col" aria-label="Workspace feed">
          <div class="oa-section-heading"><h3>Your feed <span class="oa-live-dot"></span></h3><span>One place. The whole picture.</span></div>
          <div class="oa-card oa-composer">${OA.avatar(OA.me,40)}<div class="oa-composer-body"><label class="sr-only" for="composer-text">Share a workspace update</label><textarea id="composer-text" maxlength="2000" rows="2" placeholder="What's happening in your workspace?">${esc(state.draft)}</textarea><div class="oa-composer-foot"><div class="oa-kind-chips">${KINDS.map(([kind,ic,label]) => `<button class="oa-kind-chip ${state.kind === kind ? 'active' : ''}" data-kind="${kind}" aria-pressed="${state.kind === kind}">${icon(ic,15)}${label}</button>`).join('')}</div><button class="oa-btn small" id="composer-post" ${state.draft.trim() ? '' : 'disabled'}>Post update ${icon('arrow-right',14)}</button></div></div></div>
          <div class="oa-tabs" id="tabs" role="tablist" aria-label="Feed views"></div>
          <div class="oa-feed-tools"><label class="oa-feed-search">${icon('search',16)}<input id="feed-search" type="search" placeholder="Search this feed…" aria-label="Search this feed"></label><label class="oa-source-filter"><span class="sr-only">Filter by source</span><select id="feed-source"><option value="">All sources</option></select></label></div>
          <button class="oa-new-activity" id="new-activity" hidden></button><div id="pane" role="tabpanel" aria-label="Activity results"></div>
          <div class="oa-feed-footer">A shared view. A calmer workday.<span>Read at your pace. Come back when you need to.</span></div>
        </section>
        <aside class="oa-rail" aria-label="Workspace at a glance">
          <section class="oa-card oa-focus-card" id="rail-focus"></section>
          <section class="oa-card oa-rail-card" id="rail-tasks"></section>
          <section class="oa-card oa-rail-card" id="rail-trending"></section>
          <section class="oa-connect-card">${icon('plug',24)}<h3>A home for all your tools.</h3><p>Bring your app's updates, events, and feedback into one shared feed.</p><a href="#/plugins">Find your next integration ${icon('arrow-up-right',15)}</a></section>
          <p class="oa-rail-foot">OpenAdmin · Built in the open<br>Sample content is included on first run.</p>
        </aside>
      </div>
    </div>`;

  function tabs() {
    $('#tabs').innerHTML = TABS.map(([id,label]) => `<button id="tab-${id}" class="oa-tab ${state.tab === id ? 'active' : ''}" role="tab" aria-selected="${state.tab === id}" aria-controls="pane" tabindex="${state.tab === id ? 0 : -1}" data-tab="${id}">${id === 'saved' ? icon('bookmark',14) : ''}${label}${id === 'saved' && state.saved.size ? `<span class="count">${state.saved.size}</span>` : ''}</button>`).join('');
    $('#pane').setAttribute('aria-labelledby', 'tab-' + state.tab);
    $('.oa-feed-tools').hidden = ['feedback','updates'].includes(state.tab);
  }
  function selectTab(id) { state.tab = id; state.offset = 0; tabs(); loadPane(); }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); });
  $('#tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault(); const i = TABS.findIndex(t => t[0] === state.tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    selectTab(TABS[next][0]); $('#tabs').querySelector('[aria-selected="true"]').focus();
  });
  let searchTimer;
  $('#new-activity').addEventListener('click', () => loadPane());
  $('#feed-search').addEventListener('input', e => { state.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => loadPane(), 220); });
  $('#feed-source').addEventListener('change', e => { state.source = e.target.value; loadPane(); });
  $('#composer-text').addEventListener('input', e => { state.draft = e.target.value; write(':draft', state.draft); $('#composer-post').disabled = !state.draft.trim(); });
  $('#composer-text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); publish(); } });
  el.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    state.kind = b.dataset.kind;
    el.querySelectorAll('[data-kind]').forEach(n => { n.classList.toggle('active', n === b); n.setAttribute('aria-pressed', String(n === b)); });
  }));
  $('[data-compose]').addEventListener('click', () => { $('.oa-composer').scrollIntoView({behavior:'smooth',block:'center'}); $('#composer-text').focus(); });
  $('#composer-post').addEventListener('click', publish);
  async function publish() {
    if (state.pending.has('post') || !state.draft.trim()) return;
    state.pending.add('post'); const sent = state.draft; $('#composer-post').disabled = true;
    try {
      await OA.api('/api/social/posts', {method:'POST',body:JSON.stringify({text:sent,kind:state.kind})});
      if (state.draft === sent) { state.draft = ''; write(':draft',''); if (!state.disposed) $('#composer-text').value = ''; }
      if (state.disposed) return;
      OA.toast('Update shared with your workspace.', 'success');
      if (state.tab !== 'all') selectTab('all'); else loadPane();
    } catch (err) { OA.toast(esc(err.message), 'error'); }
    finally { state.pending.delete('post'); if (!state.disposed) $('#composer-post').disabled = !state.draft.trim(); }
  }

  async function overview() {
    const request = ++state.overviewGeneration;
    const results = await Promise.allSettled([
      hasPage('users') ? OA.api('/api/users') : Promise.reject(),
      hasPage('tasks') ? OA.api('/api/tasks') : Promise.reject(),
      OA.api('/api/social/feedback'), OA.api('/api/social/feed?limit=1&tab=attention'),
    ]);
    if (state.disposed || request !== state.overviewGeneration) return;
    const quickInput = $('#quick-task input');
    const quickDraft = quickInput?.value || '';
    const quickFocused = quickInput && document.activeElement === quickInput;
    const val = i => results[i].status === 'fulfilled' ? results[i].value : null;
    const users = val(0)?.users, tasks = val(1)?.tasks, feedback = val(2);
    const openTasks = tasks?.filter(t => t.status !== 'done');
    const cards = [
      ['users','People',users?.length ?? '—','In your workspace','users','blue'],
      ['square-check','Open tasks',openTasks?.length ?? '—',tasks ? `${tasks.filter(t=>t.status==='done').length} completed` : 'Enable Tasks to get started','tasks','green'],
      ['message-circle','Open feedback',feedback?.open ?? '—','Ideas and conversations','feedback','amber'],
      ['puzzle','Connected apps',OA.data.plugins.filter(p=>p.enabled).length,'Working together, in one place','plugins','purple'],
    ];
    $('#workspace-metrics').innerHTML = cards.map(([ic,label,value,note,path,color]) => `<button class="oa-metric ${color}" data-destination="${path}" ${!['feedback','plugins'].includes(path) && !hasPage(path) ? 'disabled' : ''}><span class="oa-metric-top">${label}<span class="oa-metric-icon">${icon(ic,18)}</span></span><strong>${value}</strong><span class="oa-metric-note">${esc(note)}${icon('arrow-up-right',13)}</span></button>`).join('');
    const attention = val(3)?.total;
    $('#rail-focus').innerHTML = `<div class="oa-focus-heading">${icon('circle-alert',17)}<span>A little heads-up</span></div><h3>${attention == null ? 'Your next step starts here.' : attention ? `${attention} update${attention===1?' needs':'s need'} a look.` : 'A clear feed. A fresh start.'}</h3><p>${feedback ? `${feedback.open} open feedback conversations` : 'Your feedback is unavailable'}${openTasks ? ` and ${openTasks.length} tasks to move forward.` : '.'}</p><button class="oa-text-button" data-attention>Let's take a look ${icon('arrow-right',15)}</button>`;
    const shown = [...(openTasks || [])].sort((a,b)=>({high:0,medium:1,low:2}[a.priority]??2)-({high:0,medium:1,low:2}[b.priority]??2)).slice(0,3);
    $('#rail-tasks').innerHTML = `<div class="oa-rail-heading"><h3>On your radar</h3>${hasPage('tasks') ? '<a href="#/tasks">View all</a>' : ''}</div>${shown.map(t => `<div class="oa-radar-task"><button class="oa-task-check" data-task="${esc(t.id)}" aria-label="Complete task: ${esc(t.title)}">${icon('circle-check',18)}</button><div><a href="#/tasks">${esc(t.title)}</a><small><span class="oa-priority ${t.priority==='high'?'high':''}">${esc(t.priority)} priority</span><span>· ${esc(t.assignee || 'Unassigned')}</span></small></div></div>`).join('') || `<p class="oa-rail-empty">${tasks ? 'All caught up. Make space for something new.' : 'Enable Tasks to keep your next steps close.'}</p>`}${hasPage('tasks') ? `<form class="oa-quick-task" id="quick-task"><input aria-label="New task title" placeholder="Add a quick task…" maxlength="120" required><button aria-label="Add task" type="submit">${icon('plus',17)}</button></form>` : '<a href="#/plugins">Explore apps →</a>'}`;
    if ($('#quick-task input')) { $('#quick-task input').value = quickDraft; if (quickFocused) $('#quick-task input').focus(); }
    $('#quick-task')?.addEventListener('submit', async e => {
      e.preventDefault(); const input = e.target.querySelector('input'); const title=input.value.trim(); if(!title) return;
      await action('new-task', async()=>{ await OA.api('/api/tasks',{method:'POST',body:JSON.stringify({title})}); input.value=''; overview(); OA.toast('Task added.','success'); });
    });
  }

  async function trending() {
    try {
      const { trending } = await OA.api('/api/social/trending'); if(state.disposed) return;
      $('#rail-trending').innerHTML = `<div class="oa-rail-heading"><h3>Conversations</h3>${icon('hash',16)}</div>${[...trending].sort((a,b)=>a.tag.localeCompare(b.tag)).slice(0,4).map(t=>`<button class="oa-topic" data-topic="${esc(t.tag)}"><span># ${esc(t.tag)}</span><small>${t.count} ${t.count===1?'post':'posts'} ${icon('arrow-up-right',13)}</small></button>`).join('') || '<p class="oa-rail-empty">Add a #tag to start a conversation.</p>'}`;
    } catch { if (!state.disposed) $('#rail-trending').innerHTML='<h3>Conversations</h3><p class="muted">Unavailable right now.</p>'; }
  }

  function matches(p) {
    return (state.tab !== 'attention' || (!p.resolved && (p.kind === 'update' || ['warn','error'].includes(p.status?.level))))
      && (state.tab !== 'announcements' || p.kind === 'announcement')
      && (state.tab !== 'saved' || state.saved.has(p.id))
      && (!state.source || p.source === state.source)
      && (!state.q || [p.text,p.author?.name,...(p.tags||[]).map(t=>'#'+t)].join(' ').toLowerCase().includes(state.q.trim().toLowerCase()));
  }
  async function loadPane(more=false) {
    if (state.disposed) return;
    const generation = ++state.generation;
    if(!more) { state.incoming=[]; $('#new-activity').hidden=true; state.offset=0; state.posts=[]; $('#pane').innerHTML='<div class="oa-card oa-loading" role="status">Getting your latest activity…</div>'; }
    try {
      if(state.tab === 'feedback') return await feedbackPane(generation);
      if(state.tab === 'updates') return await updatesPane(generation);
      const qs = new URLSearchParams({tab:state.tab,limit:'15',offset:String(state.offset),q:state.q,source:state.source});
      if(state.tab === 'saved') qs.set('ids',[...state.saved].join(','));
      const data = await OA.api('/api/social/feed?'+qs);
      if(state.disposed || generation !== state.generation) return;
      state.posts = more ? [...state.posts,...data.posts.filter(p=>!state.posts.some(x=>x.id===p.id))] : data.posts;
      state.offset = data.nextOffset;
      $('#pane').innerHTML=`<div class="oa-feed" id="feed">${state.posts.map(postCard).join('') || emptyState()}</div>${data.hasMore?'<button class="oa-btn secondary oa-load-more" data-more>Load more activity</button>':''}`;
      const select = $('#feed-source');
      const selected = state.source;
      select.innerHTML='<option value="">All sources</option>'+(data.sources||[]).map(source=>`<option value="${esc(source)}">${esc(source)}</option>`).join('');
      select.value=selected;
    } catch(err) {
      if(!state.disposed && generation===state.generation) $('#pane').innerHTML=`<div class="oa-card oa-empty"><h3>Couldn't load this view.</h3><p class="muted">${esc(err.message)}</p><button class="oa-btn secondary" data-retry>Try again</button></div>`;
    }
  }
  function emptyState() {
    const saved = state.tab==='saved';
    return `<div class="oa-card oa-feed-empty">${icon(saved?'bookmark':'circle-check',30)}<h3>${state.q || state.source ? 'Nothing matches just yet.' : saved ? 'Keep the good stuff close.' : 'You’re all caught up.'}</h3><p>${state.q || state.source ? 'Try another search or a different source.' : saved ? 'Save an update with its bookmark button. Find it here anytime on this browser.' : 'New activity will appear here as it happens.'}</p></div>`;
  }
  function postCard(p) {
    const saved = state.saved.has(p.id);
    const kindIcon = {deploy:'rocket',update:'box',status:'activity',feedback:'message-circle',announcement:'megaphone'}[p.kind] || 'plug';
    return `<article class="oa-card oa-post ${p.resolved?'is-resolved':''}" data-post="${esc(p.id)}">
      <div class="oa-post-head">${p.author?.verified ? `<div class="oa-app-avatar ${esc(p.author?.color||'g4')}">${icon(kindIcon,21)}</div>` : OA.avatar(p.author,40)}<div class="oa-post-who"><div class="name">${esc(p.author?.name||'Workspace')}${p.author?.verified?'<span class="oa-bot-label">APP</span>':''}</div><div class="handle">${esc(p.source||'workspace')} <span>·</span> ${OA.timeAgo(p.createdAt)} ago</div></div><button class="oa-bookmark ${saved?'saved':''}" data-save aria-label="${saved?'Unsave':'Save'} update" aria-pressed="${saved}">${icon('bookmark',17)}</button></div>
      <div class="oa-post-text">${OA.md(p.text)}</div>
      <div class="oa-post-meta">${p.resolved?'<span class="oa-chip ok">Resolved</span>':OA.statusChip(p.status)}${(p.tags||[]).map(t=>`<button class="oa-post-tag" data-topic="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
      <div class="oa-post-actions">${Object.entries(p.reactions||{}).map(([emoji,n])=>`<button class="oa-react ${OA.myReactions(p.id).includes(emoji)?'mine':''}" data-react="${esc(emoji)}" aria-pressed="${OA.myReactions(p.id).includes(emoji)}" aria-label="React ${esc(emoji)}">${esc(emoji)} <b>${n}</b></button>`).join('')}<button class="oa-act oa-reaction-add" data-reaction-menu aria-label="Add a reaction">${icon('smile',17)}</button><button class="oa-act" data-comment-toggle>${icon('message-circle',15)}<span>${p.comments?.length||0} ${p.comments?.length===1?'reply':'replies'}</span></button><button class="oa-act oa-resolve" data-resolve>${icon('circle-check',15)}${p.resolved?'Reopen':'Resolve'}</button></div>
      <div class="oa-reaction-picker" hidden>${['👍','❤️','🔥','🎉','👀','🚀'].map(e=>`<button data-react="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
      <div class="oa-comments" data-comments hidden>${(p.comments||[]).map(c=>`<div class="oa-comment">${OA.avatar(c.author,28)}<div class="bubble"><b>${esc(c.author?.name)}</b><p>${OA.md(c.text)}</p></div></div>`).join('')}<form class="oa-comment-form" data-comment-send><input class="oa-input" aria-label="Write a reply" placeholder="Add to the conversation…" maxlength="1000" required><button class="oa-btn small">Reply</button></form></div>
    </article>`;
  }
  function replacePost(p) {
    const index=state.posts.findIndex(x=>x.id===p.id); if(index>=0) state.posts[index]=p;
    const old=el.querySelector(`[data-post="${CSS.escape(p.id)}"]`); if(!old)return;
    if(!matches(p)){old.remove();return;}
    const comments=old.querySelector('[data-comments]'); const open=!comments.hidden;
    const input=comments.querySelector('input');
    const draft=input.value; const focused=document.activeElement===input; const start=input.selectionStart, end=input.selectionEnd;
    old.outerHTML=postCard(p);
    const fresh=el.querySelector(`[data-post="${CSS.escape(p.id)}"]`);
    fresh.querySelector('[data-comments]').hidden=!open;
    const freshInput=fresh.querySelector('[data-comments] input'); freshInput.value=draft;
    if(focused){freshInput.focus();freshInput.setSelectionRange(start,end);}
  }
  async function action(key, fn) {
    if(state.pending.has(key))return;
    state.pending.add(key);
    try { await fn(); } catch(err) { OA.toast(esc(err.message),'error'); }
    finally { state.pending.delete(key); }
  }
  el.addEventListener('click', async e => {
    const b=e.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-retry')) return loadPane();
    if(b.hasAttribute('data-more')){b.disabled=true;return loadPane(true);}
    if(b.hasAttribute('data-attention'))return selectTab('attention');
    if(b.dataset.destination) return b.dataset.destination==='feedback'?selectTab('feedback'):OA.navigate(b.dataset.destination);
    if(b.dataset.topic){state.q='#'+b.dataset.topic; $('#feed-search').value=state.q;selectTab('all');return;}
    if(b.dataset.task) return action(b.dataset.task,async()=>{await OA.api('/api/tasks/'+encodeURIComponent(b.dataset.task),{method:'PATCH',body:JSON.stringify({status:'done'})});overview();OA.toast('Task completed. Nice work.','success');});
    const card=b.closest('[data-post]'); if(!card)return;
    const id=card.dataset.post;
    if(b.hasAttribute('data-save')) {
      if(state.saved.has(id))state.saved.delete(id);else state.saved.add(id);
      write(':saved',[...state.saved]);tabs(); const post=state.posts.find(p=>p.id===id);if(post)replacePost(post);
      if(state.tab==='saved'&&!$('#feed').children.length)$('#feed').innerHTML=emptyState();
    }
    if(b.hasAttribute('data-comment-toggle')) {const box=card.querySelector('[data-comments]');box.hidden=!box.hidden;if(!box.hidden)box.querySelector('input').focus();}
    if(b.hasAttribute('data-reaction-menu')){const picker=card.querySelector('.oa-reaction-picker');picker.hidden=!picker.hidden;}
    if(b.dataset.react) return action(id+':react',async()=>{
      const emoji=b.dataset.react;const on=!OA.myReactions(id).includes(emoji);
      const p=await OA.api(`/api/social/posts/${encodeURIComponent(id)}/react`,{method:'POST',body:JSON.stringify({emoji,on})});
      OA.toggleMyReaction(id,emoji);replacePost(p);
    });
    if(b.hasAttribute('data-resolve'))return action(id,async()=>{const p=await OA.api(`/api/social/posts/${encodeURIComponent(id)}/resolve`,{method:'POST'});replacePost(p);overview();});
  });
  el.addEventListener('submit',e=>{
    const form=e.target.closest('[data-comment-send]');if(!form)return;
    e.preventDefault();const id=form.closest('[data-post]').dataset.post;const input=form.querySelector('input');const text=input.value.trim();if(!text)return;
    action(id+':comment',async()=>{const p=await OA.api(`/api/social/posts/${encodeURIComponent(id)}/comments`,{method:'POST',body:JSON.stringify({text})});replacePost(p);el.querySelector(`[data-post="${CSS.escape(id)}"] [data-comments] input`).value='';});
  });

  async function feedbackPane(generation) {
    const {feedback}=await OA.api('/api/social/feedback');if(state.disposed||generation!==state.generation)return;
    $('#pane').innerHTML=`<div class="oa-feedback-intro"><h3>Good ideas start with listening.</h3><p>Feedback from your community, ready to move forward.</p></div><div class="oa-fb-list">${feedback.map(f=>`<article class="oa-card oa-feedback-card" data-feedback="${esc(f.id)}"><div class="oa-feedback-head"><span class="oa-person-initial">${esc(f.name?.[0]||'A')}</span><b>${esc(f.name)}</b><small>${OA.timeAgo(f.createdAt)} ago</small><span class="oa-chip">${esc(f.type)}</span></div><p>${OA.md(f.message)}</p><div class="oa-feedback-actions"><button class="oa-btn secondary small" data-vote="${esc(f.id)}" ${read(':vote:'+f.id,false)?'disabled':''}>↑ ${f.upvotes} votes</button><label>Status <select class="oa-feedback-status" data-feedback-status="${esc(f.id)}">${['open','planned','shipped'].map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></label></div>${(f.comments||[]).map(c=>`<div class="oa-feedback-reply"><b>${esc(c.author?.name)}</b> ${OA.md(c.text)}</div>`).join('')}<form class="oa-comment-form" data-feedback-reply="${esc(f.id)}"><input class="oa-input" aria-label="Reply to ${esc(f.name)}" placeholder="Reply to ${esc(f.name)}…" maxlength="1000" required><button class="oa-btn small">Reply</button></form></article>`).join('')||emptyState()}</div>`;
  }
  $('#pane').addEventListener('click', e=>{
    const b=e.target.closest('[data-vote]');if(!b)return;
    action(b.dataset.vote,async()=>{await OA.api(`/api/social/feedback/${encodeURIComponent(b.dataset.vote)}/upvote`,{method:'POST'});write(':vote:'+b.dataset.vote,true);loadPane();});
  });
  $('#pane').addEventListener('change', e=>{
    const s=e.target.closest('[data-feedback-status]');if(!s)return;
    action(s.dataset.feedbackStatus,async()=>{await OA.api(`/api/social/feedback/${encodeURIComponent(s.dataset.feedbackStatus)}`,{method:'PATCH',body:JSON.stringify({status:s.value})});overview();OA.toast('Feedback status updated.','success');});
  });
  $('#pane').addEventListener('submit', e=>{
    const form=e.target.closest('[data-feedback-reply]');if(!form)return;e.preventDefault();
    const input=form.querySelector('input');if(!input.value.trim())return;
    action(form.dataset.feedbackReply,async()=>{await OA.api(`/api/social/feedback/${encodeURIComponent(form.dataset.feedbackReply)}/comments`,{method:'POST',body:JSON.stringify({text:input.value})});loadPane();});
  });
  async function updatesPane(generation) {
    const {updates}=await OA.api('/api/updates');if(state.disposed||generation!==state.generation)return;
    $('#pane').innerHTML=`<div class="oa-feedback-intro"><h3>App updates · demo catalog</h3><p>These sample updates preview the workflow. Applying one changes the recorded version; it does not download or install software.</p></div>${updates.map(u=>`<div class="oa-card oa-update-item"><div class="up-main"><strong>${esc(u.name)}</strong><p class="muted">${esc(u.notes||'')}</p><span class="oa-chip">v${esc(u.current)}${u.hasUpdate?' → v'+esc(u.latest):' · up to date'}</span></div>${u.hasUpdate?`<button class="oa-btn small" data-apply="${esc(u.id)}">Apply demo update</button>`:''}</div>`).join('')}`;
  }
  $('#pane').addEventListener('click',e=>{const b=e.target.closest('[data-apply]');if(!b)return;action(b.dataset.apply,async()=>{await OA.api(`/api/updates/${encodeURIComponent(b.dataset.apply)}/apply`,{method:'POST'});loadPane();overview();});});

  unsubs.push(OA.on('social.post.created',({post})=>{
    overview();trending();
    if(['feedback','updates'].includes(state.tab)||!matches(post))return;
    const feed=$('#feed');if(!feed||state.posts.some(p=>p.id===post.id))return;
    state.incoming.push(post);state.offset+=1;
    const notice=$('#new-activity');notice.hidden=false;notice.textContent=`${state.incoming.length} new update${state.incoming.length===1?'':'s'} · Show when you’re ready`;
  }));
  unsubs.push(OA.on('social.post.updated',({post})=>{replacePost(post);overview();}));
  unsubs.push(OA.on('social.post.deleted',({id})=>{el.querySelector(`[data-post="${CSS.escape(id)}"]`)?.remove();state.posts=state.posts.filter(p=>p.id!==id);overview();}));
  unsubs.push(OA.on('tasks.changed',overview),OA.on('feedback.created',overview),OA.on('feedback.updated',overview));
  tabs();overview();trending();loadPane();
  return ()=>{state.disposed=true;state.generation++;clearTimeout(searchTimer);unsubs.forEach(off=>off());};
}
