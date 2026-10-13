'use strict';

/**
 * Open Admin — public API.
 *
 *   const { mount } = require('open-admin');
 *   app.use('/admin', mount({ dataDir: '.open-admin-data' }));   // Express/Connect
 *
 * or standalone:  npx open-admin --port 4170
 */

const { OpenAdminKernel } = require('./core/kernel');
const pipeline = require('./integrations/pipeline');
const nextBridge = require('./integrations/next-bridge');

async function createOpenAdmin(options = {}) {
  const kernel = new OpenAdminKernel(options);
  await kernel.init();
  return kernel;
}

/**
 * Middleware for Express / Connect / Koa (via koa-connect) / native http.
 * Returns an async (req, res) handler that lazily boots the kernel on first
 * request, so it can be passed straight to app.use().
 */
function mount(options = {}) {
  const kernelPromise = createOpenAdmin(options);
  let kernel = null;
  return async function openAdminHandler(req, res) {
    if (!kernel) kernel = await kernelPromise;
    await kernel.handler(req, res);
  };
}

module.exports = { createOpenAdmin, mount, OpenAdminKernel, pipeline, nextBridge };
