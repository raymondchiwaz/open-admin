'use strict';

/**
 * Demo: Open Admin added to an existing site as a plugin.
 *
 *   node examples/demo-site.js
 *   → site:   http://localhost:4200
 *   → admin:  http://localhost:4200/admin/
 *
 * The admin is mounted with a single handler (works with Express, Connect,
 * Koa-convert or plain http, as here). The site's pages load Open Admin's
 * drop-in feedback widget, so visitor feedback shows up in Social Admin live.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { mount } = require('../src/index');

const PORT = 4200;

async function main() {
  const admin = await mount({
    dataDir: path.join(__dirname, '..', '.open-admin-data'),
    siteName: 'Northwind Goods',
    basePath: '/admin',
  });

  const siteHtml = fs.readFileSync(path.join(__dirname, 'site', 'index.html'));

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/' || req.url.startsWith('/?#')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(siteHtml);
        return;
      }
      if (req.url.startsWith('/admin')) {
        await admin(req, res);   // ← Open Admin, added as a plugin
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      console.error('[demo-site] error:', err);
      res.writeHead(500);
      res.end('internal error');
    }
  });

  server.listen(PORT, () => {
    console.log(`
  Demo running:
    Site  →  http://localhost:${PORT}
    Admin →  http://localhost:${PORT}/admin/
`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
