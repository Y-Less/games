// The pure rules of Rummikub, shared by the server and the client (no sockets, no files, no Vue).
//
// Tiles are plain integers, so a tile can be tracked wherever it goes. With `numbers` = N and `colours` = C:
//   ids 0 .. 2*C*N - 1   numbered tiles, two copies of every (colour, number): colour = floor((id % (C*N)) / N),
//                         number = id % N + 1
//   ids 2*C*N ..          the wildcards (jokers)
// `s` below is always the game's settings: { numbers, colours, wildcards, ... }.
//
// A set on the table is an array of tile ids. A set is valid when it is
//   - a run: three or more tiles of one colour with consecutive numbers (no wrapping from N to 1), or
//   - a group: three or more tiles of one number in different colours (at most one per colour),
// where a joker stands for any tile that makes the set valid. The order of a set on the table does not matter: the rules
// work out which tile each joker stands for (`resolveSet`) and the server stores sets in that canonical order.
//
// Depends on shared/messages.js alone: it is imported by game.js, search.js, tally.js, the AIs and the client. Every
// function here is pure (it never changes its arguments) unless a comment says otherwise, which is what lets the AIs
// call them thousands of times. Nothing here is a sentence: a refusal's `error` is a message ({ key, params }, see
// shared/messages.js), which the client puts into words and the server turns into a refusal code.
import { msg } from '../../shared/messages.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
const HAND_SIZE = 14;
export const JOKER_VALUE = 30;
export const MIN_SET = 3;
export const MIN_DEAL = 6;

/** [min, max] for every host-set number. */
export const LIMITS = {
  numbers: [2, 20],
  colours: [2, 8],
  wildcards: [0, 8],
  rounds: [1, 10],
  meld: [0, 60],
  timer: [0, 300],
};
const MIN_TIMER = 15; // seconds; a timer shorter than this (but not off) is raised to it
export const DEFAULT_SETTINGS = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0, playOnMeld: false };

/** The key of each colour under `colours.` in the locale files, indexed by a tile's colour number. */
export const COLOUR_KEYS = ['red', 'blue', 'orange', 'black', 'green', 'purple', 'teal', 'pink'];
/** A colour's name as a message. Takes the colour number (out of range: the first colour); returns a message; no side effects. */
export const colourMsg = (colour) => msg(`colours.${COLOUR_KEYS[colour] ?? COLOUR_KEYS[0]}`);

// The shape of every rejection in this file: { ok: false, error } where `error` is a message (shared/messages.js).
const fail = (error) => ({ ok: false, error });
const isInt = Number.isSafeInteger;

// ---- the tiles ----

// How many numbered (non-joker) tiles there are: two copies of every colour/number pair.
export const numberedCount = (s) => 2 * s.colours * s.numbers;
// How many tiles exist in all, jokers included.
export const totalTiles = (s) => numberedCount(s) + s.wildcards;
// Jokers are the ids after all the numbered tiles.
export const isJoker = (s, id) => id >= numberedCount(s);
// Whether id is an integer naming a tile that exists (used to reject garbage from clients).
export const validTile = (s, id) => isInt(id) && id >= 0 && id < totalTiles(s);

/**
 * What a tile id means.
 *
 * @param {object} s  settings
 * @param {number} id  a tile id
 * @returns {{ joker: boolean, colour: number | null, number: number | null }} colour 0..C-1 and number 1..N, both null
 *   for a joker
 * Side effects: none.
 */
export function tileOf(s, id) {
  if (isJoker(s, id)) return { joker: true, colour: null, number: null };
  const within = id % (s.colours * s.numbers);
  return { joker: false, colour: Math.floor(within / s.numbers), number: (within % s.numbers) + 1 };
}

/** The points a tile costs while it is still in a rack (a joker is 30). Takes (s, id), returns a number; no side effects. */
export const tileValue = (s, id) => (isJoker(s, id) ? JOKER_VALUE : tileOf(s, id).number);
// The total rack-penalty points of a list of tile ids.
export const rackValue = (s, ids) => ids.reduce((sum, id) => sum + tileValue(s, id), 0);

// A tile's name as a message, e.g. "Red 7" or "Wildcard". Takes (s, id); returns a message; no side effects.
export const tileName = (s, id) => {
  const t = tileOf(s, id);
  return t.joker ? msg('tiles.wildcard') : msg('tiles.name', { colour: colourMsg(t.colour), number: t.number });
};

