'use strict';

/**
 * Minimal HTTP toolkit — router, JSON body parsing, static files and SSE.
 * Zero dependencies by design: Open Admin should run anywhere Node runs,
 * with nothing but `node`.
 */

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Parse a route pattern like "/api/social/posts/:id/react" into a RegExp. */
function compilePattern(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        names.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + source + '/?$'), names };
}

class Router {
  constructor() {
    this._routes = []; // { method, regex, names, handler }
  }

  add(method, pattern, handler) {
    const { regex, names } = compilePattern(pattern);
    this._routes.push({ method: method.toUpperCase(), regex, names, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /** Find a route. Returns { handler, params } or null. */
  match(method, pathname) {
    for (const route of this._routes) {
      if (route.method !== method && route.method !== 'ANY') continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

/** Read and parse a JSON body (or query-string form posts). Max 1 MB. */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        } else {
          resolve(JSON.parse(raw));
        }
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Serve a file from `rootDir` for a URL path. Returns false if not found. */
function serveStatic(rootDir, urlPath, res) {
  const relative = urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(rootDir, relative));
  if (!file.startsWith(path.normalize(rootDir + path.sep)) && file !== path.normalize(rootDir)) {
    return false; // path traversal guard
  }
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (stat.isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * Server-Sent Events hub. Every connected admin tab gets a live stream of
 * kernel + plugin events — this is what makes the Social Admin feed feel
 * like a real social network.
 */
class SSEHub {
  constructor() {
    this._clients = new Set();
    this._heartbeat = setInterval(() => this._ping(), 25000);
    this._heartbeat.unref();
  }

  /** Attach an incoming request as an SSE stream. Returns the Response. */
  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this._clients.add(res);
    req.on('close', () => this._clients.delete(res));
    return res;
  }

  send(type, payload) {
    const frame = `event: message\ndata: ${JSON.stringify({ type, payload, at: new Date().toISOString() })}\n\n`;
    for (const res of [...this._clients]) {
      try { res.write(frame); } catch { this._clients.delete(res); }
    }
  }

  get clientCount() { return this._clients.size; }

  _ping() {
    for (const res of [...this._clients]) {
      try { res.write(': ping\n\n'); } catch { this._clients.delete(res); }
    }
  }

  close() {
    clearInterval(this._heartbeat);
    for (const res of [...this._clients]) { try { res.end(); } catch { /* noop */ } }
    this._clients.clear();
  }
}

module.exports = { Router, readBody, json, serveStatic, SSEHub, MIME };
