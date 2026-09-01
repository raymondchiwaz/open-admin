# Embedding Open Admin

Open Admin is designed to be added to an existing Node.js app. One handler works everywhere — Express, Connect, Koa (via `koa-connect`) or plain `http`.

## The `mount()` middleware

```js
const { mount } = require('open-admin');

app.use('/admin', mount({
  dataDir: '.open-admin-data',
  siteName: 'My Site',
  basePath: '/admin',
  auth: async (req) => isMySessionValid(req),
}));
```

`mount()` returns an async `(req, res)` handler that lazily boots the kernel on first request, so it can be passed straight to `app.use()`.

The `basePath` option matters when mounting: the same admin SPA is served standalone or under a base path because `basePath` is injected into the HTML at request time.

### Plain `http` (no framework)

```js
const http = require('http');
const { mount } = require('open-admin');

const admin = await mount({ dataDir: '.data', basePath: '/admin' });

http.createServer(async (req, res) => {
  if (req.url.startsWith('/admin')) return admin(req, res);
  // ...the rest of your site
}).listen(4200);
```

A complete runnable version of this is [examples/demo-site.js](../examples/demo-site.js) — run it with `npm run demo`.

## Standalone without the CLI

```js
const { createOpenAdmin } = require('open-admin');

const kernel = await createOpenAdmin({ port: 4170, siteName: 'My Site' });
await kernel.listen(4170);
```

## Options

All options are optional; defaults in parentheses.

| Option | Description |
| --- | --- |
| `port` (`4170`) | Port for standalone `listen()` |
| `host` (`127.0.0.1`) | Bind address for standalone `listen()` |
| `dataDir` (`./.open-admin-data`) | JSON state directory |
| `siteName` (`My Site`) | Name shown in the UI (changeable later in Settings) |
| `basePath` (`''`) | Base path when mounted, e.g. `/admin` |
| `plugins` (`[]`) | Extra plugin directories to load |
| `auth` (`null`) | Async `(req) => boolean` gate applied to every request |

## Authentication

Open Admin does **not** ship a login screen; it relies on your app's auth. Provide `auth` and every request is checked before routing:

```js
auth: async (req) => {
  const user = await mySession(req);      // your cookie/session logic
  return Boolean(user && user.role === 'admin');
}
```

When `auth` rejects a request, the API responds `401 { "error": "unauthorized" }`.

**The one exception:** `POST /api/social/feedback` is deliberately public so the drop-in feedback widget works for anonymous visitors. See [SECURITY.md](../SECURITY.md) for the full security model.

## The drop-in feedback widget

Any site — even one that doesn't embed the admin — can collect feedback into Social Admin with a single script tag:

```html
<script src="http://localhost:4170/social-admin-feedback.js" defer></script>
```

Feedback posted by visitors lands live in the Social feed, through the public feedback endpoint.

## CORS

Open Admin sets permissive CORS (`Access-Control-Allow-Origin: *`) so the feedback widget works from any origin. If you expose the panel beyond localhost, front it with your own auth or a reverse proxy that restricts origins.

## Pushing events from your app

Anything in your app, CI, or a webhook can post events into the admin:

```bash
curl -X POST http://localhost:4170/api/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"activity","payload":{"activity":{"text":"Deploy v2.1 ✅","icon":"🚀","level":"info"}}}'
```

`activity` events appear as posts in the Social feed; every event is also broadcast live to connected browsers over SSE. See [http-api.md](http-api.md).
