'use strict';

/**
 * Data Inspector — READ-ONLY explorer for the on-disk JSON store.
 *
 * The store is just JSON files in ctx.dataDir (default `.open-admin-data`):
 *    <collection>.json   → array of docs
 *    kv.json             → the shared key/value store
 *
 * Security:
 *   - No route writes a single byte (no store writes, no custom files).
 *   - Collection reads use a locked join: the resolved path must stay inside
 *     dataDir (path traversal → 404).
 *   - KV values are masked when the key matches /secret|token|password|hash/i
 *     and long values are truncated — secrets never leave the server.
 */

const fs = require('fs');
const path = require('path');

const KV_SECRET_RE = /secret|token|password|hash/i;
const KV_MAX_LEN = 200;
const SEARCH_LIMIT = 20;
const MAX_DOCS = 200;

/** List of "name" (without .json) for every collection file on disk. */
function listCollectionFiles(dataDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.endsWith('.tmp.json'))
    .map((e) => e.name.slice(0, -'.json'.length))
    .sort();
}

/** Read + parse a collection file. Returns null when missing/unreadable. */
function readCollectionFile(dataDir, name) {
  // Locked join: resolves through any ../ or absolute tricks and then must
  // still point inside dataDir.
  const root = path.resolve(dataDir);
  const file = path.resolve(root, name + '.json');
  if (!file.startsWith(root + path.sep)) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return { file, data: JSON.parse(raw) };
  } catch {
    return { file, data: null, parseError: true };
  }
}

/** Mask secret-looking KV entries; truncate long values. */
function maskKvValue(key, value) {
  if (KV_SECRET_RE.test(key)) return '•••';
  const display = typeof value === 'string' ? value : JSON.stringify(value);
  return display.length > KV_MAX_LEN ? display.slice(0, KV_MAX_LEN - 1) + '…' : display;
}

module.exports = {
  init(ctx) {
    // ── Overview: collections on disk + kv key names ────────────────────────
    ctx.registerRoute('GET', '/api/data-inspector/overview', (req, res) => {
      const names = listCollectionFiles(ctx.dataDir);
      const collections = names.map((name) => {
        const file = path.resolve(ctx.dataDir, name + '.json');
        let stat = null;
        try { stat = fs.statSync(file); } catch { /* file vanished */ }
        const parsed = readCollectionFile(ctx.dataDir, name);
        let count = null;
        if (parsed && parsed.data !== null) {
          count = Array.isArray(parsed.data) ? parsed.data.length : (parsed.data && typeof parsed.data === 'object' ? Object.keys(parsed.data).length : 1);
        }
        return {
          name,
          docs: count,
          sizeBytes: stat ? stat.size : 0,
          modifiedAt: stat ? stat.mtime.toISOString() : null,
        };
      });
      let kvKeys = [];
      try {
        kvKeys = Object.keys(ctx.store.kvAll());
      } catch { /* kv unavailable */ }
      ctx.json(res, 200, { dataDir: ctx.dataDir, collections, kvKeys });
    });

    // ── One collection: paginated docs ───────────────────────────────────────
    ctx.registerRoute('GET', '/api/data-inspector/collections/:name', (req, res, params) => {
      const limit = Math.min(MAX_DOCS, Math.max(1, Number(req.searchParams.get('limit')) || 50));
      const skip = Math.max(0, Number(req.searchParams.get('skip')) || 0);
      const parsed = readCollectionFile(ctx.dataDir, params.name);
      if (!parsed) return ctx.json(res, 404, { error: 'collection not found' });
      if (parsed.parseError) return ctx.json(res, 500, { error: 'collection file is not valid JSON' });
      const all = Array.isArray(parsed.data) ? parsed.data : [];
      ctx.json(res, 200, {
        name: params.name,
        total: all.length,
        docs: all.slice(skip, skip + limit),
        limit,
        skip,
      });
    });

    // ── KV store: full snapshot with masking ─────────────────────────────────
    ctx.registerRoute('GET', '/api/data-inspector/kv', (req, res) => {
      const kv = ctx.store.kvAll();
      const entries = Object.keys(kv)
        .sort()
        .map((key) => ({ key, value: maskKvValue(key, kv[key]) }));
      ctx.json(res, 200, { kv: entries });
    });

    // ── Full-text search across all collections ──────────────────────────────
    ctx.registerRoute('GET', '/api/data-inspector/search', (req, res) => {
      const q = String(req.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) return ctx.json(res, 200, { q, matches: [] });
      const matches = [];
      for (const name of listCollectionFiles(ctx.dataDir)) {
        if (name === 'kv') continue;
        const parsed = readCollectionFile(ctx.dataDir, name);
        if (!parsed || !Array.isArray(parsed.data)) continue;
        for (const doc of parsed.data) {
          if (JSON.stringify(doc).toLowerCase().includes(q)) {
            matches.push({ collection: name, doc });
            if (matches.length >= SEARCH_LIMIT) {
              return ctx.json(res, 200, { q, matches });
            }
          }
        }
      }
      ctx.json(res, 200, { q, matches });
    });
  },
};
