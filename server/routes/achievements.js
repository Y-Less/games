// Achievement routes: the list, somebody else's list, the secret one, and the pop-ups waiting to be shown.
import { asSubject, personNamed } from './people.js';

/**
 * Registers GET /achievements, GET /achievements/user/:who, POST /achievements/steve, GET /achievements/pending, and
 * POST /achievements/seen.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ achievements: object, auth: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; reading your own settles them.
 */
export function registerAchievementRoutes(api, { achievements, auth, requireUser }) {
  api.get('/achievements', requireUser, (req, res) => {
    achievements.settle(req.user.id); // levels that were earned before achievements were paid, or that a changed definition now reaches
    res.json(achievements.forUser(req.user.id));
  });
  // Somebody else's list.  It is read rather than settled: settling pays out what an account is owed, and looking at
  // a player's page should not reach into their purse.  Anything they are owed is paid the next time they look.
  api.get('/achievements/user/:who', requireUser, (req, res) => {
    const person = personNamed(auth, req.params.who);
    if (!person) return res.status(404).json({ error: 'noSuchPlayer' });
    res.json({ who: asSubject(person), ...achievements.forUser(person.id) });
  });
  api.post('/achievements/steve', requireUser, (req, res) => {
    achievements.raise('site', req.user.id, 'global.steve', 1); // a secret: the browser console prints how to ask for it
    res.json({ ok: true });
  });
  api.get('/achievements/pending', requireUser, (req, res) => {
    achievements.settle(req.user.id);
    res.json({ unlocks: achievements.pending(req.user.id) });
  });
  api.post('/achievements/seen', requireUser, (req, res) => {
    achievements.seen(req.user.id, req.body?.items);
    res.json({ ok: true });
  });
}
