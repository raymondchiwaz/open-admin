'use strict';

/**
 * Get Started (onboarding checklist) — server side.
 *
 * Five steps, persisted via getState('steps'):
 *   site-name      auto — done once kv 'settings.siteName' differs from 'My Site'
 *   social-post    auto — via the 'social.post.created' event
 *   install-plugin auto — via 'plugin.enabled' for any non-core plugin
 *   feedback       auto — via the 'feedback.created' event
 *   explore        manual — the client reports it (Plugins page visited)
 *                  and it can be ticked by hand in the widget.
 *
 * Routes:
 *   GET  /api/onboarding               steps + progress percent + complete
 *   POST /api/onboarding/visit  {step} client check-in (marks the step done)
 *   POST /api/onboarding/reset         start the checklist over
 *
 * Every change notifies 'onboarding.changed'. Exactly ONE activity post
 * ("🧭 Setup complete — welcome aboard!") fires when all steps complete —
 * guarded by a persisted flag so resets/enable cycles never spam the feed.
 */

const STEP_DEFS = [
  {
    id: 'site-name', label: 'Name your site', auto: true,
    hint: 'Give your admin a name in Settings — it shows in the sidebar, the browser tab and the Social feed.',
  },
  {
    id: 'social-post', label: 'Post your first update', auto: true,
    hint: 'Share something with your team on the Social feed — announcements, deploys, anything.',
  },
  {
    id: 'install-plugin', label: 'Install a plugin', auto: true,
    hint: 'Enable any third-party plugin (not a core one) from the Plugins page or Social Admin\'s suggestions.',
  },
  {
    id: 'feedback', label: 'Receive visitor feedback', auto: true,
    hint: 'Embed the feedback widget on your site and collect your first message on the Feedback board.',
  },
  {
    id: 'explore', label: 'Explore the Plugins page', auto: false,
    hint: 'Open the Plugins page to see everything your admin can do — you\'re here, so this one\'s easy.',
  },
];

/** Whether the site has been renamed away from the kernel default. */
function siteNameIsCustom(ctx) {
  const settings = ctx.store.kvAll().settings;
  const name = settings && settings.siteName;
  return typeof name === 'string' && name.length > 0 && name !== 'My Site';
}

let unsubs = [];

module.exports = {
  init(ctx) {
    unsubs = [];

    function loadSteps() {
      const saved = ctx.store.getState('steps', {});
      const steps = {};
      for (const def of STEP_DEFS) steps[def.id] = saved[def.id] === true;
      return steps;
    }

    function saveSteps(steps) { ctx.store.setState('steps', steps); }

    function summary() {
      const steps = loadSteps();
      // 'site-name' is also verified live, so a rename that happened while
      // this plugin was disabled still counts (it re-persists on init too).
      const isDone = (def) => steps[def.id] || (def.id === 'site-name' && siteNameIsCustom(ctx));
      const doneCount = STEP_DEFS.filter(isDone).length;
      return {
        steps: STEP_DEFS.map((def) => ({
          id: def.id, label: def.label, hint: def.hint,
          done: isDone(def),
          auto: def.auto,
        })),
        progress: Math.round((doneCount / STEP_DEFS.length) * 100),
        complete: doneCount === STEP_DEFS.length,
      };
    }

    function celebrateIfDone() {
      if (!summary().complete) return;
      if (ctx.store.getState('announced', false)) return;
      ctx.store.setState('announced', true);
      ctx.activity({
        text: '🧭 Setup complete — welcome aboard!',
        icon: '🧭', level: 'info', source: 'onboarding-checklist',
      });
    }

    function completeStep(id) {
      const def = STEP_DEFS.find((d) => d.id === id);
      if (!def) return false;
      const steps = loadSteps();
      if (steps[id]) return true; // already done — never re-announce
      steps[id] = true;
      saveSteps(steps);
      ctx.notify('onboarding.changed', summary());
      celebrateIfDone();
      return true;
    }

    /* ── auto-completions ───────────────────────────────────────────────── */

    // Checked once on activation: the site may have been named before this
    // plugin was ever enabled.
    if (siteNameIsCustom(ctx)) completeStep('site-name');

    unsubs.push(ctx.events.on('settings.changed', (p) => {
      if (p && p.siteName && p.siteName !== 'My Site') completeStep('site-name');
    }));

    unsubs.push(ctx.events.on('social.post.created', () => completeStep('social-post')));

    unsubs.push(ctx.events.on('plugin.enabled', (p) => {
      if (!p || !p.id) return;
      if (String(p.id).startsWith('core-') || p.id === 'social-admin') return;
      completeStep('install-plugin');
    }));

    unsubs.push(ctx.events.on('feedback.created', () => completeStep('feedback')));

    /* ── routes ─────────────────────────────────────────────────────────── */

    ctx.registerRoute('GET', '/api/onboarding', (req, res) => {
      ctx.json(res, 200, summary());
    });

    ctx.registerRoute('POST', '/api/onboarding/visit', async (req, res) => {
      const body = await ctx.readBody(req);
      if (!body.step || !STEP_DEFS.some((d) => d.id === body.step)) {
        return ctx.json(res, 400, { error: 'unknown step' });
      }
      completeStep(body.step);
      ctx.json(res, 200, { ok: true, ...summary() });
    });

    ctx.registerRoute('POST', '/api/onboarding/reset', (req, res) => {
      saveSteps({});
      ctx.store.setState('announced', false);
      ctx.notify('onboarding.changed', summary());
      ctx.json(res, 200, { ok: true, ...summary() });
    });

    ctx.log('Get Started checklist ready');
  },

  destroy() {
    for (const off of unsubs.splice(0)) {
      try { off(); } catch { /* noop */ }
    }
  },
};
