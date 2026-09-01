#!/usr/bin/env node
'use strict';

/**
 * open-admin CLI
 *
 *   open-admin                       start the admin on http://localhost:4170
 *   open-admin --port 8080           pick a port
 *   open-admin --plugins ./plugins   load extra plugins from a directory
 *   open-admin --data-dir ./data     where state is stored
 */

const path = require('path');
const { createOpenAdmin } = require('../src/index');

const args = process.argv.slice(2);

function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) return args[i + 1];
  return fallback;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  Open Admin — the open-source, plugin-first admin panel.

  Usage
    open-admin [options]

  Options
    --port <n>         HTTP port                     (default 4170)
    --host <addr>      bind address                  (default 127.0.0.1)
    --data-dir <path>  where JSON state is stored    (default .open-admin-data)
    --site-name <str>  name shown in the UI
    --plugins <path>   extra plugin directory (repeatable)
    --version          print version
    --help             this help
`);
  process.exit(0);
}

if (args.includes('--version')) {
  console.log(require('../package.json').version);
  process.exit(0);
}

const pluginDirs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plugins') pluginDirs.push(path.resolve(args[i + 1]));
}

const port = Number(arg('--port', 4170));
const host = arg('--host', '127.0.0.1');

createOpenAdmin({
  port,
  host,
  dataDir: path.resolve(arg('--data-dir', path.join(process.cwd(), '.open-admin-data'))),
  siteName: arg('--site-name', 'My Site'),
  plugins: pluginDirs,
})
  .then(async (kernel) => {
    await kernel.listen(port, host);
    // First-run demo data (posts, feedback, users) so the panel is alive.
    require('../src/core/seed')(kernel);
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`
  ╭──────────────────────────────────────────────────╮
  │  Open Admin is running                           │
  │                                                  │
  │  Admin panel:  ${url.padEnd(32)}│
  │  API:          ${(url + '/api/bootstrap').padEnd(32)}│
  │  Data dir:     ${(kernel.options.dataDir + '/').padEnd(32)}│
  ╰──────────────────────────────────────────────────╯
`);
  })
  .catch((err) => {
    console.error('[open-admin] failed to start:', err);
    process.exit(1);
  });
