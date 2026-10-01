'use strict';

/** Adapt Node HTTP handlers to Next.js / Web Request and Response APIs. */
const { Readable, Writable } = require('node:stream');

const PUBLIC_PATHS = [
  ['POST', '/api/social/feedback'],
  ['GET', '/status-page'],
  ['GET', '/api/status'],
];
const HOP_HEADERS = new Set(['connection', 'transfer-encoding', 'keep-alive']);

async function toNodeRequest(request) {
  // Read incrementally so a large POST cannot allocate an unbounded buffer.
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) {
          await reader.cancel();
          throw Object.assign(new Error('Request body too large'), { status: 413 });
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  }
  const req = Readable.from(chunks);
  req.method = request.method;
  req.url = request.url;
  req.headers = Object.fromEntries(request.headers.entries());
  return req;
}

class ResponseShim extends Writable {
  constructor(onCancel) {
    super();
    this.headers = {};
    this.status = 200;
    this.chunks = [];
    this.readable = null;
    this.controller = null;
    this.sent = false;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.once('error', reject);
    });
    // A pipe may fail before the bridge begins awaiting ready.
    this.ready.catch(() => {});
    this.onCancel = onCancel;
  }
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  getHeader(key) { return this.headers[key.toLowerCase()]; }
  writeHead(status, headers = {}) {
    this.status = status;
    this.sent = true;
    for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
    if (String(this.getHeader('content-type')).includes('text/event-stream') && !this.readable) {
      this.readable = new ReadableStream({
        start: (controller) => { this.controller = controller; },
        cancel: () => { this.controller = null; this.onCancel(); this.destroy(); },
      });
      this.resolveReady();
    }
    return this;
  }
  _write(chunk, _enc, callback) {
    const buf = Buffer.from(chunk);
    if (this.controller) this.controller.enqueue(buf);
    else this.chunks.push(buf);
    callback();
  }
  _final(callback) {
    this.controller?.close();
    this.controller = null;
    this.resolveReady();
    callback();
  }
  get headersSent() { return this.sent; }
}

function createNextBridge({ getKernel, isAdminRequest, basePath = '/open-admin', loginPath } = {}) {
  if (typeof getKernel !== 'function') throw new Error('createNextBridge requires getKernel()');
  basePath = basePath.replace(/\/$/, '');
  async function handler(request) {
    let detach = () => {};
    try {
      const url = new URL(request.url);
      if (basePath && url.pathname !== basePath && !url.pathname.startsWith(basePath + '/')) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      const pathname = url.pathname.slice(basePath.length) || '/';
      const isPublic = PUBLIC_PATHS.some(([m, p]) => m === request.method && p === pathname);
      if (!isPublic) {
        const allowed = isAdminRequest ? await isAdminRequest(request) : true;
        if (!allowed) {
          if (loginPath && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
            const target = new URL(loginPath, url.origin);
            target.searchParams.set('next', url.pathname + url.search);
            return new Response(null, { status: 303, headers: { Location: target.href, 'Cache-Control': 'private, no-store' } });
          }
          return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
        }
        // Cookie-authenticated admin mutations must originate from this host.
        const origin = request.headers.get('origin');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== url.origin) {
          return Response.json({ error: 'forbidden origin' }, { status: 403 });
        }
      }
      const { kernel } = await getKernel();
      const req = await toNodeRequest(request);
      const res = new ResponseShim(() => req.emit('close'));
      const abort = () => { req.emit('close'); res.end(); };
      request.signal.addEventListener('abort', abort, { once: true });
      detach = () => request.signal.removeEventListener('abort', abort);
      res.once('finish', detach);
      res.once('close', detach);
      if (request.signal.aborted) abort();
      else await kernel.handler(req, res);
      // Static files use pipe(): the handler returns before all chunks arrive.
      // SSE instead becomes ready as soon as its headers are written.
      await res.ready;
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (!HOP_HEADERS.has(key)) headers.set(key, String(value));
      }
      if (!isPublic) {
        headers.set('Cache-Control', 'private, no-store');
        headers.delete('access-control-allow-origin');
      }
      const body = [204, 205, 304].includes(res.status) || request.method === 'HEAD'
        ? null : res.readable || (res.chunks.length ? Buffer.concat(res.chunks) : null);
      return new Response(body, { status: res.status, headers });
    } catch (err) {
      detach();
      console.error('[open-admin] next bridge error:', err);
      return Response.json({ error: err.status === 413 ? err.message : 'Unable to load the workspace. Please try again.' }, {
        status: err.status === 413 ? 413 : 500, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
  }
  return { handler, GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler, OPTIONS: handler };
}

module.exports = { createNextBridge, PUBLIC_PATHS };
