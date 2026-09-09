'use strict';

/**
 * Guava.land-style pipeline integration.
 *
 * Run:  node examples/guava-pipeline.js
 * Open: http://localhost:4171/  (compact/mobile-friendly admin)
 *
 * This mirrors how Guava.land wires its *existing* admin pipelines
 * (src/lib/data/admin.ts, storefront.ts, marketing.ts …) into Open Admin
 * without rewriting them:
 *
 *   1. Your data functions stay where they are (Supabase, Prisma, …).
 *   2. They are exposed as a `site.data` capability.
 *   3. `adaptExistingAdmin()` turns each pipeline into a plugin
 *      (server routes + mobile-friendly client UI, in memory — no fs).
 *
 * Replace the stub `siteData` below with Guava's real accessors, e.g.:
 *
 *   const siteData = {
 *     'guava-orders': { orders: '/orders.list' }, // capability trail
 *   };
 *   kernel.capabilities.provide('site.data', {
 *     orders: { list: (ctx) => getRecentOrders(ctx.limit) },
 *     products: { list: (ctx) => getCatalogueProducts(ctx.limit) },
 *     customers: { list: async (ctx) => (await supabase.from('profiles')…).data },
 *     payouts: { list: (ctx) => getReferralPayouts(ctx.limit) },
 *   });
 */

const { createOpenAdmin } = require('../src/index');
const { adaptExistingAdmin } = require('../src/integrations/pipeline');

const PORT = Number(process.env.PORT || 4171);

// ── Stand-ins for Guava.land's existing pipelines (swap for the real ones) ──
const ALL_PIPELINES = {
  orders: [{ id: 'o1', customer_name: 'Amara K.', payment_status: 'paid', total_usd: 89 }],
  products: [{ id: 'p1', name: 'Aspyre Runner', is_active: true, price_usd: 89 }],
  customers: [{ id: 'c1', full_name: 'Amara K.', referral_code: 'AMARA20' }],
  payouts: [{ id: 'w1', status: 'pending', amount_usd: 12.5 }],
  requests: [{ id: 'r1', status: 'pending', shoe: 'AJ1 Chicago' }],
  influencers: [{ id: 'i1', status: 'pending_review', handle: '@kicksbyzoe' }],
};

const siteData = {};
for (const [key, rows] of Object.entries(ALL_PIPELINES)) {
  siteData[key] = { list: async () => rows };
}

async function main() {
  const { pluginDefs, serverModules, assets } = adaptExistingAdmin({
    capabilityName: 'site.data',
    pipelines: [
      { id: 'guava-orders', name: 'Orders', icon: '🛒', resources: { orders: { list: 'orders.list' } }, page: { path: 'guava-orders', title: 'Orders', order: 10 } },
      { id: 'guava-products', name: 'Products', icon: '👟', resources: { products: { list: 'products.list' } }, page: { path: 'guava-products', title: 'Products', order: 20 } },
      { id: 'guava-customers', name: 'Customers', icon: '🧑‍🤝‍🧑', resources: { customers: { list: 'customers.list' } }, page: { path: 'guava-customers', title: 'Customers', order: 30 } },
      { id: 'guava-payouts', name: 'Payouts', icon: '💸', resources: { payouts: { list: 'payouts.list' } }, page: { path: 'guava-payouts', title: 'Payouts', order: 40 } },
      { id: 'guava-requests', name: 'Requests', icon: '📩', resources: { requests: { list: 'requests.list' } }, page: { path: 'guava-requests', title: 'Requests', order: 50 } },
      { id: 'guava-creators', name: 'Creators', icon: '🎥', resources: { influencers: { list: 'influencers.list' } }, page: { path: 'guava-creators', title: 'Creators', order: 60 } },
    ],
  });

  const kernel = await createOpenAdmin({
    siteName: 'Guava.land (pipeline demo)',
    pluginDefs,
    serverModules,
    assets,
  });
  kernel.capabilities.provide('site.data', siteData, 'guava-bridge');
  await kernel.listen(PORT, '127.0.0.1');
  console.log(`Pipeline demo admin → http://localhost:${PORT}/ (try a phone-width window)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
