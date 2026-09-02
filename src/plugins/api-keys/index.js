'use strict';

/**
 * API Keys — issue, list, revoke and verify bearer-token API keys.
 *
 * Security model:
 *   - The plaintext token is generated server-side and returned EXACTLY ONCE
 *     from POST /api/api-keys. Only a SHA-256 hash is persisted.
 *   - List/verify responses never include the hash or the plaintext.
 *   - verify() is exposed as the `api-keys.verify` capability so other
 *     plugins can authenticate third-party callers without knowing the store.
 */

const crypto = require('crypto');

/** Public shape of a key record — everything safe to ship to the browser. */
function publicRecord(key) {
  return {
    id: key.id,
    label: key.label,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt || null,
    revoked: !!key.revoked,
  };
}

/** Constant-time-ish string comparison (SHA-256 digests are 64 hex chars). */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  init(ctx) {
    const keys = ctx.store.collection('keys');

    /** Verify a raw API key. Used by this plugin's own routes and offered to
     *  other plugins as the `api-keys.verify` capability. */
    function verify(rawKey) {
      if (typeof rawKey !== 'string' || !rawKey) return { ok: false, reason: 'missing key' };
      const hash = crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
      const match = keys.find((k) => k.hash && safeEqual(k.hash, hash))[0];
      if (!match) return { ok: false, reason: 'unknown key' };
      if (match.revoked) return { ok: false, reason: 'revoked' };
      const now = new Date().toISOString();
      keys.update(match.id, { lastUsedAt: now });
      return { ok: true, id: match.id, label: match.label, prefix: match.prefix };
    }

    ctx.capabilities.provide('api-keys.verify', (raw) => verify(raw), ctx.pluginId);

    // ── Routes ──────────────────────────────────────────────────────────────

    ctx.registerRoute('GET', '/api/api-keys', (req, res) => {
      const records = keys.all().map(publicRecord);
      ctx.json(res, 200, { keys: records });
    });

    ctx.registerRoute('POST', '/api/api-keys', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const label = String(body.label || '').trim().slice(0, 80);
      if (!label) return ctx.json(res, 400, { error: 'label is required' });

      // base64url: 24 random bytes -> 32 URL-safe characters (no padding).
      const plaintext = crypto.randomBytes(24).toString('base64url');
      const record = keys.insert({
        label,
        prefix: plaintext.slice(0, 8),
        hash: crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex'),
        lastUsedAt: null,
        revoked: false,
      });

      ctx.activity({ text: `🔑 API key **${label}** was issued`, icon: '🔑', level: 'info', tags: ['api-keys'] });
      // Plaintext is included HERE ONLY — never logged, never re-served.
      ctx.json(res, 201, { key: plaintext, record: publicRecord(record) });
    });

    ctx.registerRoute('POST', '/api/api-keys/:id/revoke', (req, res, params) => {
      const key = keys.get(params.id);
      if (!key) return ctx.json(res, 404, { error: 'key not found' });
      if (key.revoked) return ctx.json(res, 200, { ok: true, record: publicRecord(key) });
      const updated = keys.update(key.id, { revoked: true });
      ctx.activity({ text: `🔒 API key **${key.label}** was revoked`, icon: '🔒', level: 'info', tags: ['api-keys'] });
      ctx.json(res, 200, { ok: true, record: publicRecord(updated) });
    });

    ctx.registerRoute('DELETE', '/api/api-keys/:id', (req, res, params) => {
      const removed = keys.remove(params.id);
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });
  },
};