// ---- the deal ----

/**
 * How many tiles each player is dealt: 14, or fewer when the tiles would not leave a pool at least that big (the "+ 1" is
 * the pool counted as one more hand).
 *
 * @param {object} s  settings
 * @param {number} players  how many people are dealt in
 * @returns {number} tiles per player
 * Side effects: none.
 */
export const dealSize = (s, players) => Math.min(HAND_SIZE, Math.floor(totalTiles(s) / (players + 1)));

/**
 * Why a game with these settings cannot be played by this many people, or null.
 *
 * @param {object} s  settings
 * @param {number} players  how many players there would be
 * @returns {{ key: string, params?: object } | null} a message for the host, or null when the game can start
 * Side effects: none.
 */
export function startProblem(s, players) {
  if (s.numbers < MIN_SET && s.colours < MIN_SET) return msg('errors.fewNumbersColours', { min: MIN_SET });
  const hand = dealSize(s, players);
  if (hand < MIN_DEAL) return msg('errors.tooFewTiles', { tiles: totalTiles(s), players, min: MIN_DEAL });
  return null;
}

// ---- settings ----

// value forced into the inclusive range [low, high].
const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/**
 * Checks and clamps host-chosen settings over `current`. Unknown keys are ignored; a non-number is an error.
 *
 * @param {object} input  what the host sent (anything; a non-object means "no change")
 * @param {object} [current]  the settings to start from
 * @returns {{ ok: true, settings: object } | { ok: false, error: string }} a new settings object, or why the input is refused
 * Side effects: none (the input and current are copied, not changed).
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...DEFAULT_SETTINGS, ...current };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: true, settings: next };
  for (const key of Object.keys(LIMITS)) {
    if (!Object.hasOwn(input, key) || input[key] === undefined) continue;
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(msg('errors.settingNotNumber', { setting: msg(`settings.${key}`) }));
    let n = clamp(Math.round(value), LIMITS[key]);
    if (key === 'timer' && n > 0) n = Math.max(MIN_TIMER, n);
    next[key] = n;
  }
  if (Object.hasOwn(input, 'playOnMeld') && input.playOnMeld !== undefined) {
    if (typeof input.playOnMeld !== 'boolean') return fail(msg('errors.playOnMeldSetting'));
    next.playOnMeld = input.playOnMeld;
  }
  return { ok: true, settings: next };
}

// ---- sets ----

// A string that is the same for the same group of tile ids whatever their order: used to compare sets.
const sortedKey = (ids) => [...ids].sort((a, b) => a - b).join(',');

/**
 * Tries to read the tiles as a run (one colour, consecutive numbers), letting jokers fill the gaps and ends.
 *
 * @param {object} s  settings
 * @param {Array<{ id: number, joker: boolean, colour: number | null, number: number | null }>} tiles  tiles with tileOf data
 * @returns {object} { ok: true, kind: 'run', items, value } or { ok: false, error } (the error is a message)
 * Side effects: none.
 */
function asRun(s, tiles) {
  const reals = tiles.filter((t) => !t.joker);
  if (reals.some((t) => t.colour !== reals[0].colour)) return fail(msg('errors.runOneColour'));
  const numbers = reals.map((t) => t.number);
  if (new Set(numbers).size !== numbers.length) return fail(msg('errors.runRepeats'));
  const len = tiles.length;
  if (len > s.numbers) return fail(msg('errors.runTooLong', { max: s.numbers }));
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (high - low + 1 > len) return fail(msg('errors.runGap'));
  // The highest start gives the most points to jokers that could go at either end.
  const start = Math.min(low, s.numbers - len + 1);
  const byNumber = new Map(reals.map((t) => [t.number, t]));
  const jokers = tiles.filter((t) => t.joker);
  let nextJoker = 0;
  const items = [];
  for (let n = start; n < start + len; n++) {
    const real = byNumber.get(n);
    const tile = real ?? jokers[nextJoker++];
    items.push({ id: tile.id, joker: tile.joker, colour: reals[0].colour, number: n });
  }
  return { ok: true, kind: 'run', items, value: items.reduce((sum, item) => sum + item.number, 0) };
}

