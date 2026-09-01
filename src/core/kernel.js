'use strict';

/**
 * OpenAdminKernel — wires everything together: the store, the event bus,
 * SSE broadcasting, the capability registry, the plugin manager, and the
 * HTTP layer (API routes + static assets). Zero dependencies.
 *
 * The kernel's own HTTP API is intentionally tiny (bootstrap, nav, plugins,
 * settings, events). Everything else — social feed, users, feedback — is
 * contributed by plugins via `ctx.registerRoute(...)`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const { Store } = require('./store');
const { EventBus } = require('./event-bus');
const { Capabilities } = require('./capabilities');
const { PluginManager } = require('./plugin-manager');
const { Updates } = require('./updates');
const { Router, readBody, json, serveStatic, SSEHub } = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const BUILTIN_PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

const DEFAULT_OPTIONS = {
  port: 4170,
  host: '127.0.0.1',
  dataDir: path.join(process.cwd(), '.open-admin-data'),
  siteName: 'My Site',
  basePath: '',
  plugins: [],          // extra plugin directories to load
  auth: null,           // async (req) => true|false, checked on everything except public feedback
};

class OpenAdminKernel {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.siteName = this.options.siteName;
    this.store = new Store(this.options.dataDir);
    this.bus = new EventBus();
    this.capabilities = new Capabilities();
    this.sse = new SSEHub();
    this.updates = new Updates(this);
    this.plugins = new PluginManager(this);

    this._router = new Router();
    this._pluginRoutes = [];      // { pluginId, method, regex, names, handler }
    this._timers = new Map();     // pluginId -> [timeout handles]
    this._ready = null;
    this._server = null;

    // Every bus event is mirrored to connected browsers (this is what makes
    // the Social Admin feed live).
    this.bus.onAny((type, payload) => this.sse.send(type, payload));
    this._registerCoreRoutes();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Load plugins and start everything. Idempotent. */
  async init() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      for (const dir of this._builtinPluginDirs()) this.plugins.loadDir(dir);
      for (const dir of this.options.plugins || []) {
        this.plugins.loadDir(path.resolve(dir));
      }
      await this.plugins.activateAll();
      require('./seed')(this); // first-run demo data (idempotent)
      return this;
    })();
    return this._ready;
  }

  _builtinPluginDirs() {
    try {
      return fs
        .readdirSync(BUILTIN_PLUGINS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(BUILTIN_PLUGINS_DIR, d.name));
    } catch {
      return [];
    }
  }

  /** Start the standalone HTTP server. Resolves with the server. */
  async listen(port = this.options.port, host = this.options.host) {
    await this.init();
    this._server = http.createServer((req, res) => this.handler(req, res));
    return new Promise((resolve, reject) => {
      this._server.once('error', reject);
      this._server.listen(port, host, () => resolve(this._server));
    });
  }

  async close() {
    this.sse.close();
    for (const timers of this._timers.values()) timers.forEach(clearInterval);
    this._timers.clear();
    if (this._server) await new Promise((resolve) => this._server.close(resolve));
  }

  // ── Plugin context ───────────────────────────────────────────────────────

  /**
   * The API every plugin receives in init(ctx). Everything a plugin
   * registers here is automatically revoked when the plugin is disabled.
   */
  createPluginContext(meta) {
    const kernel = this;
    const id = meta.id;
    return {
      pluginId: id,
      meta,
      /** Global event bus — emit and subscribe (also streamed to browsers). */
      events: kernel.bus,
      /** Persistent storage; collection names are auto-prefixed per plugin. */
      store: {
        collection: (name) => kernel.store.collection(`${id}.${name}`),
        getState: (key, fallback) => kernel.store.kvGet(`${id}.${key}`, fallback),
        setState: (key, value) => kernel.store.kvSet(`${id}.${key}`, value),
      },
      /** Provide/use cross-plugin capabilities. */
      capabilities: kernel.capabilities,
      /** Register an HTTP route under /api/… (removed when disabled). */
      registerRoute(method, pattern, handler) {
        kernel._pluginRoutes.push({ pluginId: id, method: method.toUpperCase(), pattern, handler });
      },
      /** Own an interval; it is cleared automatically on disable/shutdown. */
      every(ms, fn) {
        const handle = setInterval(fn, ms);
        handle.unref?.();
        if (!kernel._timers.has(id)) kernel._timers.set(id, []);
        kernel._timers.get(id).push(handle);
        return handle;
      },
      /** Response/request helpers so plugins need zero requires. */
      json: (res, status, data) => json(res, status, data),
      readBody: (req) => readBody(req),
      /** Emit an event AND broadcast it to connected browsers. */
      notify(type, payload) {
        return kernel.bus.emit(type, payload);
      },
      /** Emit an "activity" event — Social Admin renders these as feed posts. */
      activity({ text, icon = '✨', level = 'info', source }) {
        return kernel.bus.emit('activity', { activity: { text, icon, level, source: source || id } });
      },
      log: (...args) => console.log(`[${id}]`, ...args),
    };
  }

  /** Remove every trace of a plugin (routes, capabilities, timers). */
  _revokePlugin(id) {
    this._pluginRoutes = this._pluginRoutes.filter((r) => r.pluginId !== id);
    this.capabilities.revoke(id);
    for (const handle of this._timers.get(id) || []) clearInterval(handle);
    this._timers.delete(id);
  }

  // ── Core HTTP API ────────────────────────────────────────────────────────

  _registerCoreRoutes() {
    this._router.get('/api/bootstrap', async (req, res) => {
      json(res, 200, {
        siteName: this.siteName,
        version: require('../../package.json').version,
        me: { name: 'Admin', handle: '@admin', avatar: '🫡' },
        nav: this.plugins.nav(),
        home: this.plugins.homePath(),
        plugins: this.plugins.list(),
        clients: this.plugins.clientEntryIds(),
        widgets: this.plugins.widgetsMap(),
        capabilities: this.capabilities.list(),
      });
    });

    this._router.get('/api/plugins', async (req, res) => {
      json(res, 200, { plugins: this.plugins.list() });
    });

    this._router.post('/api/plugins/:id/enable', async (req, res, params) => {
      try {
        await this.plugins.activate(params.id);
        json(res, 200, { ok: true, plugins: this.plugins.list() });
      } catch (err) {
        json(res, err.status || 500, { error: err.message });
      }
    });

    this._router.post('/api/plugins/:id/disable', async (req, res, params) => {
      try {
        await this.plugins.deactivate(params.id);
        json(res, 200, { ok: true, plugins: this.plugins.list() });
      } catch (err) {
        json(res, err.status || 500, { error: err.message });
      }
    });

    this._router.get('/api/updates', async (req, res) => {
      json(res, 200, { updates: this.updates.checkAll() });
    });

    this._router.post('/api/updates/:id/apply', async (req, res, params) => {
      try {
        json(res, 200, { ok: true, ...this.updates.apply(params.id) });
      } catch (err) {
        json(res, err.status || 500, { error: err.message });
      }
    });

    this._router.get('/api/settings', async (req, res) => {
      json(res, 200, this.store.kvGet('settings', { siteName: this.siteName }));
    });

    this._router.put('/api/settings', async (req, res) => {
      const body = await readBody(req);
      const settings = { ...this.store.kvGet('settings', {}), ...body };
      this.store.kvSet('settings', settings);
      if (body.siteName) {
        this.siteName = body.siteName;
        this.bus.emit('settings.changed', { siteName: this.siteName });
      }
      json(res, 200, settings);
    });

    this._router.get('/api/events/recent', async (req, res) => {
      json(res, 200, { events: this.bus.recent(100) });
    });

    // Open emit endpoint — your site, plugins, CI webhooks… anything can
    // push an event (e.g. an `activity` event shows up in Social Admin).
    this._router.post('/api/events', async (req, res) => {
      const body = await readBody(req);
      if (!body.type) return json(res, 400, { error: 'missing "type"' });
      const event = this.bus.emit(String(body.type), body.payload || {});
      json(res, 200, event);
    });

    this._router.get('/api/events/stream', async (req, res) => {
      this.sse.addClient(req, res);
    });
  }

  /**
   * Match a request against routes contributed by plugins, then core routes.
   * Returns { handler, params } or null.
   */
  _matchRoute(method, pathname) {
    for (const route of this._pluginRoutes) {
      if (route.method !== method && route.method !== 'ANY') continue;
      const { regex, names } = compile(route.pattern);
      const m = regex.exec(pathname);
      if (!m) continue;
      const params = {};
      names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return this._router.match(method, pathname);
  }

  /** index.html with the __OA_BASE__ placeholder replaced, so the same SPA
   *  works standalone and when mounted at e.g. /admin. */
  _serveIndex(res) {
    if (!this._indexHtml) {
      this._indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    }
    const base = this.options.basePath
      ? (this.options.basePath.startsWith('/') ? this.options.basePath : '/' + this.options.basePath)
      : '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(this._indexHtml.replace(/__OA_BASE__/g, base.replace(/\/$/, '')));
  }

  // ── The one request handler (works standalone and as middleware) ─────────

  async handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;

    // Allow mounting under a base path, e.g. app.use('/admin', oa.handler).
    const base = this.options.basePath;
    if (base) {
      if (pathname === base) pathname = '/';
      else if (pathname.startsWith(base + '/')) pathname = pathname.slice(base.length);
    }

    // Permissive CORS so the feedback widget works from any site; the API is
    // meant to sit behind your own auth in production (see options.auth).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      // Public escape hatch: the site feedback widget must work for visitors
      // (no auth). Everything else goes through the optional auth hook.
      const isPublicFeedback =
        req.method === 'POST' && pathname === '/api/social/feedback';
      if (this.options.auth && !isPublicFeedback) {
        const ok = await this.options.auth(req);
        if (!ok) { json(res, 401, { error: 'unauthorized' }); return; }
      }

      // 1) Admin SPA for browser navigation (with base-path injection).
      if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/oa/') &&
          (pathname === '/' || pathname === '/admin' || !path.extname(pathname))) {
        this._serveIndex(res);
        return;
      }

      // 2) Plugin client assets: /oa/plugins/<id>/<file>
      const pluginAsset = pathname.match(/^\/oa\/plugins\/([a-z0-9-]+)\/(.+)$/);
      if (pluginAsset) {
        const dir = this.plugins.dirOf(pluginAsset[1]);
        if (dir && serveStatic(dir, pluginAsset[2], res)) return;
        json(res, 404, { error: 'plugin asset not found' });
        return;
      }

      // 3) Shell assets: /oa/… maps onto public/, plus root-level files like
      //    /social-admin-feedback.js (traversal-guarded inside serveStatic).
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        const rel = pathname.startsWith('/oa/')
          ? pathname.slice('/oa/'.length)
          : pathname.replace(/^\/+/, '');
        if (serveStatic(PUBLIC_DIR, rel, res)) return;
      }

      // 4) API: plugin routes first, then core routes.
      if (pathname.startsWith('/api/')) {
        const match = this._matchRoute(req.method, pathname);
        if (match) {
          req.searchParams = url.searchParams;
          await match.handler(req, res, match.params, url);
          return;
        }
        json(res, 404, { error: `no route for ${req.method} ${pathname}` });
        return;
      }

      // 5) Anything else → 404.
      json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[open-admin] request error:', err);
      if (!res.headersSent) json(res, 500, { error: err.message || 'internal error' });
      else try { res.end(); } catch { /* noop */ }
    }
  }
}

/** Compile a route pattern (shared with http.Router's format). */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + source + '/?$'), names };
}

module.exports = { OpenAdminKernel, DEFAULT_OPTIONS };
