'use strict';

/**
 * First-run demo data: a handful of feed posts, feedback and users so the
 * panel feels alive the moment you open it. Idempotent — runs once.
 */

const crypto = require('crypto');

const id = () => crypto.randomUUID();
const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();

function seed(kernel) {
  if (kernel.store.kvGet('seeded', false)) return false;
  kernel.store.kvSet('seeded', true);
  kernel.store.kvSet('settings', { siteName: kernel.siteName });

  const posts = kernel.store.collection('social-admin.posts');
  posts.replaceAll([
    {
      id: id(), kind: 'update', source: 'core',
      author: { name: 'Open Admin Updates', handle: '@updates', avatar: '📦', color: 'g3', verified: true },
      text: 'New update available for **Users** v2.1.0 — bulk role editing and CSV export. #update',
      tags: ['update'], status: { label: 'core-users', level: 'info' },
      createdAt: ago(42), reactions: { '👍': 6, '🔥': 2 }, comments: [
        { id: id(), author: { name: 'Admin', avatar: '🫡', color: 'g1' }, text: 'Installing after standup.', at: ago(30) },
      ], resolved: false,
    },
    {
      id: id(), kind: 'deploy', source: 'ci',
      author: { name: 'Deploy Bot', handle: '@ci', avatar: '🚀', color: 'g2', verified: true },
      text: 'Deploy **#482** to production finished in 2m 14s. All health checks green. #deploy',
      tags: ['deploy'], status: { label: 'success', level: 'ok' },
      createdAt: ago(95), reactions: { '🚀': 9, '👍': 4 }, comments: [], resolved: false,
    },
    {
      id: id(), kind: 'status', source: 'uptime-monitor',
      author: { name: 'Uptime Bot', handle: '@uptime', avatar: '🟢', color: 'g5', verified: true },
      text: 'Weekly report: **99.98% uptime**, 0 incidents, p95 response 182 ms. #status',
      tags: ['status'], status: { label: 'all systems operational', level: 'ok' },
      createdAt: ago(240), reactions: { '👍': 11 }, comments: [], resolved: false,
    },
    {
      id: id(), kind: 'update', source: 'core',
      author: { name: 'Open Admin Updates', handle: '@updates', avatar: '📦', color: 'g3', verified: true },
      text: 'New update available for **Social Admin** v1.3.0 — polls, story rings, richer feedback filters. #update',
      tags: ['update'], status: { label: 'social-admin', level: 'info' },
      createdAt: ago(300), reactions: { '❤️': 5 }, comments: [], resolved: false,
    },
    {
      id: id(), kind: 'announcement', source: 'admin',
      author: { name: 'Admin', handle: '@admin', avatar: '🫡', color: 'g1', verified: false },
      text: 'Welcome to **Social Admin** 👋 — your dashboard is now a feed. Updates, deploys and visitor feedback land here live. React, comment, and ship. #meta',
      tags: ['meta'], status: null,
      createdAt: ago(600), reactions: { '❤️': 12, '🔥': 7, '👍': 14 }, comments: [
        { id: id(), author: { name: 'Deploy Bot', avatar: '🚀', color: 'g2' }, text: 'Finally, an admin panel that scrolls.', at: ago(590) },
      ], resolved: false,
    },
  ]);

  const feedback = kernel.store.collection('social-admin.feedback');
  feedback.replaceAll([
    {
      id: id(), name: 'Maya', email: 'maya@example.com', type: 'idea',
      message: 'Dark mode for the invoice PDFs? The white flash at night is brutal.',
      upvotes: 42, status: 'planned', comments: [
        { id: id(), author: { name: 'Admin', avatar: '🫡', color: 'g1' }, text: 'On the roadmap for next sprint 👀', at: ago(120) },
      ], createdAt: ago(400),
    },
    {
      id: id(), name: 'Tomás', email: 'tomas@example.com', type: 'bug',
      message: 'Search takes ~3s when I filter by tag. Feels slower than last week.',
      upvotes: 27, status: 'open', comments: [], createdAt: ago(320),
    },
    {
      id: id(), name: 'Priya', email: 'priya@example.com', type: 'idea',
      message: 'Let me export the feedback board as CSV so I can take it to planning.',
      upvotes: 19, status: 'open', comments: [], createdAt: ago(260),
    },
    {
      id: id(), name: 'Jordan', email: '', type: 'praise',
      message: 'The social feed is weirdly delightful for an admin panel. I actually check it now.',
      upvotes: 31, status: 'shipped', comments: [], createdAt: ago(150),
    },
    {
      id: id(), name: 'Sam', email: 'sam@example.com', type: 'idea',
      message: 'Slack webhook when a deploy fails, please 🙏',
      upvotes: 24, status: 'open', comments: [], createdAt: ago(90),
    },
  ]);

  const users = kernel.store.collection('core-users.users');
  users.replaceAll([
    { id: id(), name: 'Ada Lovelace', email: 'ada@mysite.com', role: 'admin', status: 'active', createdAt: ago(50000) },
    { id: id(), name: 'Grace Hopper', email: 'grace@mysite.com', role: 'editor', status: 'active', createdAt: ago(40000) },
    { id: id(), name: 'Alan Turing', email: 'alan@mysite.com', role: 'editor', status: 'active', createdAt: ago(30000) },
    { id: id(), name: 'Katherine Johnson', email: 'kj@mysite.com', role: 'viewer', status: 'active', createdAt: ago(20000) },
    { id: id(), name: 'Margaret Hamilton', email: 'mh@mysite.com', role: 'viewer', status: 'invited', createdAt: ago(8000) },
    { id: id(), name: 'Linus T', email: 'linus@mysite.com', role: 'viewer', status: 'suspended', createdAt: ago(7000) },
  ]);

  // Announce pending updates once, so Social Admin's feed lists them.
  for (const u of kernel.updates.checkAll()) {
    if (u.hasUpdate && !kernel.updates.announced(u.id, u.latest)) {
      kernel.updates.markAnnounced(u.id, u.latest);
    }
  }
  return true;
}

module.exports = seed;