/**
 * Tries to read the tiles as a group (one number, a different colour each); jokers take no colour.
 *
 * @param {object} s  settings
 * @param {Array<{ id: number, joker: boolean, colour: number | null, number: number | null }>} tiles  tiles with tileOf data
 * @returns {object} { ok: true, kind: 'group', items, value } or { ok: false, error } (the error is a message)
 * Side effects: none.
 */
function asGroup(s, tiles) {
  const reals = tiles.filter((t) => !t.joker);
  if (reals.some((t) => t.number !== reals[0].number)) return fail(msg('errors.groupOneNumber'));
  const colours = reals.map((t) => t.colour);
  if (new Set(colours).size !== colours.length) return fail(msg('errors.groupColours'));
  if (tiles.length > s.colours) return fail(msg('errors.groupTooBig', { max: s.colours }));
  const number = reals[0].number;
  const items = [...reals].sort((a, b) => a.colour - b.colour).map((t) => ({ id: t.id, joker: false, colour: t.colour, number }));
  for (const t of tiles.filter((x) => x.joker)) items.push({ id: t.id, joker: true, colour: null, number });
  return { ok: true, kind: 'group', items, value: number * tiles.length };
}

/**
 * Works out whether these tile ids make a valid set. On success: { ok, kind: 'run' | 'group', items, value } where
 * `items` is the canonical order ([{ id, joker, colour, number }], jokers carrying the colour/number they stand for;
 * a joker in a group has colour null) and `value` is the set's points for the first-meld rule (jokers count as the tile
 * they replace; where a joker could stand at either end of a run the higher reading is used). Otherwise { ok: false, error }.
 * When both readings work (a group and a run can be the same tiles with jokers) the more valuable one is returned.
 *
 * @param {object} s  settings
 * @param {number[]} ids  the tile ids of one set, in any order
 * @returns {object} the result described above
 * Side effects: none.
 */
export function resolveSet(s, ids) {
  if (!Array.isArray(ids) || ids.length < MIN_SET) return fail(msg('errors.setTooSmall', { min: MIN_SET }));
  if (ids.some((id) => !validTile(s, id)) || new Set(ids).size !== ids.length) return fail(msg('errors.notASet'));
  const tiles = ids.map((id) => ({ id, ...tileOf(s, id) }));
  if (!tiles.some((t) => !t.joker)) return fail(msg('errors.onlyJokers'));
  const run = asRun(s, tiles);
  const group = asGroup(s, tiles);
  if (run.ok && group.ok) return group.value > run.value ? group : run;
  if (run.ok) return run;
  if (group.ok) return group;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length > 1 && reals.every((t) => t.colour === reals[0].colour)) return run;
  if (reals.length > 1 && reals.every((t) => t.number === reals[0].number)) return group;
  if (reals.length === 1) return fail(msg('errors.notRunOrGroup'));
  return fail(msg('errors.notASetKind'));
}

// ---- jokers that are already on the table ----

// Whether two { colour, number } descriptions are the same tile kind (ignoring which copy).
const sameTile = (a, b) => a.colour === b.colour && a.number === b.number;

/**
 * The tiles a joker in this set could be swapped for: every colour and number that, put in the joker's place, leaves a
 * valid set. Usually one; two for a joker at the end of a run or in a group of three, where either of two tiles fits.
 *
 * @param {object} s  settings
 * @param {number[]} ids  the set, including the joker
 * @param {number} jokerId  which tile in ids is the joker
 * @returns {Array<{ colour: number, number: number }>} the tile kinds that fit
 * Side effects: none.
 */
export function jokerOptions(s, ids, jokerId) {
  const others = ids.filter((id) => id !== jokerId);
  const copy = s.colours * s.numbers; // the second copy of a tile is this many ids on
  const options = [];
  for (let colour = 0; colour < s.colours; colour++) {
    for (let number = 1; number <= s.numbers; number++) {
      const first = colour * s.numbers + number - 1;
      const probe = [first, first + copy].find((id) => !others.includes(id));
      if (probe !== undefined && resolveSet(s, [...others, probe]).ok) options.push({ colour, number });
    }
  }
  return options;
}

