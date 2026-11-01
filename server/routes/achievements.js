// Achievement routes: the list, the secret one, and the pop-ups waiting to be shown.

/**
 * Registers GET /achievements, POST /achievements/steve, GET /achievements/pending and POST /achievements/seen.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ achievements: object, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes; reading settles the user's achievements.
 */
export function registerAchievementRoutes(api, { achievements, requireUser }) {
  api.get('/achievements', requireUser, (req, res) => {
    achievements.settle(req.user.id); // levels that were earned before achievements were paid, or that a changed definition now reaches
    res.json(achievements.forUser(req.user.id));
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
