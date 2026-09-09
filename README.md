# Open Admin

**An open-source, plugin-first admin panel you can embed into any site.**

Everything in Open Admin — pages, widgets, themes, even the dashboard itself — is a plugin. Mount it into an existing Node.js app in five lines, or run it standalone with `npx open-admin`. Zero dependencies, zero build step.

```bash
npx open-admin --port 4170
# → Admin panel:  http://localhost:4170
```

## A workspace built for your team

The home feed brings activity, feedback, and tasks into one calm workspace. Updates appear in chronological order, with explicit **Load more** pagination. New events wait behind a **Show when you’re ready** button so the page stays still while you read.

- **Needs attention** collects unresolved update posts and warnings/errors.
- **Team updates**, **Feedback**, **Saved**, and source/text filters keep conversations easy to find.
- Create and complete tasks directly from the home screen.
- Composer drafts survive refresh and navigation. Bookmarks are private to this browser and workspace path.
- Simplified navigation, keyboard tabs, light/dark themes, reduced motion support, and a responsive drawer.
- Counts come from the enabled apps. Missing telemetry is labeled **Not connected**.

The first run includes sample data. The app-update catalog is a demonstration; applying a demo update records a version but does not install software. The existing auth hook gates access, while posts still use the shared Admin identity; individual user sessions and permissions are not implemented by this UI redesign.

See [the workspace guide](docs/workspace.md) for behavior, integration, and verification details.

## Why

Most admin panels give you a shell you have to bend to your needs. Open Admin starts from the opposite premise: the kernel ships **no UI at all** — only a tiny core (store, event bus, capability registry, plugin manager, HTTP layer). The dashboard, users page, settings, even the plugin manager and the social activity feed are plugins loaded through exactly the same mechanism a third-party plugin uses. If you can write a plugin, you can change anything.

## Features

- **Plugin-first** — every page, widget and feature is a plugin with a manifest, a lifecycle, and automatic revocation when disabled.
- **Embeddable** — mount into Express, Connect, Koa or plain `http` with one handler; supports base paths like `/admin`.
- **Zero dependencies** — pure Node.js (≥18). No npm install, no bundler, no build step.
- **Live by default** — every event on the bus is streamed to connected browsers over SSE. The Social feed updates in real time.
- **Cross-plugin capabilities** — plugins provide and consume capabilities without importing each other.
- **Open event API** — `POST /api/events` lets your site, CI or webhooks push events straight into the admin.
- **Optional auth hook** — one async function gates every request in production.

## Quick start

```bash
# Standalone
npm start                        # or: node bin/open-admin.js --port 4170

# Demo: an existing site with the admin mounted at /admin
npm run demo                     # → http://localhost:4200 (site) and /admin/ (panel)

# Tests
npm test
```

CLI options:

```
open-admin [options]

--port <n>         HTTP port                     (default 4170)
--host <addr>      bind address                  (default 127.0.0.1)
--data-dir <path>  where JSON state is stored    (default .open-admin-data)
--site-name <str>  name shown in the UI
--plugins <path>   extra plugin directory (repeatable)
```

## Embed in your app

```js
const { mount } = require('open-admin');

// Express / Connect / Koa (via koa-connect) / plain http
app.use('/admin', mount({
  dataDir: '.open-admin-data',
  siteName: 'My Site',
  basePath: '/admin',
  auth: async (req) => mySessionCheck(req),   // optional, gates everything
}));
```

Standalone, without a framework:

```js
const { createOpenAdmin } = require('open-admin');
const kernel = await createOpenAdmin({ port: 4170 });
await kernel.listen(4170);
```

See [docs/getting-started.md](docs/getting-started.md) and [docs/embedding.md](docs/embedding.md).

## What ships in the box

**27 plugins.** Sidebar items are grouped by `category` (General · Content · Insights · System · Tools); the ten
"app-store" plugins ship disabled and can be enabled from **Apps & integrations**.

