'use strict';

/**
 * System Info — read-only introspection of the running kernel. Uses only Node
 * built-ins (fs, os, path) and powers a self-refreshing status page plus a
 * dashboard card.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function memMB(bytes) { return Math.round(bytes / 1048576); }

module.exports = {
  init(ctx) {
    ctx.registerRoute('GET', '/api/system-info', (req, res) => {
      const dataDir = ctx.dataDir;
      const collections = ctx.store.collections().map((name) => {
        const file = path.join(dataDir, name + '.json');
        let sizeBytes = 0;
        let docs = 0;
        try {
          sizeBytes = fs.statSync(file).size;
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          docs = Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          // collection never written to disk yet (or mid-debounce)
        }
        return { name, sizeBytes, docs };
      });

      ctx.json(res, 200, {
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemMB: memMB(os.totalmem()),
        freeMemMB: memMB(os.freemem()),
        uptimeSec: process.uptime(),
        dataDir,
        collections,
        kvKeys: Object.keys(ctx.store.kvAll()).length,
      });
    });
  },
};
