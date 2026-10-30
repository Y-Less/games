// Achievements: a number that grows as you play, and the levels it unlocks. The same rules are used by the server (to work out
// a player's levels) and by the page (to draw them).
//
// A definition (in a game's module.json "achievements", or GLOBAL_ACHIEVEMENTS below) is
//   { key, name, text, one?, levels: [10, 50, 100], stat? }
// - `levels` are the values at which each level unlocks (ascending whole numbers); a one-level achievement has one entry.
// - `text` says what a level asks for, with {n} replaced by that level's number ("Play {n} cards"); `one` is used instead
//   when the number is 1 ("Shoot the moon").
// - `stat` makes the value come from the game's recorded results, so it counts games played before the achievement
//   existed: a game's own stat key (declared in its module.json "stats"), or 'played', 'wins', 'losses', 'totalScore' or
//   'bestScore'. Without `stat` the value is progress that the game saves itself (ctx.achievements).

/** Levels by how hard an achievement is meant to be; a definition may say `"levels": "easy"` instead of listing them. */
export const TIERS = {
  easy: [100, 500, 1000, 5000, 10000],
  medium: [10, 50, 100, 500, 1000],
  hard: [1, 5, 10, 50, 100],
};

/** Coins paid for every level unlocked, whichever level it is. */
export const LEVEL_REWARD = 1000;

export const BUILTIN_STATS = ['played', 'wins', 'losses', 'draws', 'totalScore', 'bestScore'];

/** The achievements that belong to the site rather than to one game. */
export const GLOBAL_ACHIEVEMENTS = [
  { key: 'games', name: 'Played games', text: 'Play {n} games', one: 'Play a game', levels: TIERS.medium, stat: 'played' },
  { key: 'wins', name: 'Won games', text: 'Win {n} games', one: 'Win a game', levels: TIERS.hard, stat: 'wins' },
  { key: 'cards', name: 'Played cards', text: 'Play {n} cards', one: 'Play a card', levels: TIERS.easy },
];

/** Every game has these two, whatever its module.json says: how often you played it, and how often you won. */
export const GAME_ACHIEVEMENTS = [
  { key: 'played', name: 'Played the game', text: 'Play {n} games', one: 'Play a game', levels: TIERS.medium, stat: 'played' },
  { key: 'won', name: 'Won the game', text: 'Win {n} games', one: 'Win a game', levels: TIERS.hard, stat: 'wins' },
];

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;

/** Tidies one definition from a module.json, or returns null when it is not usable. */
export function cleanDefinition(input) {
  if (!input || typeof input !== 'object') return null;
  const { key, name, text, one, stat } = input;
  const levels = typeof input.levels === 'string' ? TIERS[input.levels] ?? [] : Array.isArray(input.levels) ? input.levels : [];
  if (typeof key !== 'string' || !KEY.test(key) || typeof name !== 'string' || !name || typeof text !== 'string' || !text) return null;
  if (!levels.length || levels.some((n, i) => !Number.isFinite(n) || n <= 0 || (i > 0 && n <= levels[i - 1]))) return null;
  return { key, name, text, one: typeof one === 'string' && one ? one : null, levels: [...levels], stat: typeof stat === 'string' && stat ? stat : null };
}

const FORMAT = new Intl.NumberFormat('en-GB');

/** What a level asks for, in words: "Play 1,000 cards". */
export function levelText(definition, n) {
  const text = n === 1 && definition.one ? definition.one : definition.text;
  return text.replace('{n}', FORMAT.format(n));
}

/**
 * Where a value stands: the level reached (0 for none), the next level to aim for (null at the top) and how far along
 * that is. Progress is the value as a fraction of the next level's number, so 600 cards towards level 3 at 1,000 is 60%.
 */
export function levelInfo(levels, value) {
  const level = levels.filter((n) => value >= n).length;
  const next = level < levels.length ? levels[level] : null;
  return { level, next, progress: next === null ? 1 : Math.max(0, Math.min(1, value / next)) };
}

/** A definition with a player's value worked out, in the shape the page draws. */
export function describe(definition, id, value) {
  const { level, next, progress } = levelInfo(definition.levels, value);
  return {
    id,
    key: definition.key,
    name: definition.name,
    value,
    level,
    maxLevel: definition.levels.length,
    levels: definition.levels.map((n, i) => ({ n, text: levelText(definition, n), done: i < level })),
    current: level ? { n: definition.levels[level - 1], text: levelText(definition, definition.levels[level - 1]) } : null,
    next: next === null ? null : { n: next, text: levelText(definition, next) },
    progress,
  };
}