/**
 * The jokers on the table at the start of a turn, each with what it stands for (see jokerOptions): a Map of joker id to
 * options. A joker remembers these for the whole turn, whatever happens to the rest of its set, and can only leave its
 * place by being swapped for a tile that matches one of them.
 *
 * @param {object} s  settings
 * @param {number[][]} table  the table at the start of the turn
 * @returns {Map<number, Array<{ colour: number, number: number }>>} joker id to what it can stand for
 * Side effects: none.
 */
export function pinnedJokers(s, table) {
  const pinned = new Map();
  for (const set of table) {
    for (const id of set) {
      if (!isJoker(s, id)) continue;
      const options = jokerOptions(s, set, id);
      if (options.length) pinned.set(id, options);
    }
  }
  return pinned;
}

/** Whether this tile is one a joker with these options could be swapped for. Takes (s, id, options) from pinnedJokers; returns a boolean; no side effects. */
export const fitsJoker = (s, id, options) => !isJoker(s, id) && options.some((option) => sameTile(option, tileOf(s, id)));

/**
 * Whether a joker, in the set it is in now, can still stand for something it stood for.
 *
 * @param {object} s  settings
 * @param {number[]} set  the set the joker is in now
 * @param {number} jokerId  the joker
 * @param {Array<{ colour: number, number: number }>} was  the options it had at the start of the turn
 * @returns {boolean} true when at least one old option still fits
 * Side effects: none.
 */
const jokerStays = (s, set, jokerId, was) => jokerOptions(s, set, jokerId).some((now) => was.some((option) => sameTile(now, option)));

// The message for a joker that has left its place without being swapped for the tile it stood for.
const JOKER_TAKEN = msg('errors.jokerTaken');

/**
 * The rule for jokers already on the table: each must still be in a set where it could stand for what it stood for, or have
 * been swapped for a tile that fits. A fitting tile counts if it came from the rack or has moved to a different set (the
 * table is only judged as it ends, so this is the check that can be made). Returns an error message or null.
 *
 * @param {object} s  settings
 * @param {number[][]} before  the table at the start of the turn
 * @param {number[][]} proposed  the table the player wants
 * @param {Set<number>} oldSet  every tile id on the table before
 * @returns {{ key: string, params?: object } | null} the error as a message, or null when every joker is accounted for
 * Side effects: none.
 */
function jokerProblem(s, before, proposed, oldSet) {
  const pinned = pinnedJokers(s, before);
  if (!pinned.size) return null;
  const setOf = new Map();
  proposed.forEach((set, i) => set.forEach((id) => setOf.set(id, i)));
  const startSetOf = new Map();
  before.forEach((set, i) => set.forEach((id) => startSetOf.set(id, i)));
  const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
  const spare = proposed.flat().filter((id) => !isJoker(s, id) && (!oldSet.has(id) || !sameIds(proposed[setOf.get(id)], before[startSetOf.get(id)])));
  for (const [id, options] of pinned) {
    if (jokerStays(s, proposed[setOf.get(id)], id, options)) continue;
    const at = spare.findIndex((tile) => fitsJoker(s, tile, options));
    if (at === -1) return JOKER_TAKEN;
    spare.splice(at, 1);
  }
  return null;
}

/**
 * The canonical order of a valid set, or the ids as they are when it is not valid (the client keeps unfinished sets).
 *
 * @param {object} s  settings
 * @param {number[]} ids  a set
 * @returns {number[]} ids in canonical order, or the same ids unchanged
 * Side effects: none.
 */
export const orderedSet = (s, ids) => {
  const r = resolveSet(s, ids);
  return r.ok ? r.items.map((i) => i.id) : ids;
};

// ---- a whole turn ----

// Whether list is an array holding only tile ids that exist.
const isIdList = (s, list) => Array.isArray(list) && list.every((id) => validTile(s, id));

/**
 * Checks a proposed table.
 *   before    the table at the start of the turn: [[ids]]
 *   rack      the player's rack: [ids]
 *   proposed  the whole table the player wants: [[ids]]
 *   melded    whether the player has already made their first meld
 *   meld      the points the first meld needs
 * Every old tile must still be on the table, every new tile must come from the rack, every set must be valid and, until
 * the first meld, the old sets must be untouched and the new sets (rack tiles only) must be worth `meld` points. With the
 * `playOnMeld` option the meld is the sets that contain no old tile, and once they are worth `meld` points the rest of the
 * table may be rearranged in the same turn. A joker that was on the table keeps what it stood for (see pinnedJokers).
 * Returns { ok, sets (canonical), added: [ids], points (value of the new sets, first meld only) } or { ok: false, error }.
 *
 * @param {object} s  settings
 * @param {object} turn  { before, rack, proposed, melded, meld } as listed above
 * @returns {object} the result described above
 * Side effects: none.
 */
