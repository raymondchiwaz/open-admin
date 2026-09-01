'use strict';

/** Users plugin (server side): CRUD over a JSON collection. */

module.exports = {
  init(ctx) {
    const users = ctx.store.collection('users');

    ctx.registerRoute('GET', '/api/users', (req, res) => {
      const q = (req.searchParams.get('q') || '').toLowerCase();
      const all = users.all();
      ctx.json(res, 200, {
        users: all
          .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name)),
        stats: {
          total: all.length,
          active: all.filter((u) => u.status === 'active').length,
          invited: all.filter((u) => u.status === 'invited').length,
        },
      });
    });

    ctx.registerRoute('POST', '/api/users', async (req, res) => {
      const body = await ctx.readBody(req);
      if (!body.name || !body.email) return ctx.json(res, 400, { error: 'name and email are required' });
      const user = users.insert({
        name: String(body.name).slice(0, 80),
        email: String(body.email).slice(0, 120),
        role: ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer',
        status: 'active',
      });
      ctx.activity({ text: `**${user.name}** joined the team as ${user.role}`, icon: '🎉', level: 'info' });
      ctx.json(res, 201, user);
    });

    ctx.registerRoute('PATCH', '/api/users/:id', async (req, res, params) => {
      const body = await ctx.readBody(req);
      const patch = {};
      if (body.role) patch.role = body.role;
      if (body.status) patch.status = body.status;
      const user = users.update(params.id, patch);
      if (!user) return ctx.json(res, 404, { error: 'user not found' });
      ctx.json(res, 200, user);
    });

    ctx.registerRoute('DELETE', '/api/users/:id', (req, res, params) => {
      const removed = users.remove(params.id);
      ctx.json(res, removed ? 200 : 404, { ok: removed });
    });
  },
};
