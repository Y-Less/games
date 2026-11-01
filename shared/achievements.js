// Achievements: a number that grows as you play, and the levels it unlocks. The same rules are used by the server (to work out
// a player's levels) and by the page (to draw them).
//
// A definition (in a game's module.json "achievements", or GLOBAL_ACHIEVEMENTS below) is
//   { key, name, text, one?, levels: [10, 50, 100] or a tier name such as "easy", stat? }
// - `levels` are the values at which each level unlocks (ascending whole numbers), or the name of a tier (see TIERS); a
//   one-level achievement has one entry, or is `"unlock"`.
// - `text` says what a level asks for, with {n} replaced by that level's number ("Play {n} cards"); `one` is used instead
//   when the number is 1 ("Shoot the moon").
// - `stat` makes the value come from the game's recorded results, so it counts games played before the achievement
//   existed: a game's own stat key (declared in its module.json "stats"), or 'played', 'wins', 'losses', 'totalScore' or
//   'bestScore'. Without `stat` the value is progress that the game saves itself (ctx.achievements).
// - A global definition may instead add up stats from several games: `sum: [[game, stat], ...]`, be 1 once every game has
//   been won at least once: `wonEvery: true`, or take its value from something the site measures: `measure: 'coinsSpent'`.
// Depends on: nothing (pure, no imports); used by server/achievements.js, the achievement views and each module.json.

/**
 * Levels by how often the thing happens, and one for a one-off; a definition may say `"levels": "easy"` instead of listing them. A game's own
 * achievements top out after 100 to 200 games of that game, and from medium up the first level is 1 so that the first time
 * always counts.
 *   veryEasy  something everyone does many times a game (playing cards, taking tokens)
 *   easy      a few times a game (getting the jack)
 *   medium    about once a game (playing the game)
 *   hard      once every few games (winning)
 *   veryHard  once in a good many games (shooting the moon)
 *   unlock    a one-off with a single level (finishing a game with no points)
 */
export const TIERS = {
  veryEasy: [100, 500, 1000, 2500, 5000],
  easy: [10, 50, 100, 250, 500],
  medium: [1, 10, 25, 50, 150],
  hard: [1, 5, 10, 25, 50],
  veryHard: [1, 2, 3, 5, 10],
  unlock: [1], // a one-off: you have it or you do not
};

/** The same tiers for the global achievements, which add up every game: they top out after 500 to 1,000 games. */
export const GLOBAL_TIERS = {
  veryEasy: [100, 1000, 5000, 15000, 25000],
  easy: [10, 100, 500, 1000, 2500],
  medium: [1, 10, 100, 250, 750],
  hard: [1, 10, 25, 100, 200],
  veryHard: [1, 3, 5, 10, 25],
  unlock: [1],
};

/** Gold for each level a player unlocks: 100 times the level number, or a flat 250 for an achievement with only one level. */
export const COINS_PER_LEVEL = 100;
export const SINGLE_LEVEL_COINS = 250;
// Gold awarded for unlocking `level` (1-based) of an achievement with `levelCount` levels in total.
// Returns SINGLE_LEVEL_COINS when there is only one level, otherwise COINS_PER_LEVEL * level.
export const levelReward = (level, levelCount) => (levelCount === 1 ? SINGLE_LEVEL_COINS : COINS_PER_LEVEL * level);

// Stat names always available to a definition's `stat`, in addition to a game's own declared stats.
export const BUILTIN_STATS = ['played', 'wins', 'losses', 'draws', 'totalScore', 'bestScore'];

