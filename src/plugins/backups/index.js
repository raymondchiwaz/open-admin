'use strict';

/**
 * Backups — snapshot the kernel's data directory (JSON stores + plugin data).
 *
 * A backup is a folder `<dataDir>/backups/<backup-YYYYMMDD-HHmmss>/` holding a
 * copy of every entry inside the data dir *except* the backups folder itself
 * (no recursive self-copy). Metadata (name, sizeBytes, createdAt) lives in a
 * collection; folder names are sanitized to /^[0-9a-zA-Z-]+$/ so deletes can
 * never escape the backups dir.
 *
 * Auto-backup: kv toggle `autoBackup`; when on, a ctx.every(6h) timer creates
 * backups. Toggle-off clears the handle. All timers are revoked by the kernel
 * on disable too.
 *
 * Capability: `backups.create` → creates a backup and returns its metadata
 * Event:      `backups.changed`
 */

const fs = require('fs');
const path = require('path');

const AUTO_INTERVAL_MS = 21600000; // 6 hours
const NAME_RE = /^[0-9a-zA-Z-]+$/;

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Backups are created in the same data dir the collection lives in, so they
 *  are never in-flight while the store's debounced writer runs. */
module.exports = {
  init(ctx) {
    const backupsDir = path.join(ctx.dataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const meta = ctx.store.collection('meta');
    let autoHandle = null;

    function stamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    /** Recursive byte count for a directory. */
    function dirSize(dir) {
      let total = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) total += dirSize(p);
        else if (entry.isFile()) total += fs.statSync(p).size;
      }
      return total;
    }

    function create() {
      const base = 'backup-' + stamp();
      let name = base;
      for (let i = 2; fs.existsSync(path.join(backupsDir, name)); i++) name = base + '-' + i;
      const dest = path.join(backupsDir, name);
      fs.mkdirSync(dest, { recursive: true });

      // Copy every entry of the data dir EXCEPT the backups dir itself.
      for (const entry of fs.readdirSync(ctx.dataDir, { withFileTypes: true })) {
        if (entry.name === 'backups') continue;
        fs.cpSync(path.join(ctx.dataDir, entry.name), path.join(dest, entry.name), { recursive: true });
      }

      const record = meta.insert({
        name,
        sizeBytes: dirSize(dest),
        createdAt: new Date().toISOString(),
      });
      ctx.notify('backups.changed', { backup: record });
      ctx.activity({
        text: `💾 Backup created (**${name}**, ${humanSize(record.sizeBytes)})`,
        icon: '💾', level: 'info', source: ctx.pluginId, tags: ['backup'],
      });
      return record;
    }

    /** Reconcile the auto-backup timer with the stored toggle. */
    function syncAuto() {
      const on = !!ctx.store.getState('autoBackup', false);
      if (on && !autoHandle) {
        autoHandle = ctx.every(AUTO_INTERVAL_MS, () => {
          try { create(); } catch (err) { ctx.log('auto-backup failed:', err.message); }
        });
        ctx.log('auto-backup scheduled every 6h');
      } else if (!on && autoHandle) {
        clearInterval(autoHandle);
        autoHandle = null;
      }
    }

    syncAuto();

    /* ── Capability ─────────────────────────────────────────────────────── */

    ctx.capabilities.provide('backups.create', () => create(), ctx.pluginId);

    /* ── Routes ─────────────────────────────────────────────────────────── */

    ctx.registerRoute('GET', '/api/backups', (req, res) => {
      ctx.json(res, 200, {
        backups: [...meta.all()].sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt))),
        auto: !!ctx.store.getState('autoBackup', false),
        dataDir: ctx.dataDir,
      });
    });

    ctx.registerRoute('POST', '/api/backups', async (req, res) => {
      try {
        const record = create();
        ctx.json(res, 201, record);
      } catch (err) {
        ctx.json(res, 500, { error: `backup failed: ${err.message}` });
      }
    });

    ctx.registerRoute('POST', '/api/backups/auto', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      if (typeof body.enabled !== 'boolean') {
        return ctx.json(res, 400, { error: 'enabled must be a boolean' });
      }
      ctx.store.setState('autoBackup', body.enabled);
      syncAuto();
      ctx.notify('backups.changed', { auto: body.enabled });
      ctx.json(res, 200, { auto: body.enabled });
    });

    ctx.registerRoute('DELETE', '/api/backups/:name', (req, res, params) => {
      const { name } = params;
      if (!NAME_RE.test(name)) {
        return ctx.json(res, 400, { error: 'invalid backup name' });
      }
      const record = meta.find((m) => m.name === name)[0];
      const dir = path.join(backupsDir, name);
      // Only ever remove paths *inside* the backups dir.
      const resolved = path.resolve(dir);
      if (!resolved.startsWith(path.resolve(backupsDir) + path.sep)) {
        return ctx.json(res, 400, { error: 'invalid backup path' });
      }
      try {
        fs.rmSync(resolved, { recursive: true, force: true });
      } catch (err) {
        return ctx.json(res, 500, { error: `failed to remove backup: ${err.message}` });
      }
      if (record) meta.remove(record.id);
      ctx.notify('backups.changed', { deleted: name });
      ctx.json(res, 200, { ok: true });
    });
  },
};
