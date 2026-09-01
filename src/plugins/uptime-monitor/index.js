'use strict';

/**
 * Uptime Monitor — ships disabled; enable it from the Plugin Manager or the
 * Social Admin "Suggested plugins" rail. Pings fake services every 30s and
 * posts the results as status updates to the Social feed.
 */

const SERVICES = ['api.mysite.com', 'app.mysite.com', 'cdn.mysite.com'];

module.exports = {
  init(ctx) {
    const pings = ctx.store.collection('pings');

    const ping = () => {
      const r = Math.random();
      const level = r < 0.9 ? 'ok' : r < 0.97 ? 'warn' : 'error';
      const ms = level === 'error' ? 3000 + Math.floor(Math.random() * 2000) : 80 + Math.floor(Math.random() * 300);
      const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
      const entry = { service, ms, level, at: new Date().toISOString() };
      pings.insert(entry);
      if (pings.all().length > 60) pings.replaceAll(pings.all().slice(-60));
      ctx.store.setState('lastStatus', level);
      const icon = level === 'ok' ? '🟢' : level === 'warn' ? '🟡' : '🔴';
      const text = level === 'ok'
        ? `**${service}** responded in ${ms} ms — all good`
        : level === 'warn'
          ? `**${service}** is slow: ${ms} ms response time`
          : `**${service}** failed to respond in ${ms} ms`;
      ctx.activity({ text, icon, level, tags: ['status'] });
    };

    ctx.every(30000, ping);
    setTimeout(ping, 1500).unref?.();

    ctx.registerRoute('GET', '/api/uptime/history', (req, res) => {
      ctx.json(res, 200, { pings: [...pings.all()].slice(-40).reverse() });
    });
  },
};
