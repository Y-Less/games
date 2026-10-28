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

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 14;
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
export const MIN_TIMER = 15; // seconds; a timer shorter than this (but not off) is raised to it
export const DEFAULT_SETTINGS = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0, playOnMeld: false };

export const COLOUR_NAMES = ['Red', 'Blue', 'Orange', 'Black', 'Green', 'Purple', 'Teal', 'Pink'];

const fail = (error) => ({ ok: false, error });
const isInt = Number.isSafeInteger;

// ---- the tiles ----

export const numberedCount = (s) => 2 * s.colours * s.numbers;
export const totalTiles = (s) => numberedCount(s) + s.wildcards;
export const isJoker = (s, id) => id >= numberedCount(s);
export const validTile = (s, id) => isInt(id) && id >= 0 && id < totalTiles(s);

/** { joker: true } or { joker: false, colour, number } (colour 0..C-1, number 1..N). */
export function tileOf(s, id) {
  if (isJoker(s, id)) return { joker: true, colour: null, number: null };
  const within = id % (s.colours * s.numbers);
  return { joker: false, colour: Math.floor(within / s.numbers), number: (within % s.numbers) + 1 };
}

/** The points a tile costs while it is still in a rack (a joker is 30). */
export const tileValue = (s, id) => (isJoker(s, id) ? JOKER_VALUE : tileOf(s, id).number);
export const rackValue = (s, ids) => ids.reduce((sum, id) => sum + tileValue(s, id), 0);

export const tileName = (s, id) => {
  const t = tileOf(s, id);
  return t.joker ? 'a joker' : `${COLOUR_NAMES[t.colour]} ${t.number}`;
};

// ---- the deal ----

/** How many tiles each player is dealt: 14, or fewer when the tiles would not leave a pool at least that big. */
export const dealSize = (s, players) => Math.min(HAND_SIZE, Math.floor(totalTiles(s) / (players + 1)));

/** Why a game with these settings cannot be played by this many people, or null. */
export function startProblem(s, players) {
  if (s.numbers < MIN_SET && s.colours < MIN_SET) return 'With so few numbers and colours no run or group can be made. Choose at least 3 numbers or 3 colours.';
  const hand = dealSize(s, players);
  if (hand < MIN_DEAL) {
    return `There are only ${totalTiles(s)} tiles, too few to deal ${players} players a playable hand (at least ${MIN_DEAL} each, with a pool as big). Add numbers, colours or wildcards, or remove players.`;
  }
  return null;
}

