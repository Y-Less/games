// The counts a simulation collects. Every table is a dense array of Float64 counts indexed by a few small whole-number
// keys (row-major, in the order of `SPEC`), so two runs add together cell by cell: that is how the worker threads'
// results are merged, and how a run is checkpointed and resumed.
//
// Keys are always small numbers: players is stored as players - 3, cards as cards - 1, trump as an index into TRUMPS,
// card as an index into DECK, and so on (see `coordsOf`/`indexOf`). The CSV export (export.js) turns them back into words.
import { fullDeck } from '../../../shared/cards.js';

export const DECK = fullDeck(); // 'AC' ... : the card index used everywhere below
export const CARD_INDEX = new Map(DECK.map((card, i) => [card, i]));
export const TRUMPS = ['H', 'C', 'D', 'S', 'N']; // the trump suit of a round, N for a no-trump round (game rounds go in this order)
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const MAX_CARDS = 7;
export const ESTIMATE_STEPS = 4; // the standard AI's trick estimate is bucketed in quarters of a trick: 0, 0.25 ... 7
export const ESTIMATE_BUCKETS = MAX_CARDS * ESTIMATE_STEPS + 1;
export const KINDS = ['lead', 'follow', 'ruff', 'discard']; // what a play was: led, followed suit, trumped in, or threw off

const BASE = [['players', MAX_PLAYERS - MIN_PLAYERS + 1], ['cards', MAX_CARDS], ['trump', TRUMPS.length]];

/**
 * The tables. `n` counts how often a situation came up, `won` how often it ended in the card winning a trick (or, for
 * `bids`, `hit` how often the nomination was made exactly). Keys are listed in index order.
 *
 *  card        every card dealt:           players, cards, trump, card
 *  cardSuit    ... and how its hand is shaped: + suitLen (cards of its suit you hold, 1-7), higherHeld (cards of that
 *              suit above it that you also hold, 0-6)
 *  cardTrumps  ... or its trumps and voids: + trumpsHeld (trumps in your hand, 0-7), voids (suits you hold none of, 0-3)
 *  play        every card as it is played: players, trump, cardsLeft (in that hand, this one included), position in the trick
 *              (0 leads), kind, card
 *  hand        every hand dealt:           players, cards, trump, seatOrder (0 nominates first, players-1 is the dealer),
 *              estimate (the standard AI's expected tricks, in quarters), taken (tricks it ended up winning)
 *  bids        every nomination made:      players, cards, trump, estimate, nomination
 */
export const SPEC = {
  card: { keys: [...BASE, ['card', 52]], values: ['n', 'won'] },
  cardSuit: { keys: [...BASE, ['card', 52], ['suitLen', 7], ['higherHeld', 7]], values: ['n', 'won'] },
  cardTrumps: { keys: [...BASE, ['card', 52], ['trumpsHeld', 8], ['voids', 4]], values: ['n', 'won'] },
  play: { keys: [BASE[0], BASE[2], ['cardsLeft', 7], ['position', 7], ['kind', 4], ['card', 52]], values: ['n', 'won'] },
  hand: { keys: [...BASE, ['seatOrder', 7], ['estimate', ESTIMATE_BUCKETS], ['taken', MAX_CARDS + 1]], values: ['n'] },
  bids: { keys: [...BASE, ['estimate', ESTIMATE_BUCKETS], ['nomination', MAX_CARDS + 1]], values: ['n', 'hit'] },
};

const sizeOf = (spec) => spec.keys.reduce((product, [, size]) => product * size, 1);

export function indexOf(table, coords) {
  let index = 0;
  const keys = SPEC[table].keys;
  for (let i = 0; i < keys.length; i++) index = index * keys[i][1] + coords[i];
  return index;
}

export function coordsOf(table, index) {
  const keys = SPEC[table].keys;
  const coords = new Array(keys.length);
  for (let i = keys.length - 1; i >= 0; i--) {
    coords[i] = index % keys[i][1];
    index = Math.floor(index / keys[i][1]);
  }
  return coords;
}

export class Stats {
  constructor() {
    this.tables = {};
    for (const [name, spec] of Object.entries(SPEC)) {
      this.tables[name] = Object.fromEntries(spec.values.map((value) => [value, new Float64Array(sizeOf(spec))]));
    }
    this.deals = 0;
  }

  /** Adds one observation: `values` is { n: 1, won: 0 or 1 } (just the ones that apply; n is always counted). */
  add(table, coords, won = 0) {
    const index = indexOf(table, coords);
    const t = this.tables[table];
    t.n[index]++;
    if (won) (t.won ?? t.hit)[index]++;
  }

  merge(other) {
    for (const [name, columns] of Object.entries(this.tables)) {
      for (const [value, array] of Object.entries(columns)) {
        const from = other.tables[name][value];
        for (let i = 0; i < array.length; i++) array[i] += from[i];
      }
    }
    this.deals += other.deals;
  }

  /** Every array in a fixed order, as one Float64Array (for a checkpoint file). */
  toFloats() {
    const arrays = this.#arrays();
    const out = new Float64Array(arrays.reduce((sum, a) => sum + a.length, 0));
    let at = 0;
    for (const array of arrays) {
      out.set(array, at);
      at += array.length;
    }
    return out;
  }

  static fromFloats(floats, deals) {
    const stats = new Stats();
    let at = 0;
    for (const array of stats.#arrays()) {
      array.set(floats.subarray(at, at + array.length));
      at += array.length;
    }
    stats.deals = deals;
    return stats;
  }

  /** What a worker thread sends back: plain typed arrays, which structured cloning handles. */
  toMessage() {
    return { tables: this.tables, deals: this.deals };
  }

  static fromMessage({ tables, deals }) {
    const stats = new Stats();
    for (const [name, columns] of Object.entries(tables)) for (const [value, array] of Object.entries(columns)) stats.tables[name][value].set(array);
    stats.deals = deals;
    return stats;
  }

  #arrays() {
    return Object.entries(SPEC).flatMap(([name, spec]) => spec.values.map((value) => this.tables[name][value]));
  }
}
