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
    let failuresInRow = 0;
    let okSinceDigest = 0;

    const ping = () => {
      const r = Math.random();
      const level = r < 0.9 ? 'ok' : r < 0.97 ? 'warn' : 'error';
      const ms = level === 'error' ? 3000 + Math.floor(Math.random() * 2000) : 80 + Math.floor(Math.random() * 300);
      const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
      pings.insert({ service, ms, level, at: new Date().toISOString() });
      if (pings.all().length > 60) pings.replaceAll(pings.all().slice(-60));
      ctx.store.setState('lastStatus', level);

      if (level !== 'ok') {
        failuresInRow++;
        ctx.activity({
          text: level === 'warn'
            ? `**${service}** is slow: ${ms} ms response time`
            : `**${service}** failed to respond in ${ms} ms`,
          icon: level === 'warn' ? '🟡' : '🔴',
          level,
          tags: ['status'],
        });
        return;
      }
      failuresInRow = 0;
      okSinceDigest++;
      // Healthy pings are the norm — surface a green digest occasionally,
      // and an immediate all-clear after any failure.
      if (failuresInRow === 0 && okSinceDigest >= 20) {
        okSinceDigest = 0;
        ctx.activity({ text: `**${service}** responded in ${ms} ms — all services operational`, icon: '🟢', level: 'ok', tags: ['status'] });
      }
    };

    ctx.every(30000, ping);
    setTimeout(ping, 1500).unref?.();

    ctx.registerRoute('GET', '/api/uptime/history', (req, res) => {
      ctx.json(res, 200, { pings: [...pings.all()].slice(-40).reverse() });
    });
  },
};
