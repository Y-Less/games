// The client's working copy of a turn, as plain functions (nothing here talks to the server).
// An arrangement is { sets: [[id, ...], ...], rack: [id, ...], freed: [id, ...] }: what the table and the rack would be if
// the player ended their turn now, and the jokers that have been swapped out of their sets this turn. Every function returns a new arrangement and leaves its argument alone.
import { checkPlay, fitsJoker, isJoker, orderedSet, resolveSet, tileOf } from '../rules.js';

/**
 * The arrangement at the start of a turn: a copy of the table and of the rack, with no jokers freed yet.
 * Copies are made so that later moves can never alter the server's view by accident.
 *
 * @param {number[][]} table  the sets on the table, each a list of tile ids
 * @param {number[]} rack  the ids in the player's rack
 * @returns {{sets: number[][], rack: number[], freed: number[]}} a fresh arrangement
 *
 * Side effects: none.
 */
export const startArrangement = (table, rack) => ({ sets: table.map((set) => [...set]), rack: [...rack], freed: [] });

/**
 * The ids that were on the table when the turn began.
 *
 * @param {number[][]} table  the table's sets as they were at the start of the turn
 * @returns {Set<number>} every tile id on that table
 *
 * Side effects: none.
 */
export const tableIds = (table) => new Set(table.flat());

/**
 * Where a tile is: { place: 'rack' } or { place: 'set', index }.
 *
 * @param {object} arr  an arrangement
 * @param {number} id  the tile id to find
 * @returns {{place: string, index?: number}|null} the tile's place, or null if it is in neither the rack nor a set
 *
 * Side effects: none.
 */
export function locate(arr, id) {
  const index = arr.sets.findIndex((set) => set.includes(id));
  return index === -1 ? (arr.rack.includes(id) ? { place: 'rack' } : null) : { place: 'set', index };
}

/**
 * Which tiles may be moved at all and where they may go.
 *   - A tile that was on the table at the start of the turn can never go back to the rack.
 *   - Before the first meld (`melded` false) the old sets are frozen: their tiles cannot be moved and nothing can be added to them.
 *   - A joker that was on the table (`fixed`: a Set of their ids) cannot be moved at all; it leaves by being swapped for the tile it
 *     stands for (see releaseJokers).
 *
 * @param {object} arr  the current arrangement
 * @param {number[]} ids  the tiles the player wants to move
 * @param {{type: string, index?: number}} target  where they are going: 'rack', 'new' or 'set' (with `index`)
 * @param {{before: number[][], melded: boolean, fixed?: Set<number>}} rules  the table at the start of the turn, whether the
 *   player has made their first meld, and the ids of table jokers that may not be moved
 * @returns {string|null} the reason the move is refused, or null if it is allowed
 *
 * Side effects: none.
 */
export function canMove(arr, ids, target, { before, melded, fixed = new Set() }) {
  const old = tableIds(before);
  const frozen = (set) => !melded && set.some((id) => old.has(id));
  for (const id of ids) {
    const at = locate(arr, id);
    if (!at) return 'That tile is not there.';
    if (fixed.has(id)) return JOKER_STAYS;
    if (!melded && old.has(id)) return 'Until your first meld the sets already on the table cannot be changed.';
    if (target.type === 'rack' && old.has(id)) return 'A tile that was on the table has to stay on it.';
  }
  if (target.type === 'set') {
    const set = arr.sets[target.index];
    if (!set) return 'There is no such set.';
    if (frozen(set)) return 'Until your first meld the sets already on the table cannot be changed.';
  }
  return null;
}

/**
 * Moves tiles to the rack, to the end of set `index`, or into a brand new set.
 * Does not check the rules (see canMove); unknown ids are ignored.
 *
 * @param {object} arr  the current arrangement
 * @param {number[]} ids  the tiles to move (duplicates are ignored)
 * @param {{type: string, index?: number}} target  'rack', 'new' or 'set' with the set's `index`
 * @returns {object} a new arrangement, or `arr` itself when nothing could be moved
 *
 * Side effects: none.
 */
export function moveTiles(arr, ids, target) {
  const moving = [...new Set(ids)].filter((id) => locate(arr, id));
  if (!moving.length) return arr;
  const gone = new Set(moving);
  let sets = arr.sets.map((set) => set.filter((id) => !gone.has(id)));
  let rack = arr.rack.filter((id) => !gone.has(id));
  if (target.type === 'rack') rack = [...rack, ...moving];
  else if (target.type === 'new') sets = [...sets, moving];
  else {
    if (!sets[target.index]) return arr;
    sets[target.index] = [...sets[target.index], ...moving];
  }
  // A set that lost all its tiles disappears; the others keep their places.
  return { sets: sets.filter((set) => set.length), rack, freed: arr.freed ?? [] };
}

/**
 * Dropping a second copy of a tile into a run splits the run there: 2 3 4 5 6 and a second 5 become 2 3 4 5 and 5 6. `prev` is
 * the arrangement before one tile (`id`) was moved and `next` the one after; only a run, valid before, that already has a real tile
 * of that colour and number is split (a joker in the run stays on the side of the number it stands for: 3 * 5 6 7 and a second 6
 * make 3 * 5 6 and 6 7). Returns { arr, number } for the split arrangement, or null if nothing was split.
 *
 * @param {object} s  the game settings (needed to look tiles up)
 * @param {object} prev  the arrangement before the move
 * @param {object} next  the arrangement after the move
 * @param {number} id  the tile that was moved
 * @returns {{arr: object, number: number}|null} the split arrangement and the tile's number, or null
 *
 * Side effects: none.
 */
