# Plugin API

Everything in Open Admin is a plugin — the dashboard, users, settings, even the plugin manager itself. A plugin uses the exact same mechanism as a third-party one, so anything you can do as a plugin author, the core does too.

## Anatomy

A plugin is a directory containing:

```
my-plugin/
├── plugin.json    # manifest (required)
├── index.js       # optional server side:  exports { init(ctx), destroy(ctx) }
└── client.js      # optional browser side: export default { register(OA) }
```

Place it under `src/plugins/` (built-ins) or load any directory with `--plugins ./my-plugins`.

## The manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "You",
  "icon": "🚀",
  "defaultDisabled": false,
  "pages": [
    { "path": "my-plugin", "title": "My Plugin", "icon": "🚀", "order": 10 }
  ],
  "widgets": [
    { "slot": "dashboard.grid", "id": "my-widget", "order": 50 }
  ],
  "provides": ["my.metrics"],
  "requires": []
}
```

| Field | Rules |
| --- | --- |
| `id` | Required. Lowercase letters, digits, hyphens (`/^[a-z0-9][a-z0-9-]*$/`). Must be unique. Also used to namespace storage and client asset URLs (`/oa/plugins/<id>/…`). |
| `name`, `version`, `icon` | Shown in the Plugin Manager UI. |
| `defaultDisabled` | `true` ships the plugin installed but off (e.g. Shop Stats). |
| `pages` | Sidebar navigation entries. `path` becomes the hash route; `order` sorts the nav. |
| `widgets` | Widgets contributed to slots. The dashboard grid slot is `dashboard.grid`. |
| `provides` | Capability names this plugin registers. |
| `requires` | Capability/plugin ids needed. Known dependencies are activated automatically; plugins that are required by others can't be disabled. |

## Server side: `index.js`

```js
module.exports = {
  async init(ctx) {
    // ...register routes, timers, capabilities, subscribe to events
  },
  async destroy(ctx) {
    // optional cleanup when the plugin is disabled
  },
};
```

`init(ctx)` runs when the plugin is activated; everything the plugin registered is **automatically revoked** when it's disabled — routes removed, capabilities unregistered, timers cleared.

### The plugin context (`ctx`)

| Member | Description |
| --- | --- |
| `ctx.pluginId` | The plugin's id. |
| `ctx.store.collection(name)` | Persistent collection, auto-prefixed per plugin (e.g. `my-plugin.items`). Methods: `all()`, `find(fn)`, `get(id)`, `insert(doc)`, `update(id, patch)`, `remove(id)`, `replaceAll(arr)`. Writes are debounced to JSON on disk. |
| `ctx.store.getState(key, fallback)` / `ctx.store.setState(key, value)` | Namespaced key/value persistence. |
| `ctx.events` | The global event bus: `emit(type, payload)`, `on(type, fn)`, `onAny(fn)`, `recent(n)`. |
| `ctx.notify(type, payload)` | Emit an event **and** broadcast it to connected browsers (SSE). |
| `ctx.activity({ text, icon, level, source, tags })` | Emit an `activity` event — Social Admin renders these as feed posts. |
| `ctx.capabilities.provide(name, fn)` | Register a capability other plugins can `use(name)`. |
| `ctx.capabilities.use(name)` | Get a capability's function (if any plugin provided it). |
| `ctx.capabilities.has(name)` | Whether a capability exists. |
| `ctx.registerRoute(method, pattern, handler)` | HTTP route under `/api/…`. Pattern supports `:params`. Handler is `(req, res, params, url)`. Plugin routes are matched before core routes. |
| `ctx.every(ms, fn)` | Own an interval; cleared automatically on disable/shutdown. |
| `ctx.json(res, status, data)` | Send a JSON response. |
| `ctx.readBody(req)` | Read and JSON-parse a request body. |
| `ctx.log(...args)` | Console logging prefixed with the plugin id. |

### Registering a route

```js
ctx.registerRoute('GET', '/api/my-plugin/items/:id', async (req, res, params) => {
  const item = items.get(params.id);
  if (!item) return ctx.json(res, 404, { error: 'not found' });
  ctx.json(res, 200, { item });
});
```

### Cross-plugin capabilities

Instead of importing each other, plugins communicate through the capability registry and the event bus. Social Admin, for example, exposes feed posting through the public `activity` event — Shop Stats posts shop orders into the feed without knowing Social Admin exists:

```js
// provide
ctx.capabilities.provide('my.metrics', () => computeMetrics(), ctx.pluginId);

// consume (check with has() first — the provider may be disabled)
if (ctx.capabilities.has('other.export')) {
  const exportFn = ctx.capabilities.use('other.export');
}
```

### Timers

```js
ctx.every(30000, () => checkStatus());
```

Intervals are unref'd (won't keep the process alive) and cleared when the plugin is disabled or the kernel shuts down.

## Client side: `client.js`

Loaded by the admin SPA as an ES module. Export `register(OA)`:

```js
export default {
  register(OA) {
    OA.registerPage('my-plugin', {
      mount(el, OA) {
        OA.api('/api/my-plugin/items').then(({ items }) => {
          el.innerHTML = `<div class="oa-page-head"><h2>🚀 My Plugin</h2></div>
            <div class="oa-grid">${items.map((i) =>
              `<div class="oa-card">${OA.esc(i.title)}</div>`).join('')}</div>`;
        });
      },
    });

    OA.registerWidget('my-widget', {
      mount(el, OA) {
        OA.api('/api/my-plugin/summary').then((d) => {
          el.innerHTML = `<div class="oa-card oa-stat">
            <span class="num">${d.total}</span><span class="lbl">Items</span></div>`;
        }).catch((err) => { el.innerHTML = OA.crashCard('my-plugin', err.message); });
      },
    });
  },
};
```

Handy `OA` helpers seen in the built-ins: `OA.api(path)` (fetch JSON), `OA.esc(str)` (HTML escaping), `OA.crashCard(pluginId, message)` (error card), plus the shared CSS classes `oa-grid`, `oa-card`, `oa-stat`, `oa-table`, `oa-chip`. Additional CSS files in your plugin directory are served from `/oa/plugins/<id>/<file>`.

## Events cheat sheet

| Event | Meaning |
| --- | --- |
| `activity` | A Social feed post (`payload.activity = { text, icon, level, source }`) |
| `settings.changed` | Site settings were updated |

Any event you `notify()` reaches connected browsers over SSE at `/api/events/stream`, and external systems can inject events with `POST /api/events` — see [http-api.md](http-api.md).

## Complete example

Read [`src/plugins/shop-stats`](../src/plugins/shop-stats) — a self-contained "third-party" plugin with a page, a dashboard widget, its own API route, namespaced storage, a timer, and Social-feed integration via `ctx.activity()`.

### Store introspection (system tools)

`ctx.store` also exposes admin-privileged helpers for tools like the Data Inspector:

- `ctx.store.collections()` — names of **all** collections across every plugin
- `ctx.store.kvAll()` — a snapshot of the whole kv store (keys matching
  `/secret|token|password|hash/i` should be masked by consumers)
- `ctx.dataDir` — the kernel's data directory (server-side only)

Use these only inside system/administration plugins, not ordinary features.

### Manifest extras

- `category`: `"General" | "Content" | "Insights" | "System" | "Tools"` — groups the plugin's
  pages in the sidebar (default `"General"`).
- Plugin routes are matched at **any** path (not just `/api/...`), so a plugin can serve a
  public page like `/status-page`. Routes for `/status-page` and `/api/status`, plus
  `POST /api/social/feedback`, are exempt from the kernel's `auth` hook.
