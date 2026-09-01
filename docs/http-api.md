# HTTP API

Open Admin exposes a JSON API. Plugin routes are matched first, then core routes. When the `auth` option is set, every request must pass it — except `POST /api/social/feedback`, which is deliberately public.

## Core endpoints

### Bootstrap

```
GET /api/bootstrap
```

Everything the SPA needs to boot: site name, version, current user, nav, plugin list, client entry ids, widgets map, capability list. Pointing a browser at this endpoint is a quick way to inspect the running instance.

### Plugins

```
GET  /api/plugins
POST /api/plugins/:id/enable
POST /api/plugins/:id/disable
```

`enable`/`disable` activate or deactivate a plugin at runtime — its routes, capabilities and timers are created or revoked live.

### Updates

```
GET  /api/updates
POST /api/updates/:id/apply
```

Check for available plugin updates and apply one.

### Settings

```
GET /api/settings
PUT /api/settings       # body: partial settings, e.g. { "siteName": "New Name" }
```

Settings are merged into the stored settings. Changing `siteName` emits a `settings.changed` event.

### Events

```
GET  /api/events/recent      # last 100 events on the bus
POST /api/events             # inject an event from outside
GET  /api/events/stream      # SSE stream of all events
```

`POST /api/events` is the open escape hatch — your site, CI, or webhooks can push events into the admin:

```bash
curl -X POST http://localhost:4170/api/events \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "activity",
    "payload": { "activity": { "text": "Deploy v2.1 ✅", "icon": "🚀", "level": "info" } }
  }'
```

- `activity` events render as posts in the Social feed.
- Every event is broadcast to connected browsers over the SSE stream.
- Missing `type` → `400 { "error": "missing \"type\"" }`.

`GET /api/events/stream` is a standard `text/event-stream`: each bus event is sent as an SSE event whose name is the event type.

### Feedback (public)

```
POST /api/social/feedback
```

Public by design so the [drop-in feedback widget](embedding.md#the-drop-in-feedback-widget) works for anonymous visitors. This is the **only** endpoint that bypasses the `auth` hook.

## Plugin routes

Plugins register routes with `ctx.registerRoute(method, '/api/<plugin>/…', handler)`. Patterns support `:params`:

```
GET /api/shop-stats/metrics      → { "metrics": [...] }
GET /api/uptime/history          → { "pings": [...] }
```

Plugin routes are matched **before** core routes. Discover what's available on a running instance via `GET /api/plugins` (each plugin's routes are its own; the plugin source is the reference).

## Conventions

- All request/response bodies are JSON; errors are `{ "error": "message" }`.
- Status codes: `200` success, `400` bad request, `401` unauthorized, `404` unknown route/plugin, `500` plugin or handler failure.
- CORS is permissive (`*`) so the feedback widget works from any origin — see the [security model](../SECURITY.md).