/** The achievements that belong to the site rather than to one game. */
export const GLOBAL_ACHIEVEMENTS = [
  { key: 'welcome', name: 'Welcome', text: 'Sign up', levels: GLOBAL_TIERS.unlock, measure: 'member' },
  { key: 'games', name: 'Played games', text: 'Play {n} games', one: 'Play a game', levels: GLOBAL_TIERS.medium, stat: 'played' },
  { key: 'wins', name: 'Won games', text: 'Win {n} games', one: 'Win a game', levels: GLOBAL_TIERS.hard, stat: 'wins' },
  { key: 'persistent', name: 'Persistent', text: 'You just lost the game ({n} times)', one: 'You just lost the game (1 time)', levels: GLOBAL_TIERS.medium, stat: 'losses' },
  { key: 'cards', name: 'Played cards', text: 'Play {n} cards', one: 'Play a card', levels: GLOBAL_TIERS.veryEasy },
  { key: 'slow', name: 'Take your time', text: 'Take over 10 minutes for a turn', levels: GLOBAL_TIERS.unlock },
  {
    key: 'pieces',
    name: 'Played pieces',
    text: 'Place {n} pieces in the building games',
    one: 'Place a piece in a building game',
    levels: GLOBAL_TIERS.easy,
    sum: [['azulejo', 'wallTiles'], ['gaudi', 'dicePlaced'], ['rummikub', 'tilesPlayed'], ['splendour', 'cardsBought']],
  },
  { key: 'spent', name: 'Big spender', text: 'Spend {n} gold in the shop', levels: [2000, 10000, 20000, 50000, 100000], measure: 'coinsSpent' },
  { key: 'indecisive', name: 'Indecisive', text: 'Put {n} shop items to use', one: 'Put a shop item to use', levels: [10, 50, 100, 500, 1000] },
  { key: 'customised', name: 'Customised', text: 'Buy something from every part of the shop', levels: GLOBAL_TIERS.unlock, measure: 'customised' },
  { key: 'steve', name: "Steve's Achievement", text: "Claim Steve's reward", levels: GLOBAL_TIERS.unlock },
  { key: 'everygame', name: 'Won every game', text: 'Win every game at least once', levels: GLOBAL_TIERS.unlock, wonEvery: true },
];

/** Every game has these two, whatever its module.json says: how often you played it, and how often you won. */
export const GAME_ACHIEVEMENTS = [
  { key: 'played', name: 'Played the game', text: 'Play {n} games', one: 'Play a game', levels: TIERS.medium, stat: 'played' },
  { key: 'won', name: 'Won the game', text: 'Win {n} games', one: 'Win a game', levels: TIERS.hard, stat: 'wins' },
];

// A definition key: starts with a letter, then letters/digits only (it becomes a database key, so keep it plain).
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;

/**
 * Validates one achievement definition from a module.json and normalises it.
 * Rejects bad keys, empty names/text and non-ascending or non-positive levels; a string `levels` is looked up in TIERS.
 * @param {object} input  the raw definition object
 * @returns {{ key: string, name: string, text: string, one: string|null, levels: number[], stat: string|null }|null} the tidied definition, or null when unusable
 * Side effects: none.
 */
export function cleanDefinition(input) {
  if (!input || typeof input !== 'object') return null;
  const { key, name, text, one, stat } = input;
  const levels = typeof input.levels === 'string' ? TIERS[input.levels] ?? [] : Array.isArray(input.levels) ? input.levels : [];
  if (typeof key !== 'string' || !KEY.test(key) || typeof name !== 'string' || !name || typeof text !== 'string' || !text) return null;
  if (!levels.length || levels.some((n, i) => !Number.isFinite(n) || n <= 0 || (i > 0 && n <= levels[i - 1]))) return null;
  return { key, name, text, one: typeof one === 'string' && one ? one : null, levels: [...levels], stat: typeof stat === 'string' && stat ? stat : null };
}

// Formats numbers with thousands separators ("1,000") for level text.
const FORMAT = new Intl.NumberFormat('en-GB');

/**
 * Describes what a level asks for in words, e.g. "Play 1,000 cards".
 * @param {{ text: string, one?: string|null }} definition  the achievement definition
 * @param {number} n  the level's target number
 * @returns {string} the text, using `one` when n is 1 and the definition has it
 * Side effects: none.
 */
export function levelText(definition, n) {
  const text = n === 1 && definition.one ? definition.one : definition.text;
  return text.replace('{n}', FORMAT.format(n));
}

/**
 * Works out where a value stands against a list of levels.
 * Progress is the value as a fraction of the next level's number, so 600 cards towards level 3 at 1,000 is 60%.
 * @param {number[]} levels  ascending level targets
 * @param {number} value  the player's current value
 * @returns {{ level: number, next: number|null, progress: number }} level reached (0 for none), the next target (null at the top) and progress in 0..1
 * Side effects: none.
 */
export function levelInfo(levels, value) {
  const level = levels.filter((n) => value >= n).length;
  const next = level < levels.length ? levels[level] : null;
  return { level, next, progress: next === null ? 1 : Math.max(0, Math.min(1, value / next)) };
}

/**
 * Builds the shape the page draws for one achievement: definition plus a player's value and level state.
 * @param {object} definition  a cleaned definition (see cleanDefinition)
 * @param {string} id  the unique id to report (e.g. "game:key"), echoed back
 * @param {number} value  the player's current value
 * @returns {object} { id, key, name, value, level, maxLevel, levels, current, next, progress }
 * Side effects: none.
 */
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
