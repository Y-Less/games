// Achievements (see shared/achievements.js). A player's value for each one is either worked out from their recorded results
// (an achievement with a `stat`) or is progress a game saves with add() / raise(). This file keeps the saved progress and
// builds what the Achievements page shows.
import { BUILTIN_STATS, describe, GLOBAL_ACHIEVEMENTS, LEVEL_REWARD, levelInfo, levelText } from '../shared/achievements.js';
import { createCoins } from './coins.js';
import { transaction } from './db.js';

const GLOBAL = 'global';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ listGames: () => Array<{ id: string, name: string, achievements?: object[] }>, statsFor: (userId: number) => object, notify?: (userId: number) => void }} options
 *   statsFor is stats.forUser: the results the stat-based achievements are worked out from. notify is told when a player has
 *   new unlocks to be shown.
 */
export function createAchievements(db, { listGames, statsFor, notify = () => {} }) {
  const coins = createCoins(db);
  const read = db.prepare('SELECT value FROM achievement_progress WHERE user_id = ? AND id = ?');
  const readAll = db.prepare('SELECT id, value FROM achievement_progress WHERE user_id = ?');
  const write = db.prepare(
    `INSERT INTO achievement_progress (user_id, id, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const isBot = db.prepare('SELECT is_bot FROM users WHERE id = ?');
  const awarded = db.prepare('SELECT id, level FROM achievement_awards WHERE user_id = ?');
  const award = db.prepare('INSERT OR IGNORE INTO achievement_awards (user_id, id, level, coins, awarded_at) VALUES (?, ?, ?, ?, ?)');
  const unseen = db.prepare('SELECT id, level, coins FROM achievement_awards WHERE user_id = ? AND shown = 0 ORDER BY awarded_at, id, level');
  const markSeen = db.prepare('UPDATE achievement_awards SET shown = 1 WHERE user_id = ? AND id = ? AND level = ?');

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
  const isPerson = (userId) => Number.isInteger(userId) && isBot.get(userId)?.is_bot === 0;

  /**
   * Pays for every level of `definition` that `value` has reached and that has not been paid yet (LEVEL_REWARD coins each,
   * whichever level), and records it to be shown. `done` is the set of "id:level" already paid. Returns the new levels.
   */
  function payLevels(userId, id, definition, value, done) {
    const fresh = [];
    for (let level = 1; level <= levelInfo(definition.levels, value).level; level++) {
      if (done.has(`${id}:${level}`)) continue;
      award.run(userId, id, level, LEVEL_REWARD, Date.now());
      coins.award(userId, LEVEL_REWARD, `achievement:${id}:${level}`);
      fresh.push({ id, level });
    }
    return fresh;
  }
  const paidLevels = (userId) => new Set(awarded.all(userId).map((row) => `${row.id}:${row.level}`));

  /** Works out one achievement for one player and pays what it newly unlocked (after a game saves progress). */
  function settleOne(userId, id, definition) {
    const fresh = transaction(db, () => payLevels(userId, id, definition, savedValue(userId, id), paidLevels(userId)));
    if (fresh.length) notify(userId);
    return fresh;
  }

  /** Works out every achievement for one player (from results and saved progress) and pays what is new. Returns the new levels. */
  function settle(userId) {
    if (!isPerson(userId)) return [];
    const { global, games } = statValues(userId);
    const saved = new Map(readAll.all(userId).map((row) => [row.id, row.value]));
    const fresh = transaction(db, () => {
      const done = paidLevels(userId);
      return sections().flatMap((section) =>
        section.definitions.flatMap((definition) => {
          const id = `${section.id}.${definition.key}`;
          const source = section.id === GLOBAL ? global : games.get(section.id) ?? {};
          return payLevels(userId, id, definition, definition.stat ? source[definition.stat] ?? 0 : saved.get(id) ?? 0, done);
        }),
      );
    });
    if (fresh.length) notify(userId);
    return fresh;
  }

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
    if (!isPerson(userId)) return null; // computer players do not collect achievements
    const before = savedValue(userId, id);
    const after = fn(before);
    if (!Number.isFinite(after) || after === before) return { before, after: before, level: levelInfo(definition.levels, before).level, unlocked: false };
    write.run(userId, id, after, Date.now());
    const was = levelInfo(definition.levels, before).level;
    const level = levelInfo(definition.levels, after).level;
    if (level > was) settleOne(userId, id, definition);
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

  /** What a player has unlocked and not yet been shown: [{ id, level, game, name, text, coins }], oldest first. */
  function pending(userId) {
    return unseen.all(userId).flatMap((row) => {
      const [game] = row.id.split('.');
      const section = sections().find((x) => x.id === game);
      const definition = section?.definitions.find((d) => `${section.id}.${d.key}` === row.id);
      if (!definition) return [];
      return [{ id: row.id, level: row.level, levels: definition.levels.length, game: section.name, name: definition.name, text: levelText(definition, definition.levels[row.level - 1]), coins: row.coins }];
    });
  }

  /** Marks unlocks as shown: items are { id, level }. */
  function seen(userId, items) {
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item?.id === 'string' && Number.isInteger(item.level)) markSeen.run(userId, item.id, item.level);
    }
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

  return { add, raise, get, forUser, forGame, problems, settle, pending, seen };
}
