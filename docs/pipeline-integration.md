# Integrating existing admin pipelines

Open Admin does not ask you to rewrite your admin. Wrap the data functions
you already have (Supabase, Prisma, REST, …) as a **capability** and let the
pipeline adapter generate the plugins.

This is how Guava.land (`/admin/*` + `/open-admin/*`) is managed: its
`src/lib/data/*.ts` accessors stay untouched; `src/lib/open-admin/*`
exposes them as `guava.data` and each pipeline (orders, products, customers,
payouts, storefront, marketing, …) becomes an Open Admin plugin.

## 1. Expose your data as a capability

```js
// host-side (Next.js, Express, plain Node — anywhere)
kernel.capabilities.provide('site.data', {
  orders: { list: ({ limit }) => getRecentOrders(limit) },
  products: { list: ({ limit }) => getCatalogueProducts(limit) },
  customers: { list: ({ limit }) => listCustomers(limit) },
}, 'my-bridge');
```

A capability is just an object. Plugin code calls
`ctx.capabilities.use('site.data')` at request time, so plugins never import
host code directly (bundler/edge-safe).

## 2. Adapt pipelines into plugins

```js
const { adaptExistingAdmin } = require('open-admin/src/integrations/pipeline');

const { pluginDefs, serverModules, assets } = adaptExistingAdmin({
  capabilityName: 'site.data',
  pipelines: [
    { id: 'guava-orders', name: 'Orders', icon: '🛒',
      resources: { orders: { list: 'orders.list' } },
      page: { path: 'guava-orders', title: 'Orders', order: 10 } },
    { id: 'guava-products', name: 'Products', icon: '👟',
      resources: { products: { list: 'products.list' } },
      page: { path: 'guava-products', title: 'Products', order: 20 } },
  ],
});

const kernel = await createOpenAdmin({ siteName: 'Guava.land', pluginDefs, serverModules, assets });
kernel.capabilities.provide('site.data', siteData, 'my-bridge');
```

Each pipeline gets `GET /api/<plugin>/<resource>/list` plus an optional
`GET /:id` / `PATCH /:id`, a nav page, and a dashboard summary widget. The
generated client UI is mobile-compact (scrollable `.oa-table-wrap` tables,
single-column cards — see `OA.tableWrap()` / `OA.isCompact()`).

Full runnable example: `examples/guava-pipeline.js`
(`node examples/guava-pipeline.js`).

## 3. Mount in Next.js without touching `/admin`

Use the bridge so Open Admin lives at `/open-admin/*` next to your existing
panel:

```ts
// src/app/open-admin/[...path]/route.ts
import { createNextBridge } from 'open-admin/src/integrations/next-bridge';
const bridge = createNextBridge({ getKernel, isAdminRequest, basePath: '/open-admin' });
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = bridge;
```

`getKernel()` boots the kernel once per isolate (inject `pluginDefs`,
`serverModules`, `assets`, and a memory/KV `store` — no filesystem needed).
`isAdminRequest()` is your existing admin gate (e.g. Supabase
`isAdminEmail`). See `src/integrations/next-bridge.js`.

## Kernel options for pipeline hosts

| Option | Description |
| --- | --- |
| `store` | Pre-built store adapter (memory, KV, …). Skips file-system `Store`. |
| `pluginDefs` | In-memory plugins: `{ id, meta, serverModule, hasClient }`. No `plugin.json` reads. |
| `serverModules` | `id → { init(ctx), destroy? }`. Skips `require()` (bundler-safe). |
| `assets` | `relPath → { content, type }` for the SPA shell + `oa/plugins/*/client.js`. No `public/` reads. |
| `plugins` | Extra plugin *directories* (plain Node hosts). |
| `basePath` | Mount point, e.g. `/open-admin`. Injected into the SPA at serve time. |
| `auth` | `(req) => boolean` gate; `POST /api/social/feedback`, `GET /status-page`, `GET /api/status` stay public. |

## Mobile compact mode

The shell collapses under 900px: the sidebar becomes an off-canvas drawer
(hamburger in the topbar, scrim + `Esc` to close, auto-close on navigate),
content padding shrinks, `.oa-grid` goes single-column, `.oa-table`
scrolls inside `.oa-table-wrap`, and toasts/dialogs go full-width with
`env(safe-area-inset-bottom)` support. Plugin authors: wrap tables with
`OA.tableWrap(html)` and branch dense UI with `OA.isCompact()`.
