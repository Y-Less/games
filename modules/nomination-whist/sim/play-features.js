// The features of a card-play decision, boiled down to small whole numbers so that the learned play table can be a flat
// array. Used both by the collector that learns the table (play-collect.js) and by the AI that reads it (ai/lut.js), so the
// two can never disagree. Pure functions of the AI context (what the game tells every AI): nothing here sees other hands.
//
// A decision is described by the situation and by one candidate card:
//   situation  players, my need (tricks nominated minus won, below 0 = already missed), my slack (tricks I could still lose
//              and make it), how many players play after me, whether the round has trumps  [the "coarse" key]
//   table      who is winning the trick so far and whether they still want tricks, and how many players after me still
//              want a trick or have already made their number (and so would be hurt by winning one) [added in the "fine" key]
//   card       led / followed / trumped in / discarded, whether it beats the table now, whether it is a trump, and how many
//              unseen cards of its suit outrank it (0 = it is a master)
import { rankValue, suitOf } from '../../../shared/cards.js';
import { unseenCards, winningCard } from '../ai/cards.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;

// [name, size] in index order (first is the slowest-changing digit).
const COARSE_SITUATION = [['players', 5], ['need', 5], ['slack', 4], ['after', 4], ['regime', 2]];
const TABLE = [['winner', 4], ['wantAfter', 3], ['madeAfter', 3]];
const CARD = [['role', 4], ['beats', 2], ['rank', 4], ['trumpCard', 2]];

const sizeOf = (spec) => spec.reduce((product, [, size]) => product * size, 1);
export const SIZES = {
  coarseSituation: sizeOf(COARSE_SITUATION),
  table: sizeOf(TABLE),
  card: sizeOf(CARD),
};
/** Cells in the coarse table (situation x card) and the fine table (situation x table x card). */
export const COARSE_CELLS = SIZES.coarseSituation * SIZES.card;
export const FINE_CELLS = SIZES.coarseSituation * SIZES.table * SIZES.card;

const clip = (n, max) => Math.max(0, Math.min(max, n));
const compose = (digits, spec) => digits.reduce((index, digit, i) => index * spec[i][1] + digit, 0);

/** What a player wants from the trick: 0 more tricks needed, 1 has made its number exactly, 2 has missed already. */
const wantOf = (need) => (need > 0 ? 0 : need === 0 ? 1 : 2);

/** The part of the key that is the same for every candidate card of one decision. */
export function situation(ctx) {
  const { players, hand, trick, trump, need, nominations, taken, trickPlays = [], seat } = ctx;
  const after = players - trick.length - 1;
  const needBucket = need < 0 ? 0 : Math.min(need, 3) + 1;
  const slack = need < 0 ? 3 : clip(hand.length - need, 3);
  const coarse = compose([players - MIN_PLAYERS, needBucket, slack, Math.min(after, 3), trump ? 1 : 0], COARSE_SITUATION);

  let winner = 3; // nobody yet: this player leads
  if (trick.length) {
    const holder = trickPlays.find((p) => p.card === winningCard(trick, trump));
    winner = wantOf(nominations[holder.seat] - taken[holder.seat]);
  }
  let wantAfter = 0;
  let madeAfter = 0;
  for (let i = 1; i <= after; i++) {
    const s = (seat + i) % players;
    const want = wantOf(nominations[s] - taken[s]);
    if (want === 0) wantAfter++;
    else if (want === 1) madeAfter++;
  }
  return { coarse, fineTable: compose([winner, Math.min(wantAfter, 2), Math.min(madeAfter, 2)], TABLE) };
}

/** The part of the key that is about one candidate card. `unseen` is unseenCards(hand, played), computed once per decision. */
export function cardPart(ctx, card, unseen) {
  const { trick, trump } = ctx;
  const suit = suitOf(card);
  const isTrump = trump !== null && suit === trump;
  const role = !trick.length ? 0 : suit === suitOf(trick[0]) ? 1 : isTrump ? 2 : 3;
  const beats = trick.length && winningCard([...trick, card], trump) === card ? 1 : 0;
  const higher = unseen.filter((c) => suitOf(c) === suit && rankValue(c) > rankValue(card)).length;
  return compose([role, beats, Math.min(higher, 3), isTrump ? 1 : 0], CARD);
}

/** Both table indexes for each legal card of a decision: [{ card, coarse, fine }]. */
export function keysFor(ctx) {
  const { coarse, fineTable } = situation(ctx);
  const unseen = unseenCards(ctx.hand, ctx.played);
  return ctx.legal.map((card) => {
    const part = cardPart(ctx, card, unseen);
    return { card, coarse: coarse * SIZES.card + part, fine: (coarse * SIZES.table + fineTable) * SIZES.card + part };
  });
}

/** The coarse cell that a fine cell refines: the same situation and card, with the table state dropped. */
export function coarseOfFine(fine) {
  const part = fine % SIZES.card;
  const situationIndex = Math.floor(fine / (SIZES.card * SIZES.table));
  return situationIndex * SIZES.card + part;
}
