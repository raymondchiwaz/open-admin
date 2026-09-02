'use strict';

/**
 * Polls — one-vote-per-browser team polls.
 *
 *   GET    /api/polls                 all polls (open first, then newest)
 *   POST   /api/polls                 { question, options: [string] (2-6) }
 *   POST   /api/polls/:id/vote        { optionId, voterId }  (409 on repeat vote)
 *   POST   /api/polls/:id/close       close a poll (activity with the winner)
 *
 * Every mutation notifies `polls.changed` (with the fresh list); the Social
 * feed hears about new and closed polls via `activity`.
 */

const crypto = require('crypto');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function seed(polls) {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600000).toISOString();
  polls.replaceAll([
    {
      id: crypto.randomUUID(),
      question: 'What should we build next?',
      open: true,
      createdAt: ago(6),
      voted: ['v-ana', 'v-bob', 'v-ced', 'v-dee'],
      options: [
        { id: crypto.randomUUID(), label: 'CSV exports everywhere', votes: 4 },
        { id: crypto.randomUUID(), label: 'Slack integration', votes: 0 },
        { id: crypto.randomUUID(), label: 'Dark PDF invoices', votes: 0 },
      ],
    },
    {
      id: crypto.randomUUID(),
      question: 'Which day works for the offsite?',
      open: false,
      createdAt: ago(160),
      closedAt: ago(100),
      voted: ['v-ana', 'v-eli', 'v-fran', 'v-gus', 'v-hal', 'v-ida'],
      options: [
        { id: crypto.randomUUID(), label: 'Thursday', votes: 4 },
        { id: crypto.randomUUID(), label: 'Friday', votes: 2 },
      ],
    },
  ]);
}

/** Winner label(s) — ties resolve to several names joined with " + ". */
function winner(poll) {
  const top = Math.max(0, ...poll.options.map((o) => o.votes || 0));
  const leaders = poll.options.filter((o) => (o.votes || 0) === top).map((o) => o.label);
  return leaders.length ? leaders.join(' + ') : 'nobody';
}

module.exports = {
  init(ctx) {
    const polls = ctx.store.collection('polls');

    if (!ctx.store.getState('seeded')) {
      seed(polls);
      ctx.store.setState('seeded', true);
    }

    /** Open polls first, then newest first. */
    function list() {
      return [...polls.all()].sort((a, b) =>
        (b.open ? 1 : 0) - (a.open ? 1 : 0)
        || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    function notifyChanged() {
      ctx.notify('polls.changed', { polls: list() });
    }

    ctx.registerRoute('GET', '/api/polls', (req, res) => {
      ctx.json(res, 200, { polls: list() });
    });

    ctx.registerRoute('POST', '/api/polls', async (req, res) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const question = String(body.question || '').trim().slice(0, 200);
      if (!question) return ctx.json(res, 400, { error: 'question is required' });
      const rawOptions = Array.isArray(body.options) ? body.options : [];
      const optionLabels = rawOptions
        .map((o) => String(o || '').trim().slice(0, 120))
        .filter(Boolean);
      if (optionLabels.length < MIN_OPTIONS || optionLabels.length > MAX_OPTIONS) {
        return ctx.json(res, 400, { error: `provide ${MIN_OPTIONS}-${MAX_OPTIONS} options` });
      }
      const poll = polls.insert({
        question,
        open: true,
        voted: [],
        options: optionLabels.map((label) => ({ id: crypto.randomUUID(), label, votes: 0 })),
      });
      ctx.activity({ text: `🗳️ New poll: **${poll.question}**`, icon: '🗳️', level: 'info', tags: ['polls'] });
      notifyChanged();
      ctx.json(res, 201, poll);
    });

    ctx.registerRoute('POST', '/api/polls/:id/vote', async (req, res, params) => {
      const body = await ctx.readBody(req).catch(() => ({}));
      const poll = polls.get(params.id);
      if (!poll) return ctx.json(res, 404, { error: 'poll not found' });
      const voterId = String(body.voterId || '').trim().slice(0, 80);
      if (!voterId) return ctx.json(res, 400, { error: 'voterId is required' });
      if (!poll.open) return ctx.json(res, 409, { error: 'poll is closed' });
      if (poll.voted.includes(voterId)) return ctx.json(res, 409, { error: 'already voted' });
      const option = poll.options.find((o) => o.id === body.optionId);
      if (!option) return ctx.json(res, 400, { error: 'unknown option' });

      option.votes = (option.votes || 0) + 1;
      poll.voted.push(voterId);
      polls.update(poll.id, { voted: poll.voted, options: poll.options });
      notifyChanged();
      ctx.json(res, 200, { ok: true, poll });
    });

    ctx.registerRoute('POST', '/api/polls/:id/close', (req, res, params) => {
      const poll = polls.get(params.id);
      if (!poll) return ctx.json(res, 404, { error: 'poll not found' });
      if (!poll.open) return ctx.json(res, 409, { error: 'poll is already closed' });
      poll.open = false;
      poll.closedAt = new Date().toISOString();
      polls.update(poll.id, { open: false, closedAt: poll.closedAt });
      ctx.activity({
        text: `🗳️ Poll closed: **${poll.question}** — winner: ${winner(poll)}`,
        icon: '🗳️',
        level: 'info',
        tags: ['polls'],
      });
      notifyChanged();
      ctx.json(res, 200, poll);
    });
  },
};