export function splitRunAtDuplicate(s, prev, next, id) {
  if (isJoker(s, id)) return null;
  const at = next.sets.findIndex((set) => set.includes(id));
  if (at === -1) return null;
  const base = next.sets[at].filter((other) => other !== id);
  const resolved = resolveSet(s, base);
  if (!resolved.ok || resolved.kind !== 'run') return null;
  const tile = tileOf(s, id);
  if (!resolved.items.some((item) => !item.joker && item.number === tile.number && item.colour === tile.colour)) return null;
  const lower = resolved.items.filter((item) => item.number <= tile.number).map((item) => item.id);
  const upper = [id, ...resolved.items.filter((item) => item.number > tile.number).map((item) => item.id)];
  const sets = next.sets.map((set, i) => (i === at ? lower : set));
  sets.push(upper);
  return { arr: { ...next, sets }, number: tile.number };
}

// The refusal shown when someone tries to move a joker that is pinned to the table (see canMove).
export const JOKER_STAYS = 'A joker on the table stays where it is until you swap in the tile it stands for.';

/**
 * A joker that was on the table is replaced as soon as a tile it could stand for is in its set: it moves out into a new group
 * of its own, free to be used in any set. `pinned` is pinnedJokers(...) for the table at the start of the turn. Returns the same
 * arrangement if no joker was replaced.
 *
 * @param {object} s  the game settings
 * @param {object} arr  the current arrangement
 * @param {Map<number, object>} pinned  table jokers (id) mapped to the options of tiles they could stand for
 * @returns {object} a new arrangement with the replaced jokers in their own sets and listed in `freed`, or `arr` unchanged
 *
 * Side effects: none.
 */
export function releaseJokers(s, arr, pinned) {
  const freed = arr.freed ?? [];
  let sets = arr.sets;
  const released = [];
  for (const [id, options] of pinned) {
    if (freed.includes(id) || released.includes(id)) continue;
    const at = sets.findIndex((set) => set.includes(id));
    if (at === -1 || !sets[at].some((other) => other !== id && fitsJoker(s, other, options))) continue;
    sets = sets.map((set, i) => (i === at ? set.filter((x) => x !== id) : set));
    sets.push([id]);
    released.push(id);
  }
  return released.length ? { sets: sets.filter((set) => set.length), rack: arr.rack, freed: [...freed, ...released] } : arr;
}

/**
 * Rack order: 'run' groups by colour then number, 'group' by number then colour; wildcards last.
 *
 * @param {object} s  the game settings
 * @param {number[]} rack  the rack's tile ids
 * @param {string} mode  'group' to sort by number first, anything else sorts by colour first
 * @returns {number[]} a new, sorted list of ids (ties broken by id so the order is stable)
 *
 * Side effects: none.
 */
export function sortRack(s, rack, mode) {
  const key = (id) => {
    const t = tileOf(s, id);
    if (t.joker) return [Infinity, 0, id];
    return mode === 'group' ? [t.number, t.colour, id] : [t.colour, t.number, id];
  };
  return [...rack].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

/**
 * What a set would be: { ok, kind, value, items } with items in the order to draw them, or { ok: false, error }.
 *
 * @param {object} s  the game settings
 * @param {number[]} ids  the set's tile ids
 * @returns {object} the rules' verdict on the set (a one-line wrapper around resolveSet)
 *
 * Side effects: none.
 */
const describeSet = (s, ids) => resolveSet(s, ids);

/**
 * The ids on the table now that were not there at the start of the turn: the ones to mark as "yours this turn".
 *
 * @param {object} arr  the current arrangement
 * @param {number[][]} before  the table at the start of the turn
 * @returns {Set<number>} ids that are in a set now but were not on the table before
 *
 * Side effects: none.
 */
export function placedThisTurn(arr, before) {
  const old = tableIds(before);
  return new Set(arr.sets.flat().filter((id) => !old.has(id)));
}

/**
 * Whether two arrangements are the same layout: identical sets in identical order, and the same rack ignoring its order
 * (so merely re-sorting the rack does not count as a change). `freed` is deliberately not compared.
 *
 * @param {object} a  one arrangement
 * @param {object} b  another arrangement
 * @returns {boolean} true when the layouts match
 *
 * Side effects: none.
 */
export const sameArrangement = (a, b) => JSON.stringify(a.sets) === JSON.stringify(b.sets) && [...a.rack].sort((x, y) => x - y).join() === [...b.rack].sort((x, y) => x - y).join();

/**
 * Everything the buttons need to know: whether End turn would be accepted (the same check the server makes), why not,
 * how each set looks and how many tiles have been played.
 *
 * @param {object} s  the game settings
 * @param {{arr: object, before: number[][], rack: number[], melded: boolean, meld: number}} state  the arrangement, the table and
 *   rack at the start of the turn, whether the player has already melded, and the points the first meld needs
 * @returns {{ok: boolean, error: string, sets: object[], placed: number, badSets: number, points: number}} the verdict, the
 *   refusal text (empty when ok), each set's description, tiles placed, count of invalid sets and the points of new sets
 *   (0 once melded, as they no longer matter)
 *
 * Side effects: none.
 */
export function turnStatus(s, { arr, before, rack, melded, meld }) {
  const sets = arr.sets.map((ids) => describeSet(s, ids));
  const check = checkPlay(s, { before, rack, proposed: arr.sets, melded, meld });
  const placed = placedThisTurn(arr, before).size;
  const badSets = sets.filter((r) => !r.ok).length;
  const points = melded ? 0 : sets.reduce((sum, r, i) => (r.ok && !arr.sets[i].some((id) => before.flat().includes(id)) ? sum + r.value : sum), 0);
  return { ok: check.ok, error: check.ok ? '' : check.error, sets, placed, badSets, points };
}
