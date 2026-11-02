// Statistics routes: your own numbers and a game's leaderboard.

/**
 * Registers GET /stats/me and GET /stats/leaderboard/:game.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ stats: object, presence: object, listGames: () => Array<{ id: string }>, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes.
 */
export function registerStatsRoutes(api, { stats, presence, listGames, requireUser }) {
  // The summary's `onlineSeconds` is time on the site, which the game results know nothing about (server/presence.js).
  api.get('/stats/me', requireUser, (req, res) => {
    const mine = stats.forUser(req.user.id);
    res.json({ ...mine, summary: { ...mine.summary, onlineSeconds: presence?.seconds(req.user.id) ?? 0 } });
  });
  api.get('/stats/leaderboard/:game', requireUser, (req, res) => {
    if (!listGames().some((g) => g.id === req.params.game)) return res.status(404).json({ error: 'noSuchGame' });
    res.json({ leaderboard: stats.leaderboard(req.params.game) });
  });
}
