# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add host branding, commerce navigation and links to existing management pages.
- Improve shared controls, mobile grids, table search and 25-row pagination.
- Isolate asynchronous page rendering and support keyboard navigation in the mobile drawer.
- Stream Next.js live events with cancellation cleanup and wait for complete piped assets.
- Add bundled-host options to disable filesystem plugins and demonstration records.
- Protect private bridge responses from caching, bound bodies and reject foreign-origin mutations.

- Pipeline integration layer for existing admin backends (Guava.land-style):
  `src/integrations/pipeline.js` (`adaptExistingAdmin()` turns your current
  data functions into plugins — server routes + mobile-friendly client UI,
  in memory, no filesystem) and `src/integrations/next-bridge.js`
  (`createNextBridge()` mounts the kernel in Next.js App Router routes next
  to an untouched `/admin`). New docs (`docs/pipeline-integration.md`),
  runnable example (`examples/guava-pipeline.js`), and tests
  (`tests/pipeline-integration.test.js`).
- Kernel host options for bundled/edge runtimes: `store`, `pluginDefs`,
  `serverModules`, `assets` (plus `loadDefinition()` on the plugin manager).

### Changed

- Mobile-compact admin shell: off-canvas sidebar drawer (hamburger, scrim,
  `Esc`/navigate to close), single-column grids, horizontally scrolling
  tables (`.oa-table-wrap`, with `.oa-card` fallback), full-width toasts,
  safe-area support, and `OA.isCompact()` / `OA.tableWrap()` helpers for
  plugin authors.

## [1.1.0] - 2026-09-02

### Added

- **20 new plugins** (27 total; 10 ship disabled as an in-app "store"):
  Tasks, Announcements, Team Notes, Polls, Get Started, Notifications (General);
  Deploys (Content); Analytics (Insights); Activity Log, System Info, Health Checks,
  Status Page (public `/status-page` + `/api/status`), Incidents, Uptime Monitor (System);
  API Keys, Backups, Scheduled Jobs, Custom CSS, Data Inspector, Webhooks, Command Palette (Tools).
- Sidebar navigation grouped by plugin `category`.
- Plugin routes may serve paths outside `/api/` (public pages).
- `ctx.store.collections()` / `ctx.store.kvAll()` / `ctx.dataDir` introspection for system tools.
- Whole-system plugin integrity test: manifest validation + activate-everything +
  full-disable/re-enable cycle coverage (`tests/all-plugins.test.js`).

## [1.0.0] - 2026-09-01

### Added

- Zero-dependency plugin kernel: store (JSON persistence), event bus with SSE
  broadcasting, capability registry, plugin manager with lifecycle + revocation.
- Embeddable `mount()` middleware for Express / Connect / Koa / native `http`,
  with base-path support (`basePath: '/admin'`) and an optional `auth` hook.
- Standalone CLI: `open-admin` with `--port`, `--host`, `--data-dir`,
  `--site-name`, `--plugins` (repeatable).
- Built-in plugins (all loaded through the same public plugin mechanism):
  - **Dashboard** — the overview widget grid.
  - **Social Admin** — live activity feed (SSE) and the drop-in site feedback widget.
  - **Users** — user management.
  - **Settings** — site name and preferences.
  - **Plugin Manager** — enable/disable plugins, capability inspector, update checker.
- Example plugins shipped disabled by default:
  - **Shop Stats** — revenue widgets, dashboard integration, feed posts.
  - **Uptime Monitor** — periodic checks via `ctx.every()`.
- Open event API: `POST /api/events` accepts events from your site, CI or webhooks.
- Public feedback endpoint (`POST /api/social/feedback`) for the drop-in widget,
  deliberately reachable without auth.
- First-run demo seed data so a fresh install is alive immediately.
- Test suite built on Node's built-in test runner: event bus, capabilities,
  kernel API, store, plugin manager.

[1.0.0]: https://github.com/raymondchiwaz/open-admin/releases/tag/v1.0.0
