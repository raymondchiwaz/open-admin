'use strict';

/**
 * Next.js App Router bridge for Open Admin.
 *
 * Open Admin is a Node `(req, res)` handler; Next route handlers speak Web
 * `Request`/`Response`. This helper adapts between the two so Open Admin can
 * live at e.g. `src/app/open-admin/[...path]/route.ts` while your existing
 * `/admin` pipelines keep working untouched — the exact pattern Guava.land
 * uses (`src/lib/open-admin/server.ts` + `src/app/open-admin/[...path]`).
 *
 * Usage (route.ts):
 *
 *   import { createNextBridge } from 'open-admin/src/integrations/next-bridge';
 *   const bridge = createNextBridge({ getKernel, isAdminRequest });
 *   export const GET = bridge.handler; // + POST/PUT/PATCH/DELETE/OPTIONS
 *
 * `getKernel()` must resolve `{ kernel }` where kernel has `.handler(req,res)`.
 * `isAdminRequest(request)` decides the admin gate (your Supabase/auth check).
 * `basePath` must match the kernel's `basePath` option (default '/open-admin').
 */

const { Readable, Writable } = require('node:stream');

const PUBLIC_PATHS = [
  ['POST', '/api/social/feedback'],
  ['GET', '/status-page'],
  ['GET', '/api/status'],
];

function isPublicPath(method, pathname) {
  return PUBLIC_PATHS.some(([m, p]) => m === method && p === pathname);
}

async function toNodeRequest(request) {
  const body = await request.arrayBuffer();
  const req = Readable.from(body.byteLength > 0 ? [Buffer.from(body)] : []);
  req.method = request.method;
  req.url = request.url;
  req.headers = Object.fromEntries(request.headers.entries());
  return req;
}

class ResponseShim extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.status = 200;
    this.chunks = [];
    this.readable = null;
    this.controller = null;
    this.ended = false;
  }
  setHeader(key, value) { this.headers[key] = value; }
  writeHead(status, headers) {
    this.status = status;
    if (headers) Object.assign(this.headers, headers);
  }
  _write(chunk, _enc, callback) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    if (this.controller) {
      try { this.controller.enqueue(buf); } catch { /* stream closed */ }
    } else {
      this.chunks.push(buf);
    }
    callback();
  }
  _final(callback) {
    this.ended = true;
    if (this.controller) {
      try { this.controller.close(); } catch { /* already closed */ }
    }
    callback();
  }
  get headersSent() { return this.status !== 200 || Object.keys(this.headers).length > 0; }
}

function toWebResponse(res) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (['connection', 'transfer-encoding', 'keep-alive'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  if (res.readable) return new Response(res.readable, { status: res.status, headers });
  return new Response(res.chunks.length ? Buffer.concat(res.chunks) : null, { status: res.status, headers });
}

function stripBase(pathname, basePath) {
  if (pathname === basePath) return '/';
  if (pathname.startsWith(basePath + '/')) return pathname.slice(basePath.length);
  return pathname;
}

function createNextBridge({ getKernel, isAdminRequest, basePath = '/open-admin' } = {}) {
  if (typeof getKernel !== 'function') throw new Error('createNextBridge requires getKernel()');
  async function handler(request) {
    try {
      const url = new URL(request.url);
      const stripped = stripBase(url.pathname, basePath);
      if (!isPublicPath(request.method, stripped)) {
        const allowed = isAdminRequest ? await isAdminRequest(request) : true;
        if (!allowed) return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const { kernel } = await getKernel();
      const req = await toNodeRequest(request);
      const res = new ResponseShim();
      await kernel.handler(req, res);
      return toWebResponse(res);
    } catch (err) {
      console.error('[open-admin] next bridge error:', err);
      return Response.json({ error: String((err && err.stack) || err) }, { status: 500 });
    }
  }
  return { handler, GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler, OPTIONS: handler };
}

module.exports = { createNextBridge, PUBLIC_PATHS };
