// Game statistics.  Modules report finished games with record(); the site turns them into profile stats and leaderboards.
// Depends on: ./db.js (transaction) and the users, results, and result_players tables.
import { transaction } from './db.js';

const OUTCOMES = ['win', 'loss', 'draw']; // the only results a player can be recorded with (matches the table's CHECK) // the only results a player can be recorded with (matches the table's CHECK)

/**
 * Makes the statistics service over a database.
 * @param {import('node:sqlite').DatabaseSync} db  the site database
 * @param {() => Array<{ id: string, name: string, stats?: Array<{ key: string, label: string, agg?: 'sum' | 'max', hidden?: boolean }> }>} listGames  the loaded games (their names and extra-stat definitions)
 * @param {{ onPlayerRecorded?: (resultId: number, player: object, info: { isBot: boolean }) => void, onRecorded?: (userIds: number[]) => void }} [options]
 *   onPlayerRecorded is called inside the recording transaction, once for each player, with the new result id, the player as
 *   reported and whether the account is a computer player (the site pays coins from it; a throw rolls the whole game back).
 *   onRecorded is called after a game is recorded, with the players in it (the site works out their achievements then).
 * @returns {{ record: Function, forUser: Function, leaderboard: Function }}
 * Side effects: none until a method is called.
 */
export function createStats(db, listGames, { onPlayerRecorded, onRecorded } = {}) {
  const knownUser = db.prepare('SELECT 1 FROM users WHERE id = ?');
  const isBot = db.prepare('SELECT is_bot FROM users WHERE id = ?');

  /**
   * Records one finished game.
   * @returns {number | null} the new result id, or null when no known player was in it
   * Side effects: writes the result, its players, and any coin awards in one transaction, then calls `onRecorded`.
   * An account listed more than once is counted once (the first entry); unknown accounts are ignored.
   * @param {string} game module id
   * @param {{ code?: string, players: Array<{ userId: number, outcome: 'win'|'loss'|'draw', placement?: number, score?: number, extras?: Record<string, number> }> }} result
   */
  function record(game, result) {
    const seen = new Set(); // the same account listed twice counts once (the first entry wins)
    const players = (result?.players ?? []).filter((p) => {
      if (!Number.isInteger(p?.userId) || seen.has(p.userId) || !knownUser.get(p.userId)) return false;
      seen.add(p.userId);
      return true;
    });
    if (!players.length) return null;
    for (const p of players) if (!OUTCOMES.includes(p.outcome)) throw new Error(`Unknown outcome "${p.outcome}"`);
    const resultId = transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO results (game, code, finished_at) VALUES (?, ?, ?)')
        .run(game, result.code ?? null, Date.now());
      const insert = db.prepare('INSERT INTO result_players (result_id, user_id, placement, score, outcome, extras) VALUES (?, ?, ?, ?, ?, ?)');
      for (const p of players) {
        onPlayerRecorded?.(Number(lastInsertRowid), p, { isBot: Boolean(isBot.get(p.userId).is_bot) });
        insert.run(
          lastInsertRowid,
          p.userId,
          Number.isFinite(p.placement) ? p.placement : null,
          Number.isFinite(p.score) ? p.score : null,
          p.outcome,
          JSON.stringify(cleanExtras(p.extras)),
        );
      }
      return Number(lastInsertRowid);
    });
    // The game is saved by now: whatever the site does with it next must not make recording it look like a failure.
    try {
      onRecorded?.(players.map((p) => p.userId));
    } catch (error) {
      console.error('After recording a result:', error);
    }
    return resultId;
  }

  /**
   * Keeps only the numeric extras a player reported.
   * @param {Record<string, *> | undefined} extras
   * @returns {Record<string, number>}
   * Side effects: none.
   */
  function cleanExtras(extras) {
    const out = {};
    for (const [key, value] of Object.entries(extras ?? {})) if (Number.isFinite(value)) out[key] = value;
    return out;
  }

  /**
   * Everything the profile page shows for one user.
   * @param {number} userId
   * @returns {{ summary: object, perGame: object[], recent: object[] }}
   * Side effects: none.
   */
  function forUser(userId) {
    const totals = db
      .prepare(
        `SELECT r.game AS game, COUNT(*) AS played,
                SUM(rp.outcome = 'win') AS wins, SUM(rp.outcome = 'loss') AS losses, SUM(rp.outcome = 'draw') AS draws,
                SUM(rp.score) AS totalScore, MAX(rp.score) AS bestScore
         FROM result_players rp JOIN results r ON r.id = rp.result_id
         WHERE rp.user_id = ? GROUP BY r.game`,
      )
      .all(userId);
    const extraRows = db.prepare('SELECT r.game AS game, rp.extras AS extras FROM result_players rp JOIN results r ON r.id = rp.result_id WHERE rp.user_id = ?').all(userId);

    const games = listGames();
    const perGame = totals.map((row) => {
      const module = games.find((g) => g.id === row.game);
      const extras = [];
      for (const def of module?.stats ?? []) {
        let value = 0;
        for (const e of extraRows) {
          if (e.game !== row.game) continue;
          const n = JSON.parse(e.extras)[def.key];
          if (!Number.isFinite(n)) continue;
          value = def.agg === 'max' ? Math.max(value, n) : value + n;
        }
        extras.push({ key: def.key, label: def.label, value, ...(def.hidden === true ? { hidden: true } : {}) });
      }
      return {
        game: row.game,
        name: module?.name ?? row.game,
        played: row.played,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        winRate: row.played ? row.wins / row.played : 0,
        totalScore: row.totalScore,
        bestScore: row.bestScore,
        extras,
      };
    });

    const summary = perGame.reduce(
      (all, g) => ({ played: all.played + g.played, wins: all.wins + g.wins, losses: all.losses + g.losses, draws: all.draws + g.draws }),
      { played: 0, wins: 0, losses: 0, draws: 0 },
    );
    const recent = db
      .prepare(
        `SELECT r.game AS game, r.finished_at AS finishedAt, rp.outcome AS outcome, rp.score AS score, rp.placement AS placement,
                (SELECT COUNT(*) FROM result_players x WHERE x.result_id = r.id) AS players
         FROM result_players rp JOIN results r ON r.id = rp.result_id
         WHERE rp.user_id = ? ORDER BY r.finished_at DESC, r.id DESC LIMIT 15`,
      )
      .all(userId)
      .map((row) => ({ ...row, name: games.find((g) => g.id === row.game)?.name ?? row.game }));
    return { summary: { ...summary, winRate: summary.played ? summary.wins / summary.played : 0 }, perGame, recent };
  }

  /**
   * Top players for one game by wins (then win rate), skipping bots unless asked.
   * @param {string} game  module id
   * @param {{ limit?: number, includeBots?: boolean }} [options]
   * @returns {Array<{ userId: number, name: string, played: number, wins: number }>}
   * Side effects: none.
   */
  function leaderboard(game, { limit = 10, includeBots = false } = {}) {
    return db
      .prepare(
        `SELECT u.id AS userId, u.display_name AS name, COUNT(*) AS played, SUM(rp.outcome = 'win') AS wins
         FROM result_players rp JOIN results r ON r.id = rp.result_id JOIN users u ON u.id = rp.user_id
         WHERE r.game = ? AND (? OR u.is_bot = 0)
         GROUP BY u.id ORDER BY wins DESC, CAST(wins AS REAL) / COUNT(*) DESC, played DESC LIMIT ?`,
      )
      .all(game, includeBots ? 1 : 0, limit);
  }

  return { record, forUser, leaderboard };
}
