// Helpers shared by the Hearts AIs. Everything here works on plain data (see the context described in index.js) and
// knows nothing about rooms or sockets. No Math.random: a game passes its own `rng` in the context.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { DEFAULT_SEATS, deckFor, tricksFor } from '../deals.js';

// The number of players varies (3 to 7), so nothing here is a constant: the context says how many seats, tricks and
// pass cards this game has (seatCount, trickCount, passCount); a context without them is a four-player one.
export const seatsIn = (ctx) => ctx.seatCount ?? ctx.taken?.length ?? DEFAULT_SEATS;
export const tricksIn = (ctx) => ctx.trickCount ?? tricksFor(seatsIn(ctx));
export const passSize = (ctx) => ctx.passCount ?? 3;
export const QUEEN = 'QS';
export const JACK = 'JD';
export const SUIT_LIST = ['C', 'D', 'H', 'S'];

export const isHeart = (card) => suitOf(card) === 'H';
export const isPointCard = (card) => isHeart(card) || card === QUEEN;
export const lowest = (cards) => cards.reduce((a, b) => (rankValue(b) < rankValue(a) ? b : a));
export const highest = (cards) => cards.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
export const bySuit = (cards, suit) => cards.filter((c) => suitOf(c) === suit);

/** What a card scores whoever takes it: 1 per heart, 13 for the Queen of Spades, -5 for the Jack when that option is on. */
export function cardPoints(card, settings) {
  if (isHeart(card)) return 1;
  if (card === QUEEN) return 13;
  if (card === JACK && settings?.jackOfDiamonds) return -5;
  return 0;
}

/** Keeps the cards that satisfy `keep`, unless that would leave none. */
export function preferring(cards, keep) {
  const kept = cards.filter(keep);
  return kept.length ? kept : cards;
}
/** Drops the cards that satisfy `unwanted`, unless that would leave none. */
export const avoiding = (cards, unwanted) => preferring(cards, (c) => !unwanted(c));

/** Every card taken in a finished trick so far this hand, plus the ones on the table. */
export const playedSet = (ctx) => new Set([...ctx.taken.flat(), ...ctx.trick.map((p) => p.card)]);

/** The seat that is winning a (possibly unfinished) trick: the highest card of the suit led. */
export function winningPlay(trick) {
  const led = suitOf(trick[0].card);
  return trick.reduce((best, play) => (suitOf(play.card) === led && rankValue(play.card) > rankValue(best.card) ? play : best), trick[0]);
}

/**
 * Card counting. Returns what can be known without seeing anybody else's hand:
 *  played   every card gone from play (finished tricks and the table)
 *  unseen   the cards that are not in my hand and have not been played: they are in other hands
 *  voids    per seat, the suits that seat is known to be out of (it failed to follow a suit that was led)
 *  sizes    per seat, how many cards that seat still holds
 */
export function observe(ctx) {
  const played = playedSet(ctx);
  const mine = new Set(ctx.hand);
  const seats = seatsIn(ctx);
  const unseen = new Set();
  for (const card of deckFor(seats)) if (!played.has(card) && !mine.has(card)) unseen.add(card);
  const voids = Array.from({ length: seats }, () => new Set());
  const note = (plays) => {
    if (!plays.length) return;
    const led = suitOf(plays[0].card);
    for (const play of plays) if (suitOf(play.card) !== led) voids[play.seat].add(led);
  };
  for (const entry of ctx.history ?? []) note(entry.plays);
  note(ctx.trick);
  const onTable = new Set(ctx.trick.map((p) => p.seat));
  const sizes = Array.from({ length: seats }, (_, s) => tricksIn(ctx) - ctx.tricksPlayed - (onTable.has(s) ? 1 : 0));
  return { played, unseen, voids, sizes };
}

export const unseenOf = (know, suit) => [...know.unseen].filter((c) => suitOf(c) === suit);

/** The next seat to play after `seat`. */
export const after = (seat, n = 1, seats = DEFAULT_SEATS) => (seat + n) % seats;

/** The seats that have taken a heart or the Queen of Spades this hand. A moon needs this to stay at one seat. */
export const pointTakers = (ctx) => new Set(ctx.taken.flatMap((cards, s) => (cards.some(isPointCard) ? [s] : [])));
