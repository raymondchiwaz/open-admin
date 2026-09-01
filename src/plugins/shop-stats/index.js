'use strict';

/**
 * Shop Stats — a "third-party" example plugin (ships disabled; install it
 * from Social Admin's "Suggested plugins" rail). It shows the two ways a
 * plugin cooperates with plugins it knows nothing about:
 *   1. it contributes its own page + dashboard widgets (pure declarations),
 *   2. it posts into the Social feed through the public `activity` event,
 *      without importing anything from Social Admin.
 */

module.exports = {
  init(ctx) {
    const metrics = ctx.store.collection('metrics');
    if (metrics.all().length === 0) {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let revenue = 1180;
      metrics.replaceAll(days.map((d, i) => {
        revenue += Math.round((Math.sin(i) + 1.4) * 260);
        return { id: 'day-' + i, day: d, revenue, orders: 18 + ((i * 7) % 23) };
      }));
    }

    ctx.registerRoute('GET', '/api/shop-stats/metrics', (req, res) => {
      ctx.json(res, 200, { metrics: metrics.all() });
    });

    // Live shop activity → shows up in the Social Admin feed.
    const visitors = () => 30 + Math.floor(Math.random() * 50);
    ctx.store.setState('visitorsNow', visitors());
    ctx.every(45000, () => {
      const n = visitors();
      ctx.store.setState('visitorsNow', n);
      const r = Math.random();
      if (r < 0.45) {
        ctx.activity({ text: `🛍️ **${n} visitors** browsing the shop right now`, icon: '🛍️', level: 'info', tags: ['shop'] });
      } else if (r < 0.7) {
        ctx.activity({ text: `Order **#${1200 + Math.floor(Math.random() * 700)}** just came in — $${(30 + Math.random() * 200).toFixed(2)}`, icon: '💸', level: 'info', tags: ['shop', 'orders'] });
      }
    });

    ctx.log('Shop Stats ready — say hi in the Social feed 👋');
  },
};
