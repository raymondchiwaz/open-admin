'use strict';

/**
 * Custom CSS — server side. Stores one blob of user CSS in the kv store and
 * broadcasts a change event so every open browser re-injects it instantly.
 *
 *   GET /api/custom-css   → { css }
 *   PUT /api/custom-css   → { css } (string, capped at 50,000 chars)
 */

const MAX_CSS_LEN = 50000;

module.exports = {
  init(ctx) {
    const getCss = () => String(ctx.store.getState('css', '') || '');

    ctx.registerRoute('GET', '/api/custom-css', (req, res) => {
      ctx.json(res, 200, { css: getCss() });
    });

    ctx.registerRoute('PUT', '/api/custom-css', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      if (typeof body.css !== 'string') {
        return ctx.json(res, 400, { error: '"css" must be a string' });
      }
      if (body.css.length > MAX_CSS_LEN) {
        return ctx.json(res, 400, {
          error: `CSS is too long — ${MAX_CSS_LEN.toLocaleString()} characters max (you sent ${body.css.length.toLocaleString()})`,
        });
      }
      ctx.store.setState('css', body.css);
      ctx.notify('custom-css.changed', { css: body.css });
      ctx.json(res, 200, { ok: true, css: body.css });
    });
  },
};
