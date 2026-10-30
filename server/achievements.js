// Achievements (see shared/achievements.js). A player's value for each one is either worked out from their recorded results
// (an achievement with a `stat`) or is progress a game saves with add() / raise(). This file keeps the saved progress and
// builds what the Achievements page shows.
import { BUILTIN_STATS, describe, GLOBAL_ACHIEVEMENTS, levelInfo } from '../shared/achievements.js';

const GLOBAL = 'global';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ listGames: () => Array<{ id: string, name: string, achievements?: object[] }>, statsFor: (userId: number) => object }} options
 *   statsFor is stats.forUser: the results the stat-based achievements are worked out from.
 */
export function createAchievements(db, { listGames, statsFor }) {
  const read = db.prepare('SELECT value FROM achievement_progress WHERE user_id = ? AND id = ?');
  const readAll = db.prepare('SELECT id, value FROM achievement_progress WHERE user_id = ?');
  const write = db.prepare(
    `INSERT INTO achievement_progress (user_id, id, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const isBot = db.prepare('SELECT is_bot FROM users WHERE id = ?');

  /** Every definition with its full id ("hearts.moon", "global.cards") and the section it is shown in. */
  function sections() {
    return [
      { id: GLOBAL, name: 'Global', definitions: GLOBAL_ACHIEVEMENTS },
      ...listGames()
        .filter((g) => g.achievements?.length)
        .map((g) => ({ id: g.id, name: g.name, definitions: g.achievements })),
    ];
  }
  function find(id) {
    for (const section of sections()) {
      for (const definition of section.definitions) if (`${section.id}.${definition.key}` === id) return definition;
    }
    return null;
  }

  const savedValue = (userId, id) => read.get(userId, id)?.value ?? 0;

  /** The full id for a key: a bare key belongs to `game`, "global.cards" is the site's. */
  function resolve(game, key) {
    const id = key.startsWith(`${GLOBAL}.`) ? key : `${game}.${key}`;
    const definition = find(id);
    if (!definition) throw new Error(`Unknown achievement "${key}"`);
    if (definition.stat) throw new Error(`"${key}" is worked out from the recorded results, so it cannot be set`);
    return { id, definition };
  }

  function change(game, userId, key, fn) {
    const { id, definition } = resolve(game, key);
    if (!Number.isInteger(userId) || isBot.get(userId)?.is_bot !== 0) return null; // computer players do not collect achievements
    const before = savedValue(userId, id);
    const after = fn(before);
    if (!Number.isFinite(after) || after === before) return { before, after: before, level: levelInfo(definition.levels, before).level, unlocked: false };
    write.run(userId, id, after, Date.now());
    const was = levelInfo(definition.levels, before).level;
    const level = levelInfo(definition.levels, after).level;
    return { before, after, level, unlocked: level > was };
  }

  /** Adds to a saved achievement (1 by default). Returns { before, after, level, unlocked } or null for a computer player. */
  const add = (game, userId, key, amount = 1) => change(game, userId, key, (value) => (Number.isFinite(amount) && amount > 0 ? value + amount : value));
  /** Raises a saved achievement to `value` if that is more than it is now (for "best ever" numbers). */
  const raise = (game, userId, key, value) => change(game, userId, key, (current) => (Number.isFinite(value) ? Math.max(current, value) : current));

  /** The numbers the stat-based achievements are worked out from, for one player. */
  function statValues(userId) {
    const { summary, perGame } = statsFor(userId);
    const global = { played: summary.played, wins: summary.wins, losses: summary.losses, draws: summary.draws };
    const games = new Map(perGame.map((g) => [g.game, { played: g.played, wins: g.wins, losses: g.losses, draws: g.draws, totalScore: g.totalScore ?? 0, bestScore: g.bestScore ?? 0, ...Object.fromEntries(g.extras.map((e) => [e.key, e.value])) }]));
    return { global, games };
  }

  /** The current value of one achievement ("hearts.moon", or "global.cards"), for a game that wants to look. */
  function get(userId, id) {
    const definition = find(id);
    if (!definition) return 0;
    if (!definition.stat) return savedValue(userId, id);
    const { global, games } = statValues(userId);
    const [section] = id.split('.');
    return (section === GLOBAL ? global : games.get(section) ?? {})[definition.stat] ?? 0;
  }

  /** Everything the Achievements page shows: sections (the global ones, then each game that has any) of described achievements. */
  function forUser(userId) {
    const { global, games } = statValues(userId);
    const saved = new Map(readAll.all(userId).map((row) => [row.id, row.value]));
    return {
      sections: sections().map((section) => ({
        id: section.id,
        name: section.name,
        achievements: section.definitions.map((definition) => {
          const id = `${section.id}.${definition.key}`;
          const source = section.id === GLOBAL ? global : games.get(section.id) ?? {};
          const value = definition.stat ? source[definition.stat] ?? 0 : saved.get(id) ?? 0;
          return describe(definition, id, value);
        }),
      })),
    };
  }

  /** What a game module gets as ctx.achievements: its own keys by name, and the global ones as "global.<key>". */
  function forGame(game) {
    return {
      add: (userId, key, amount) => add(game, userId, key, amount),
      raise: (userId, key, value) => raise(game, userId, key, value),
      get: (userId, key) => get(userId, key.startsWith(`${GLOBAL}.`) ? key : `${game}.${key}`),
      /** The levels reached (0 for none) in one achievement. */
      level: (userId, key) => {
        const id = key.startsWith(`${GLOBAL}.`) ? key : `${game}.${key}`;
        const definition = find(id);
        return definition ? levelInfo(definition.levels, get(userId, id)).level : 0;
      },
    };
  }

  /** Checks a game's definitions: stat keys must be ones the game declares (or built in). Returns problems as text. */
  function problems(meta) {
    const declared = new Set([...BUILTIN_STATS, ...(meta.stats ?? []).map((s) => s.key)]);
    return (meta.achievements ?? []).filter((a) => a.stat && !declared.has(a.stat)).map((a) => `${meta.id}: "${a.key}" uses the stat "${a.stat}", which the game does not declare`);
  }

  return { add, raise, get, forUser, forGame, problems };
}