// ---- settings ----

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/** Checks and clamps host-chosen settings over `current`. Unknown keys are ignored; a non-number is an error. */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...DEFAULT_SETTINGS, ...current };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: true, settings: next };
  const labels = { numbers: 'Numbers per colour', colours: 'Colours', wildcards: 'Wildcards', rounds: 'Rounds', meld: 'First meld points', timer: 'Turn timer' };
  for (const key of Object.keys(LIMITS)) {
    if (!Object.hasOwn(input, key) || input[key] === undefined) continue;
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${labels[key]} must be a number.`);
    let n = clamp(Math.round(value), LIMITS[key]);
    if (key === 'timer' && n > 0) n = Math.max(MIN_TIMER, n);
    next[key] = n;
  }
  if (Object.hasOwn(input, 'playOnMeld') && input.playOnMeld !== undefined) {
    if (typeof input.playOnMeld !== 'boolean') return fail('Play on after melding must be on or off.');
    next.playOnMeld = input.playOnMeld;
  }
  return { ok: true, settings: next };
}

// ---- sets ----

const sortedKey = (ids) => [...ids].sort((a, b) => a - b).join(',');

function asRun(s, tiles) {
  const reals = tiles.filter((t) => !t.joker);
  if (reals.some((t) => t.colour !== reals[0].colour)) return fail('A run is all one colour.');
  const numbers = reals.map((t) => t.number);
  if (new Set(numbers).size !== numbers.length) return fail('A run cannot repeat a number.');
  const len = tiles.length;
  if (len > s.numbers) return fail(`A run cannot be longer than ${s.numbers} tiles.`);
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (high - low + 1 > len) return fail('Those numbers are too far apart for the jokers to bridge.');
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

function asGroup(s, tiles) {
  const reals = tiles.filter((t) => !t.joker);
  if (reals.some((t) => t.number !== reals[0].number)) return fail('A group is all one number.');
  const colours = reals.map((t) => t.colour);
  if (new Set(colours).size !== colours.length) return fail('A group needs a different colour for every tile.');
  if (tiles.length > s.colours) return fail(`A group cannot have more than ${s.colours} tiles (one per colour).`);
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
 */
export function resolveSet(s, ids) {
  if (!Array.isArray(ids) || ids.length < MIN_SET) return fail(`A set needs at least ${MIN_SET} tiles.`);
  if (ids.some((id) => !validTile(s, id)) || new Set(ids).size !== ids.length) return fail('That is not a set of tiles.');
  const tiles = ids.map((id) => ({ id, ...tileOf(s, id) }));
  if (!tiles.some((t) => !t.joker)) return fail('A set cannot be made only of jokers.');
  const run = asRun(s, tiles);
  const group = asGroup(s, tiles);
  if (run.ok && group.ok) return group.value > run.value ? group : run;
  if (run.ok) return run;
  if (group.ok) return group;
  const reals = tiles.filter((t) => !t.joker);
  if (reals.length > 1 && reals.every((t) => t.colour === reals[0].colour)) return run;
  if (reals.length > 1 && reals.every((t) => t.number === reals[0].number)) return group;
  if (reals.length === 1) return fail('Those tiles do not make a run or a group.');
  return fail('A set is a run (one colour, consecutive numbers) or a group (one number, different colours).');
}

/** The canonical order of a valid set, or the ids as they are when it is not valid (the client keeps unfinished sets). */
export const orderedSet = (s, ids) => {
  const r = resolveSet(s, ids);
  return r.ok ? r.items.map((i) => i.id) : ids;
};

// ---- a whole turn ----

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
 * table may be rearranged in the same turn.
 * Returns { ok, sets (canonical), added: [ids], points (value of the new sets, first meld only) } or { ok: false, error }.
 */
export function checkPlay(s, { before, rack, proposed, melded, meld = DEFAULT_SETTINGS.meld }) {
  const max = totalTiles(s);
  if (!Array.isArray(proposed) || proposed.length > max || proposed.some((set) => !isIdList(s, set))) return fail('That is not a table layout.');
  const flat = proposed.flat();
  if (flat.length > max || new Set(flat).size !== flat.length) return fail('A tile appears twice in that layout.');
  const proposedIds = new Set(flat);
  const oldIds = before.flat();
  const missing = oldIds.filter((id) => !proposedIds.has(id));
  if (missing.length) return fail(`${missing.length === 1 ? 'A tile' : `${missing.length} tiles`} from the table ${missing.length === 1 ? 'is' : 'are'} missing: everything on the table must stay on it.`);
  const oldSet = new Set(oldIds);
  const mine = new Set(rack);
  const added = flat.filter((id) => !oldSet.has(id));
  if (added.some((id) => !mine.has(id))) return fail('You can only add tiles from your own rack.');
  if (!added.length) return fail('You have not added any tiles. Draw a tile instead.');

  const sets = [];
  for (let i = 0; i < proposed.length; i++) {
    const resolved = resolveSet(s, proposed[i]);
    if (!resolved.ok) return fail(`Set ${i + 1}: ${resolved.error}`);
    sets.push(resolved);
  }

  let points = 0;
  if (!melded && s.playOnMeld) {
    for (const resolved of sets) if (!resolved.items.some((item) => oldSet.has(item.id))) points += resolved.value;
    if (points < meld) return fail(`Your first meld must be worth at least ${meld} points from new sets of your own tiles; those are worth ${points}.`);
  } else if (!melded) {
    // The old sets must be exactly as they were; the rest are the player's own new sets.
    const untouched = new Map();
    for (const set of before) untouched.set(sortedKey(set), (untouched.get(sortedKey(set)) ?? 0) + 1);
    for (const resolved of sets) {
      const key = sortedKey(resolved.items.map((item) => item.id));
      if (untouched.get(key) > 0) untouched.set(key, untouched.get(key) - 1);
      else {
        if (resolved.items.some((item) => oldSet.has(item.id))) return fail('Before your first meld you cannot use tiles that are already on the table.');
        points += resolved.value;
      }
    }
    if (points < meld) return fail(`Your first meld must be worth at least ${meld} points from your own tiles; this one is worth ${points}.`);
  }
  return { ok: true, sets: sets.map((r) => r.items.map((i) => i.id)), added, points };
}
