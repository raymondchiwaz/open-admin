/** Scheduled Jobs client — job cards, add form, run log, live updates. */

const STYLE = `
.oa-cron-job-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: var(--panel-2); }
.oa-cron-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); }
`;

const KIND_LABEL = { activity: 'Activity', 'http-ping': 'HTTP ping', 'kv-touch': 'KV tick' };

export default {
  register(OA) {
    const style = document.createElement('style');
    style.dataset.plugin = 'cron-jobs';
    style.textContent = STYLE;
    document.head.appendChild(style);

    OA.registerPage('cron-jobs', {
      mount(el, OA) {
        let unsub = null;
        let loadTimer = null;

        async function load() {
          const data = await OA.api('/api/cron-jobs');
          renderJobs(data.jobs || []);
          renderLog(data.log || []);
        }

        function renderJobs(jobs) {
          const holder = el.querySelector('#oa-cron-jobs');
          holder.innerHTML = jobs.length ? jobs.map((j) => `
            <div class="oa-cron-job-card" data-id="${OA.esc(j.id)}">
              <div style="display:flex;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <strong>${OA.esc(j.name)}</strong>
                    <span class="oa-chip info">every ${j.intervalMin} min</span>
                    <span class="oa-cron-kind">${OA.esc(KIND_LABEL[j.action?.kind] || j.action?.kind || '—')}</span>
                  </div>
                  <div class="muted" style="font-size:12.5px;margin-top:6px">
                    ${j.runCount || 0} runs · ${j.failCount || 0} failed
                    ${j.lastRunAt ? ` · last run ${OA.timeAgo(j.lastRunAt)} ago` : ' · never run'}
                  </div>
                  ${j.lastResult ? `
                  <div class="muted" style="font-size:12.5px;margin-top:2px">
                    last result: <span class="oa-chip ${j.lastResult.ok ? 'ok' : 'error'}" style="font-size:11px">${j.lastResult.ok ? 'ok' : 'failed'}</span>
                    ${OA.esc(j.lastResult.detail)}
                  </div>` : ''}
                  ${j.action?.url ? `<div class="muted" style="font-size:12px;margin-top:2px">${OA.esc(j.action.url)}</div>` : ''}
                </div>
                <label class="oa-switch" title="Scheduler ${j.active ? 'running' : 'paused'}">
                  <input type="checkbox" data-toggle ${j.active ? 'checked' : ''}>
                  <span class="track"></span>
                </label>
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
                <button class="oa-btn secondary small" data-run-now>▶ Run now</button>
                <button class="oa-btn danger small" data-remove style="margin-left:auto">Delete</button>
              </div>
            </div>`).join('') : `
            <div class="oa-card" style="margin-top:0">
              <div class="muted" style="padding:10px 2px">No scheduled jobs — add one above to post feed activity, ping a URL or tick a KV timestamp on a schedule.</div>
            </div>`;

          holder.querySelectorAll('[data-id]').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('[data-toggle]').addEventListener('change', async (e) => {
              try {
                await OA.api(`/api/cron-jobs/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ active: e.target.checked }),
                });
                OA.toast(e.target.checked ? '⏰ Job resumed' : '⏸️ Job paused', 'info');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
              load();
            });
            card.querySelector('[data-run-now]').addEventListener('click', async () => {
              const btn = card.querySelector('[data-run-now]');
              btn.disabled = true;
              try {
                const r = await OA.api(`/api/cron-jobs/${id}/run-now`, { method: 'POST' });
                OA.toast(r.ok ? '▶️ Ran now — check the log' : '⛔ Run failed — see the log', r.ok ? 'success' : 'error');
              } catch (err) {
                OA.toast('⚠️ ' + OA.esc(err.message), 'error');
              }
              btn.disabled = false;
              load();
            });
            card.querySelector('[data-remove]').addEventListener('click', async () => {
              if (!confirm('Delete this scheduled job? Its history is removed too.')) return;
              await OA.api(`/api/cron-jobs/${id}`, { method: 'DELETE' });
              OA.toast('🗑️ Job deleted', 'info');
              load();
            });
          });
        }

        function renderLog(logRows) {
          const holder = el.querySelector('#oa-cron-log');
          holder.innerHTML = logRows.length ? `
            <table class="oa-table">
              <thead><tr><th>Job</th><th>Result</th><th>Detail</th><th>When</th></tr></thead>
              <tbody>
                ${logRows.map((l) => `
                  <tr>
                    <td><strong>${OA.esc(l.jobName)}</strong></td>
                    <td><span class="oa-chip ${l.ok ? 'ok' : 'error'}">${l.ok ? 'ok' : 'failed'}</span></td>
                    <td class="muted" style="font-size:12.5px;word-break:break-all">${OA.esc(l.detail)}</td>
                    <td class="muted" title="${OA.esc(l.at)}">${OA.timeAgo(l.at)} ago</td>
                  </tr>`).join('')}
              </tbody>
            </table>` : '<div class="muted">No runs yet — trigger “Run now” or wait for the next interval.</div>';
        }

        el.innerHTML = `
          <div class="oa-page-head"><h2>⏰ Scheduled Jobs</h2>
            <p>Recurring tasks that post feed activity, ping URLs or tick a KV timestamp — with a run log and live updates.</p></div>

          <form class="oa-card" id="oa-cron-form" style="padding:16px">
            <h3 style="margin-bottom:10px">Add a job</h3>
            <div class="oa-form-row" style="margin:0">
              <input class="oa-input" name="name" placeholder="Name — e.g. “Nightly backup ping”" required maxlength="80">
              <input class="oa-input" name="intervalMin" type="number" min="1" max="10080" value="60" title="Minutes between runs" required>
              <select class="oa-select" name="kind">
                <option value="activity">Feed activity</option>
                <option value="http-ping">HTTP ping</option>
                <option value="kv-touch">KV tick</option>
              </select>
              <button class="oa-btn" style="flex:0 0 auto">+ Schedule</button>
            </div>
            <div id="oa-cron-url-row" style="display:none;margin-top:8px" class="muted">
              <input class="oa-input" name="url" type="url" placeholder="https://example.com/health" style="max-width:420px">
            </div>
          </form>

          <div id="oa-cron-jobs"></div>

          <div class="oa-card" style="margin-top:16px">
            <h3 style="margin-bottom:8px">Run log <span class="muted" style="font-weight:400;font-size:12px">(last 20)</span></h3>
            <div id="oa-cron-log"></div>
          </div>`;

        const form = el.querySelector('#oa-cron-form');
        form.querySelector('[name="kind"]').addEventListener('change', (e) => {
          const row = form.querySelector('#oa-cron-url-row');
          row.style.display = e.target.value === 'http-ping' ? 'block' : 'none';
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const body = {
            name: fd.get('name'),
            intervalMin: Number(fd.get('intervalMin')),
            action: { kind: fd.get('kind') },
          };
          if (body.action.kind === 'http-ping') body.action.url = fd.get('url');
          try {
            await OA.api('/api/cron-jobs', { method: 'POST', body: JSON.stringify(body) });
            OA.toast('⏰ Job scheduled', 'success');
            e.target.reset();
            form.querySelector('#oa-cron-url-row').style.display = 'none';
          } catch (err) {
            OA.toast('⚠️ ' + OA.esc(err.message), 'error');
          }
          load();
        });

        // Live: every finished run refreshes counters + log.
        unsub = OA.on('cron-jobs.ran', () => {
          clearTimeout(loadTimer);
          loadTimer = setTimeout(load, 150);
        });

        load().catch((err) => { el.innerHTML = OA.crashCard('cron-jobs', err.message); });
        return () => { if (unsub) unsub(); clearTimeout(loadTimer); };
      },
    });
  },
};
