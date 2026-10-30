// Achievements (see shared/achievements.js). A player's value for each one is either worked out from their recorded results
// (an achievement with a `stat`) or is progress a game saves with add() / raise(). This file keeps the saved progress, pays
// the coins for levels reached and builds what the Achievements page shows; which achievements exist is in achievementRegistry.js.
import { BUILTIN_STATS, describe, levelInfo, levelReward, levelText } from '../shared/achievements.js';
import { createRegistry, fullId, GLOBAL } from './achievementRegistry.js';
import { createCoins } from './coins.js';
import { transaction } from './db.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ listGames: () => Array<{ id: string, name: string, achievements?: object[] }>, statsFor: (userId: number) => object, notify?: (userId: number) => void }} options
 *   statsFor is stats.forUser: the results the stat-based achievements are worked out from. notify is told when a player has
 *   new unlocks to be shown.
 */
export function createAchievements(db, { listGames, statsFor, notify = () => {} }) {
  const coins = createCoins(db);
  const { sections, find } = createRegistry(listGames);
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

  const savedValue = (userId, id) => read.get(userId, id)?.value ?? 0;
  const isPerson = (userId) => Number.isInteger(userId) && isBot.get(userId)?.is_bot === 0;

  // ---- values: what a player has achieved so far ----

  /** The numbers the stat-based achievements are worked out from, for one player: the site's totals and each game's. */
  function statValues(userId) {
    const { summary, perGame } = statsFor(userId);
    const global = Object.fromEntries(['played', 'wins', 'losses', 'draws'].map((key) => [key, summary[key]]));
    const games = new Map(
      perGame.map((g) => [g.game, { ...Object.fromEntries(BUILTIN_STATS.map((key) => [key, g[key] ?? 0])), ...Object.fromEntries(g.extras.map((e) => [e.key, e.value])) }]),
    );
    return { global, games };
  }

  /** Reads one player's saved progress and results once, and answers (section id, definition) with that definition's current value. */
  function valuesFor(userId) {
    const { global, games } = statValues(userId);
    const saved = new Map(readAll.all(userId).map((row) => [row.id, row.value]));
    return (sectionId, definition) => {
      if (!definition.stat) return saved.get(`${sectionId}.${definition.key}`) ?? 0;
      return (sectionId === GLOBAL ? global : games.get(sectionId) ?? {})[definition.stat] ?? 0;
    };
  }

  /** The current value of one achievement ("hearts.moon", or "global.cards"), for a game that wants to look. */
  function get(userId, id) {
    const found = find(id);
    if (!found) return 0;
    if (!found.definition.stat) return savedValue(userId, id);
    return valuesFor(userId)(found.section.id, found.definition);
  }

  // ---- saved progress ----

  /** The id and definition of an achievement a game may save progress for. */
  function resolve(game, key) {
    const id = fullId(game, key);
    const found = find(id);
    if (!found) throw new Error(`Unknown achievement "${key}"`);
    if (found.definition.stat) throw new Error(`"${key}" is worked out from the recorded results, so it cannot be set`);
    return { id, definition: found.definition };
  }

  /** Saves the value `next` makes of the current one, and pays any level it reaches. Returns { before, after, level, unlocked }. */
  function change(game, userId, key, next) {
    const { id, definition } = resolve(game, key);
    if (!isPerson(userId)) return null; // computer players do not collect achievements
    const levelOf = (value) => levelInfo(definition.levels, value).level;
    const before = savedValue(userId, id);
    const after = next(before);
    if (!Number.isFinite(after) || after === before) return { before, after: before, level: levelOf(before), unlocked: false };
    write.run(userId, id, after, Date.now());
    const unlocked = levelOf(after) > levelOf(before);
    if (unlocked) settleOne(userId, id, definition);
    return { before, after, level: levelOf(after), unlocked };
  }

  /** Adds to a saved achievement (1 by default). Returns { before, after, level, unlocked } or null for a computer player. */
  const add = (game, userId, key, amount = 1) => change(game, userId, key, (value) => (Number.isFinite(amount) && amount > 0 ? value + amount : value));
  /** Raises a saved achievement to `value` if that is more than it is now (for "best ever" numbers). */
  const raise = (game, userId, key, value) => change(game, userId, key, (current) => (Number.isFinite(value) ? Math.max(current, value) : current));

  // ---- paying for levels ----

  /**
   * Pays for every level of `definition` that `value` has reached and that has not been paid yet (levelReward coins: 200 a level, or
   * 500 for a one-level achievement), and records it to be shown. `done` is the set of "id:level" already paid. Returns the new levels.
   */
  function payLevels(userId, id, definition, value, done) {
    const fresh = [];
    for (let level = 1; level <= levelInfo(definition.levels, value).level; level++) {
      if (done.has(`${id}:${level}`)) continue;
      const amount = levelReward(level, definition.levels.length);
      award.run(userId, id, level, amount, Date.now());
      coins.award(userId, amount, `achievement:${id}:${level}`);
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
    const valueOf = valuesFor(userId);
    const fresh = transaction(db, () => {
      const done = paidLevels(userId);
      return sections().flatMap((section) =>
        section.definitions.flatMap((definition) => payLevels(userId, `${section.id}.${definition.key}`, definition, valueOf(section.id, definition), done)),
      );
    });
    if (fresh.length) notify(userId);
    return fresh;
  }

  // ---- what a player is shown ----

  /** What a player has unlocked and not yet been shown: [{ id, level, game, name, text, coins }], oldest first. */
  function pending(userId) {
    return unseen.all(userId).flatMap((row) => {
      const found = find(row.id);
      if (!found) return []; // a game has since dropped it
      const { section, definition } = found;
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
    const valueOf = valuesFor(userId);
    return {
      sections: sections().map((section) => ({
        id: section.id,
        name: section.name,
        achievements: section.definitions.map((definition) => describe(definition, `${section.id}.${definition.key}`, valueOf(section.id, definition))),
      })),
    };
  }

  // ---- for the game modules ----

  /** What a game module gets as ctx.achievements: its own keys by name, and the global ones as "global.<key>". */
  function forGame(game) {
    return {
      add: (userId, key, amount) => add(game, userId, key, amount),
      raise: (userId, key, value) => raise(game, userId, key, value),
      get: (userId, key) => get(userId, fullId(game, key)),
      /** Counts cards a person has just played towards the global Played cards achievement, if the move (`outcome`) was allowed. Returns the outcome. */
      cardsPlayed: (userId, outcome, count) => {
        if (outcome?.ok) add(game, userId, 'global.cards', count);
        return outcome;
      },
      /** The levels reached (0 for none) in one achievement. */
      level: (userId, key) => {
        const id = fullId(game, key);
        const found = find(id);
        return found ? levelInfo(found.definition.levels, get(userId, id)).level : 0;
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
