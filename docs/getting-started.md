# Getting started

Open Admin is an open-source, plugin-first admin panel with **zero dependencies**. All you need is Node.js ≥ 18.

## Run it standalone

```bash
npx open-admin --port 4170
# or from a clone of this repo:
npm start
```

You'll see:

```
  ╭──────────────────────────────────────────────────╮
  │  Open Admin is running                           │
  │  Admin panel:  http://localhost:4170             │
  │  API:          http://localhost:4170/api/bootstrap│
  │  Data dir:     …/.open-admin-data/               │
  ╰──────────────────────────────────────────────────╯
```

Open the admin panel URL in your browser. On first run, Open Admin seeds demo data (users, posts, feedback, shop metrics) so the panel is alive immediately — the seed is idempotent and skipped once data exists.

## CLI options

| Option | Default | Description |
| --- | --- | --- |
| `--port <n>` | `4170` | HTTP port |
| `--host <addr>` | `127.0.0.1` | Bind address (use `0.0.0.0` for LAN access) |
| `--data-dir <path>` | `./.open-admin-data` | Where JSON state is stored |
| `--site-name <str>` | `My Site` | Name shown in the UI |
| `--plugins <path>` | — | Extra plugin directory; repeat for multiple |
| `--version`, `--help` | — | Print version / help |

Example — load your own plugins from a local folder:

```bash
open-admin --plugins ./my-plugins --plugins ./vendor-plugins --site-name "Northwind Goods"
```

## Try the embedded demo

```bash
npm run demo
```

This starts a small storefront at [http://localhost:4200](http://localhost:4200) with Open Admin mounted at `/admin/` — the same way you'd embed it into a real app. The demo site loads Open Admin's drop-in feedback widget, so feedback you submit on the site appears live in the Social Admin feed.

## Loading your own plugins

Pass one or more directories with `--plugins`. Each directory is scanned for plugin folders (each containing a `plugin.json`). Built-in plugins and external ones use the same loading mechanism — see [plugin-api.md](plugin-api.md) to write your own.

## Data & state

Everything Open Admin knows lives in the data dir:

- **Collections** — JSON files, one per collection (e.g. users, posts, feedback).
- **Key/value store** — plugin state, settings, which plugins are enabled/disabled.

State is plain JSON on disk. Delete `.open-admin-data/` to reset to a fresh install.

## Plugins in the UI

Open the **Plugins** page to enable/disable anything, including built-ins. Disabling the dashboard removes the overview grid but the admin keeps working — that's the point: everything on the panel is a plugin. Shop Stats and Uptime Monitor ship disabled; enable them from the Social Admin "Suggested plugins" rail or the Plugins page.

## Where to next

- [Embedding](embedding.md) — mount into Express/Connect/Koa, base paths, auth
- [Plugin API](plugin-api.md) — write your first plugin
- [HTTP API](http-api.md) — push events from your site or CI
