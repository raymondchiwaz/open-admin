# Contributing to Open Admin

Thanks for your interest in improving Open Admin! This document covers everything you need to get a development environment running and submit a change.

## Code of conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

Requirements: **Node.js ≥ 18** (no other dependencies — the project has zero).

```bash
git clone https://github.com/raymondchiwaz/open-admin.git
cd open-admin
npm test        # node --test tests/*.test.js
npm start       # run the admin locally on http://localhost:4170
npm run demo    # run the embedded-in-a-site demo on http://localhost:4200
```

State is stored in `.open-admin-data/` (git-ignored). Delete it any time to reset.

## How the codebase is organized

```
bin/open-admin.js     CLI entry (arg parsing, standalone server boot)
src/index.js          public API: createOpenAdmin(), mount(), OpenAdminKernel
src/core/
  kernel.js           request pipeline, plugin context, core routes
  plugin-manager.js   manifest loading, dependency resolution, lifecycle
  store.js            JSON-file persistence + kv store
  event-bus.js        in-process pub/sub with recent-event history
  capabilities.js     provide/consume registry across plugins
  http.js             router, body reading, static serving, SSE hub
  seed.js             first-run demo data (idempotent)
  updates.js          update checking for plugins
src/plugins/          every visible feature, as plugins
public/               admin SPA shell + drop-in feedback widget
tests/                node:test suites + fixtures
```

**Rule of thumb:** if it can be a plugin, it is a plugin. New visible features belong in `src/plugins/<id>/`, not in the kernel. The kernel stays intentionally tiny.

## Writing a plugin

Read [docs/plugin-api.md](docs/plugin-api.md) first. A minimal plugin is a directory under `src/plugins/` (or any dir passed via `--plugins`) with:

- `plugin.json` — manifest (`id`, `name`, `version`, `pages`, `widgets`, `provides`, `requires`)
- `index.js` — optional server side, `exports { init(ctx), destroy(ctx) }`
- `client.js` — optional browser side, `export default { pages, widgets }`

Look at `src/plugins/shop-stats` (self-contained example) and `src/plugins/social-admin` (event + SSE integration) for reference.

## Testing

Run the full suite with `npm test`. Tests use Node's built-in `node:test` runner — no test dependencies to install.

- Kernel-level tests live in `tests/kernel-api.test.js`.
- Test fixtures (e.g. plugins used only by tests) live in `tests/fixtures/`.
- If you add a feature, add at least one test that would fail without it.

## Style

- CommonJS (`require`/`module.exports`) — consistent with the existing code.
- No new runtime dependencies. If you need something, build the small version you need.
- 2-space indentation, single quotes, `'use strict'` at the top of each file.
- Comments explain *why*, not *what*.

## Commit and PR guidelines

1. Create a feature branch: `git checkout -b feat/my-change`.
2. Keep PRs focused — one feature or fix per PR.
3. Make sure `npm test` passes and the admin still boots (`npm start`).
4. Update documentation (`docs/`, README) when behavior or public API changes.
5. Add a `CHANGELOG.md` entry under **Unreleased**.
6. Open the PR against `main` with a short description and how to verify it.

### Conventional commits

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Reporting bugs and requesting features

Open an [issue](https://github.com/raymondchiwaz/open-admin/issues) using the provided templates. For bugs, include: Node version, how you run Open Admin (standalone vs mounted), steps to reproduce, and any console output.
