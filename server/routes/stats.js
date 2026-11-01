// Statistics routes: your own numbers and a game's leaderboard.

/**
 * Registers GET /stats/me and GET /stats/leaderboard/:game.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ stats: object, listGames: () => Array<{ id: string }>, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes.
 */
export function registerStatsRoutes(api, { stats, listGames, requireUser }) {
  api.get('/stats/me', requireUser, (req, res) => res.json(stats.forUser(req.user.id)));
  api.get('/stats/leaderboard/:game', requireUser, (req, res) => {
    if (!listGames().some((g) => g.id === req.params.game)) return res.status(404).json({ error: 'No such game.' });
    res.json({ leaderboard: stats.leaderboard(req.params.game) });
  });
}
