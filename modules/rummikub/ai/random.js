// The weakest computer player: it picks one legal move at random (a random new set or a random tile added to a set on the
// table), and draws when it has none. Before its first meld it plays random sets until they are worth enough.
// Depends on ../rules.js (resolveSet to validate a set, checkPlay as the final judge) and the shared random helpers. It
// never rearranges the table, which is what keeps it weak: it only ever appends a set or a single tile.
import { checkPlay, resolveSet } from '../rules.js';
import { shuffle } from '../../../shared/cards.js';
import { pickOne } from '../../../shared/random.js';

/**
 * Chooses a random legal play for a seat: before its first meld, random disjoint new sets worth at least the meld
 * threshold; afterwards one random move (a new set of three, or one rack tile added to a table set).
 *
 * @param {object} room  the seat's situation (bot.js): its own rack and the table; not changed
 * @param {number} seat  the seat to play for
 * @param {object} options
 * @param {() => number} options.rng  random numbers in [0, 1); required, as for every AI (no fallback to Math.random)
 * @returns {{ table: number[][], added: number, value: number } | null} the whole proposed table and how many rack tiles it
 *   uses (value is always 0: this AI does not score plays), or null to draw
 * Side effects: none beyond advancing `rng`.
 */
function plan(room, seat, { rng } = {}) {
  if (typeof rng !== 'function') throw new TypeError('The Random AI needs an rng.');
  const s = room.settings;
  const rack = room.racks[seat];
  const table = room.table;
  const melded = room.melded[seat];
  // every legal new set of three from the rack
  const triples = [];
  for (let i = 0; i < rack.length; i++) {
    for (let j = i + 1; j < rack.length; j++) {
      for (let k = j + 1; k < rack.length; k++) {
        const set = [rack[i], rack[j], rack[k]];
        const r = resolveSet(s, set);
        if (r.ok) triples.push({ ids: r.items.map((x) => x.id), value: r.value });
      }
    }
  }
  let proposed = null;
  if (!melded) {
    // random disjoint sets until they are worth the threshold
    const order = shuffle(triples, rng);
    const used = new Set();
    const sets = [];
    let points = 0;
    for (const t of order) {
      if (t.ids.some((id) => used.has(id))) continue;
      t.ids.forEach((id) => used.add(id));
      sets.push(t.ids);
      points += t.value;
      if (points >= s.meld) break;
    }
    if (points >= s.meld && sets.length) proposed = [...table, ...sets];
  } else {
    const moves = triples.map((t) => [...table, t.ids]);
    table.forEach((set, index) => {
      for (const id of rack) {
        if (resolveSet(s, [...set, id]).ok) moves.push(table.map((x, i) => (i === index ? [...x, id] : x)));
      }
    });
    if (moves.length) proposed = pickOne(moves, rng);
  }
  if (!proposed) return null;
  // Belt and braces: the rules' own check has the last word, so a bug above can only cost this AI a turn, never the game.
  const checked = checkPlay(s, { before: table, rack, proposed, melded, meld: s.meld });
  return checked.ok ? { table: proposed, added: checked.added.length, value: 0 } : null;
}

export default {
  id: 'random',
  name: 'Random',
  description: 'Plays any legal move it happens to find, chosen at random.',
  weight: 0.5,
  plan,
};
