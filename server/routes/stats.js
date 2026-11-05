// Statistics routes: your own numbers, somebody else's, a game's leaderboard, and the leaderboard page's standings.
import { TOP_PLAYERS } from '../stats.js';
import { asSubject, personNamed } from './people.js';

/**
 * Registers GET /stats/me, GET /stats/user/:who, GET /stats/leaderboard/:game and GET /leaderboard.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ stats: object, presence: object, auth: object, listGames: () => Array<{ id: string }>, requireUser: import('express').RequestHandler }} deps
 * @returns {void}
 * Side effects: adds routes.
 */
export function registerStatsRoutes(api, { stats, presence, auth, listGames, requireUser }) {
  // The summary's `onlineSeconds` is time on the site, which the game results know nothing about (server/presence.js).
  api.get('/stats/me', requireUser, (req, res) => {
    const mine = stats.forUser(req.user.id);
    res.json({ ...mine, summary: { ...mine.summary, onlineSeconds: presence?.seconds(req.user.id) ?? 0 } });
  });
  // Somebody else's numbers, which are the same numbers: a game's results are public on the leaderboards already.
  // Their time on the site is not among them, being about them rather than about their games.
  api.get('/stats/user/:who', requireUser, (req, res) => {
    const person = personNamed(auth, req.params.who);
    if (!person) return res.status(404).json({ error: 'noSuchPlayer' });
    res.json({ who: asSubject(person), ...stats.forUser(person.id) });
  });
  api.get('/stats/leaderboard/:game', requireUser, (req, res) => {
    if (!listGames().some((g) => g.id === req.params.game)) return res.status(404).json({ error: 'noSuchGame' });
    res.json({ leaderboard: stats.leaderboard(req.params.game) });
  });
  // The leaderboard page: every game anybody has finished, with the rows that page needs to sort itself (server/stats.js).
  // A game nobody has played at all is left out rather than given an empty table.
  api.get('/leaderboard', requireUser, (req, res) => {
    const games = listGames()
      .map((game) => ({ game: game.id, name: game.name, players: stats.standings(game.id, { viewerId: req.user.id }) }))
      .filter((game) => game.players.length);
    res.json({ top: TOP_PLAYERS, games });
  });
}