| Plugin | Category | What it does |
| --- | --- | --- |
| Social Admin | General | The social feed + feedback board — the home page |
| Dashboard | General | The overview grid, assembled from every plugin's widgets |
| Users | General | User list and management |
| Tasks ✅ | General | Team task board (todo/doing/done) + dashboard widget |
| Announcements 📣 | General | Site-wide banner composer + history |
| Team Notes 📝 | General | Color-coded shared sticky notes |
| Polls 🗳️ | General | Create/vote polls; results bars (vote from the dashboard too) |
| Get Started 🧭 | General | First-run onboarding checklist, auto-tracked |
| Notifications 🔔 | General | Bell + inbox fed by every event in the system |
| Deploys 🚢 | Content | Deploy tracker with finish/rollback + feed posts |
| Analytics 📈 | Insights | 14-day event charts + `analytics.track` capability |
| Shop Stats *(example)* | Insights | Third-party example: revenue widgets + live shop activity |
| Activity Log 📜 | System | Every event on the bus, searchable (ring buffer, live) |
| System Info 🖥️ | System | Node/memory/uptime + store stats |
| Health Checks 📡 | System | URL probes with failure/recovery feed posts |
| Status Page 🌍 | System | Public `/status-page` + `/api/status`, fed by health checks |
| Incidents 🚨 | System | Incident timeline with severity + resolution flow |
| Plugin Manager | System | Enable/disable/inspect any plugin (including itself) |
| Settings | System | Site name, theme, prefs |
| API Keys 🔑 | Tools | Generate/revoke tokens, `api-keys.verify` capability |
| Backups 💾 | Tools | One-click + scheduled snapshots of the JSON store |
| Scheduled Jobs ⏰ | Tools | Cron-style jobs (feed posts / http ping / kv touch) |
| Custom CSS 🎨 | Tools | Brand the admin with your own CSS + presets |
| Data Inspector 🗄️ | Tools | Browse the JSON store and kv (read-only, secret-masked) |
| Webhooks 🪝 | Tools | HMAC-signed outbound webhooks on any event, with logs |
| Command Palette ⌘ | Tools | Ctrl/Cmd+K fuzzy finder for pages and actions |
| Uptime Monitor *(example)* | System | Periodic status pings posted to the feed |

## Write a plugin

A plugin is a directory with a `plugin.json` manifest, an optional server-side `index.js` and an optional browser-side `client.js`:

```
my-plugin/
├── plugin.json    # id, name, pages, widgets, provides, requires
├── index.js       # server side:  exports { init(ctx), destroy(ctx) }
└── client.js      # browser side: export default { register(OA) }
```

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "icon": "🚀",
  "pages": [{ "path": "my-plugin", "title": "My Plugin", "icon": "🚀", "order": 10 }],
  "widgets": [{ "slot": "dashboard.grid", "id": "my-widget", "order": 50 }],
  "provides": ["my.metrics"],
  "requires": []
}
```

```js
module.exports = {
  init(ctx) {
    const items = ctx.store.collection('items');       // namespaced persistence

    ctx.registerRoute('GET', '/api/my-plugin/items', (req, res) =>
      ctx.json(res, 200, { items: items.all() }));

    ctx.every(60000, () =>                             // auto-cleared on disable
      ctx.activity({ text: 'Still alive ✨', icon: '🚀' }));
  },
};
```

The full `ctx` API, manifest reference and capability system are documented in [docs/plugin-api.md](docs/plugin-api.md). Look at `src/plugins/shop-stats` for a complete working example.

## Documentation

- [Getting started](docs/getting-started.md) — install, run, first login, data & state
- [Embedding](docs/embedding.md) — Express/Connect/Koa/native http, base paths, auth, CORS
- [Plugin API](docs/plugin-api.md) — manifests, `init(ctx)`, capabilities, client-side plugins
- [HTTP API](docs/http-api.md) — core endpoints, events, SSE stream
- [Contributing](CONTRIBUTING.md) — dev setup, code style, PR process

## Architecture

```
                 ┌───────────────────────────────────────────┐
                 │                 Kernel                    │
   HTTP ────────▶│  Router   Store   EventBus   Capabilities │
   (core +       │       ▲         ▲        ▲          ▲     │
   plugins)      │       └─────────┴────────┴──────────┴─    │
                 │            PluginManager                  │
                 └───────┬───────────────┬───────────┬───────┘
                         ▼               ▼           ▼
                    dashboard       social-admin   shop-stats   …
                  (pages+widgets)  (feed+SSE)     (example)
```

- `src/core/` — kernel, store (JSON files), event bus, SSE hub, capability registry, plugin manager, HTTP router
- `src/plugins/` — everything visible in the UI; loaded through the same public mechanism
- `public/` — the admin SPA shell and the drop-in feedback widget
- `tests/` — Node's built-in test runner (`npm test`)

## Security

Open Admin is designed to sit **behind your own auth** in production. Set the `auth` option to gate every request (the public feedback endpoint is the one exception). It intentionally ships permissive CORS so the feedback widget works from any site. Please review [docs/embedding.md](docs/embedding.md) before exposing it publicly.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Contributing

Contributions welcome — good first issues are labeled. See [CONTRIBUTING.md](CONTRIBUTING.md). Every PR runs the test suite in CI.

## License

[MIT](LICENSE) © Open Admin contributors
