# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