export function checkPlay(s, { before, rack, proposed, melded, meld = DEFAULT_SETTINGS.meld }) {
  const max = totalTiles(s);
  if (!Array.isArray(proposed) || proposed.length > max || proposed.some((set) => !isIdList(s, set))) return fail(msg('errors.notATableLayout'));
  const flat = proposed.flat();
  if (flat.length > max || new Set(flat).size !== flat.length) return fail(msg('errors.tileTwice'));
  const proposedIds = new Set(flat);
  const oldIds = before.flat();
  const missing = oldIds.filter((id) => !proposedIds.has(id));
  if (missing.length) return fail(msg('errors.tilesMissing', { count: missing.length }));
  const oldSet = new Set(oldIds);
  const mine = new Set(rack);
  const added = flat.filter((id) => !oldSet.has(id));
  if (added.some((id) => !mine.has(id))) return fail(msg('errors.onlyFromRack'));
  if (!added.length) return fail(msg('errors.nothingAdded'));

  const sets = [];
  for (let i = 0; i < proposed.length; i++) {
    const resolved = resolveSet(s, proposed[i]);
    if (!resolved.ok) return fail(msg('errors.setProblem', { n: i + 1, reason: resolved.error }));
    sets.push(resolved);
  }

  const jokers = jokerProblem(s, before, proposed, oldSet);
  if (jokers) return fail(jokers);

  let points = 0;
  if (!melded && s.playOnMeld) {
    for (const resolved of sets) if (!resolved.items.some((item) => oldSet.has(item.id))) points += resolved.value;
    if (points < meld) return fail(msg('errors.meldShortOpen', { meld, points }));
  } else if (!melded) {
    // The old sets must be exactly as they were; the rest are the player's own new sets.
    const untouched = new Map();
    for (const set of before) untouched.set(sortedKey(set), (untouched.get(sortedKey(set)) ?? 0) + 1);
    for (const resolved of sets) {
      const key = sortedKey(resolved.items.map((item) => item.id));
      if (untouched.get(key) > 0) untouched.set(key, untouched.get(key) - 1);
      else {
        if (resolved.items.some((item) => oldSet.has(item.id))) return fail(msg('errors.meldUsesTable'));
        points += resolved.value;
      }
    }
    if (points < meld) return fail(msg('errors.meldShort', { meld, points }));
  }
  return { ok: true, sets: sets.map((r) => r.items.map((i) => i.id)), added, points };
}

// ---- what a turn did to the table (for the achievements) ----

/**
 * How many jokers a turn took off the table: those that were on it, stood for a tile, and no longer can in the layout
 * the player made, so a tile that fits has replaced them. Call it with a layout checkPlay has accepted.
 *
 * @param {object} s  settings
 * @param {number[][]} before  the table at the start of the turn
 * @param {number[][]} proposed  the accepted table
 * @returns {number} how many jokers were swapped out
 * Side effects: none.
 */
export function jokersReplaced(s, before, proposed) {
  const pinned = pinnedJokers(s, before);
  const setOf = new Map();
  proposed.forEach((set, i) => set.forEach((id) => setOf.set(id, i)));
  let count = 0;
  for (const [id, options] of pinned) {
    if (!jokerStays(s, proposed[setOf.get(id)], id, options)) count++;
  }
  return count;
}

/**
 * How many tiles already on the table a turn moved from one group to another. Each old set is taken to carry on as the
 * new set that holds most of its tiles; the tiles that ended up anywhere else were moved.
 *
 * @param {number[][]} before  the table at the start of the turn
 * @param {number[][]} proposed  the table at the end
 * @returns {number} the count of moved tiles
 * Side effects: none.
 */
export function tilesMoved(before, proposed) {
  let moved = 0;
  for (const set of before) {
    const best = Math.max(0, ...proposed.map((next) => set.filter((id) => next.includes(id)).length));
    moved += set.length - best;
  }
  return moved;
}
