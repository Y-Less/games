// Who draws against whom, and in what order.  A game of Draw! plays every pair of players once (a `round`, and the
// host may ask for several), and the one rule the order has to keep is that nobody draws three turns running: drawing
// is work, and three in a row is a chore rather than a game.
//
// The order comes from the circle method, the usual way of scheduling a round-robin tournament: the players stand in a
// circle, one is held still and the rest rotate, and each *rotation* pairs everybody off at once.  That gives n-1 (or
// n, for an odd table) rotations, each of which has every player in exactly one pair.  Emitting the pairs a rotation
// at a time is what keeps the rule: three turns running can only ever reach into two rotations, and a player is in
// each rotation once, so two in a row is the most anybody can draw.
//
// (A rotation is not a turn and not a round: a turn is one pair drawing, and a round is every pair having drawn once,
// which is the whole circle.)
//
// Depends on: nothing.

/**
 * Every pair of players, grouped into rotations: within one rotation, each player appears exactly once.
 *
 * @param {Array<number | string>} ids  the players, at least two of them
 * @returns {Array<Array<[number | string, number | string]>>} the rotations, each a list of pairs
 * Side effects: none.
 */
export function circle(ids) {
  // An odd table is made even with a bye, which is simply left out of the pairs: whoever draws it sits that rotation out.
  const BYE = Symbol('bye');
  const wheel = ids.length % 2 ? [...ids, BYE] : [...ids];
  const n = wheel.length;
  const turns = [];
  for (let turn = 0; turn < n - 1; turn++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = wheel[i];
      const b = wheel[n - 1 - i];
      if (a !== BYE && b !== BYE) pairs.push([a, b]);
    }
    turns.push(pairs);
    // Hold the first in place and rotate the rest one step, which is the circle method.
    wheel.splice(1, 0, wheel.pop());
  }
  return turns;
}

/**
 * A copy of a list in a random order (Fisher-Yates).
 * @param {Array} items  not changed
 * @param {() => number} rng  random source
 * @returns {Array} the shuffled copy
 * Side effects: none beyond advancing `rng`.
 */
function shuffled(items, rng) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * The turns of a whole game: every pair of players, `rounds` times over, in an order nobody draws three times running
 * in.
 *
 * The rotations are shuffled, and so are the pairs inside each one, which is free: whatever the order of the
 * rotations, a player is in each of them once, so three consecutive turns (which can only reach into two rotations)
 * can hold them at most twice.
 *
 * A table of three is the exception, because its rotations are one pair each and so a rotation gives no separation at
 * all: there the circle's own order is kept, rotated to a random starting point and then simply repeated.  That order
 * is one in which each player sits out every third turn, so no three in a row, and repeating it keeps that true across
 * the join - which re-rotating for each round would not.
 *
 * @param {Array<number | string>} ids  the players, at least two of them
 * @param {number} rounds  how many times the whole set of pairs is played
 * @param {() => number} rng  random source
 * @returns {Array<[number | string, number | string]>} the pairs, in the order they are drawn
 * Side effects: none beyond advancing `rng`.
 */
export function pairings(ids, rounds, rng) {
  const rotations = circle(ids);
  if (!rotations.length) return [];
  const single = rotations.every((pairs) => pairs.length <= 1); // a table of three (or two): one pair a rotation
  const fixed = single ? rotated(rotations, Math.floor(rng() * rotations.length)) : null;
  const turns = [];
  for (let round = 0; round < rounds; round++) {
    const order = fixed ?? shuffled(rotations, rng);
    for (const pairs of order) turns.push(...(fixed ? pairs : shuffled(pairs, rng)).map((pair) => shuffled(pair, rng)));
  }
  return turns;
}

/**
 * A list turned so that it begins at `from`, keeping the order it goes round in.
 * @param {Array} items  not changed
 * @param {number} from  where to start
 * @returns {Array} the rotated copy
 * Side effects: none.
 */
const rotated = (items, from) => [...items.slice(from), ...items.slice(0, from)];

/**
 * Does anybody draw three turns running?  The rules use it to be sure of an order; the tests use it to check one.
 * @param {Array<[number | string, number | string]>} turns  the pairs in order
 * @returns {boolean} true when nobody is in three consecutive pairs
 * Side effects: none.
 */
export function restful(turns) {
  for (let i = 0; i + 2 < turns.length; i++) {
    for (const id of turns[i]) if (turns[i + 1].includes(id) && turns[i + 2].includes(id)) return false;
  }
  return true;
}
