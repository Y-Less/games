// The sharpest computer player. It uses the unlimited table search of the classic player but values tiles differently:
//   - every tile played is worth the same big amount, so it plays the most tiles it can each turn (and goes out when it can);
//   - a joker costs more than it earns, so it is held back unless it takes part in a play of several tiles, or it lets the
//     player go out, or an opponent is close to going out (then nothing is held back);
//   - among equal plays it gets rid of the awkward tiles (near the ends of the number range) and keeps the flexible middle ones;
//   - when the pool is empty, or an opponent is close to going out, high tiles are played first (they cost the most if stuck).
import { SEARCH_BUDGET, firstLegal, meldAttempts, shuffleAttempts, standardAttempts } from '../search.js';

const BIG = 1000;
const HOLD = -2500; // a joker is only used when the rest of the play is worth more than this (three other tiles)
const DANGER = 3; // an opponent with this many tiles or fewer is about to win

function weightsFor(s, urgent) {
  const kinds = s.numbers * s.colours;
  const mid = (s.numbers + 1) / 2;
  const weights = new Int32Array(kinds);
  for (let k = 0; k < kinds; k++) {
    const n = (k % s.numbers) + 1;
    weights[k] = BIG + Math.round(Math.abs(n - mid) * 2) + (urgent ? n * 8 : 0);
  }
  return weights;
}

function plan(room, seat, { budget = SEARCH_BUDGET } = {}) {
  const s = room.settings;
  const rack = room.racks[seat];
  const rivals = room.racks.flatMap((r, i) => (i === seat ? [] : [r.length]));
  const closest = rivals.length ? Math.min(...rivals) : Infinity;
  const emptyPool = room.pool ? room.pool.length === 0 : false;
  const urgent = closest <= DANGER || emptyPool;
  const weights = weightsFor(s, urgent);
  const jokerFree = BIG + (urgent ? 30 * 8 : 0);
  // everything it can find: the whole table rebuilt, new sets only, and every way of moving up to 20 table tiles
  const attemptsWith = (jokerWeight, rackIds) =>
    room.melded[seat]
      ? [
          ...standardAttempts(room, seat, { budget, weights, jokerWeight }),
          ...shuffleAttempts(room, seat, { tableTiles: 20, weights, jokerWeight, extendJokers: jokerWeight > 0 }),
        ]
      : meldAttempts(room, seat, { budget, weights, jokerWeight, rackIds });

  const free = firstLegal(room, seat, attemptsWith(jokerFree, rack));
  if (!free) return null;
  if (free.added === rack.length) return free; // goes out
  if (urgent) return free;
  const jokers = rack.filter((id) => id >= s.numbers * s.colours * 2);
  if (!jokers.length) return free;
  // try to do without jokers
  const held = room.melded[seat]
    ? firstLegal(room, seat, attemptsWith(HOLD, rack))
    : firstLegal(room, seat, attemptsWith(HOLD, rack.filter((id) => !jokers.includes(id))));
  if (held) return held;
  // only jokers make a play possible: worth it to meld, or for a big play
  return !room.melded[seat] || free.added >= 4 ? free : null;
}

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'Plays as many tiles as it can, saves its jokers for a big play or going out, and races when someone is close to winning.',
  weight: 1,
  plan,
};
