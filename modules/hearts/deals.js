// How a Hearts hand is dealt and passed for 3 to 7 players. Pure data and helpers, used by the rules (game.js) and by the
// computer players (ai/), so there is one place that knows the variants.
//
// Cards are removed from the 52-card deck so that everyone gets the same number and the whole remaining deck is dealt.
// The Queen of Spades, the Jack of Diamonds and every heart are always kept, so a hand is always worth 26 points.
import { RANKS, fullDeck } from '../../shared/cards.js';

export const MIN_SEATS = 3;
export const MAX_SEATS = 7;
export const DEFAULT_SEATS = 4;

/**
 * Per number of players: the cards taken out of the deck, the cards each player is dealt (which is also the number of
 * tricks), the cards passed, and the passing rotation as offsets to the left (0 is "no passing"): offset 1 is the next
 * player in turn order, offset seats - 1 is the player on the right.
 */
export const DEALS = {
  3: { removed: ['2C'], each: 17, pass: 3, rotation: [1, 2, 0] },
  4: { removed: [], each: 13, pass: 3, rotation: [1, 3, 2, 0] },
  5: { removed: ['2C', '2D'], each: 10, pass: 3, rotation: [1, 2, 3, 4, 0] },
  6: { removed: ['2C', '3C', '2D', '3D'], each: 8, pass: 2, rotation: [1, 2, 3, 4, 5, 0] },
  7: { removed: ['2C', '2D', '3D'], each: 7, pass: 2, rotation: [1, 2, 3, 4, 5, 6, 0] },
};

export const isSeatCount = (n) => Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS;

/** The deal for a number of players (falls back to the four-player deal for a number that is not supported). */
export const dealFor = (seats) => DEALS[seats] ?? DEALS[DEFAULT_SEATS];

/** The deck that is dealt: 52 cards less the removed ones. */
export const deckFor = (seats) => fullDeck().filter((card) => !dealFor(seats).removed.includes(card));

/** The card that must open the first trick: the lowest club still in the deck (the 2 of clubs for 4 players). */
export function openingCard(seats) {
  const removed = dealFor(seats).removed;
  return RANKS.map((rank) => `${rank}C`).find((card) => !removed.includes(card));
}

/** How many tricks a hand has, and how many cards each player is dealt. */
export const tricksFor = (seats) => dealFor(seats).each;
export const passCountFor = (seats) => dealFor(seats).pass;

/** Points in a hand once the Queen of Spades (13) and the 13 hearts are counted. A moon is worth this much. */
export const HAND_POINTS = 26;

/** The offset to the left of the pass on a hand (0: none). */
export function offsetFor(seats, handNumber) {
  const { rotation } = dealFor(seats);
  return rotation[handNumber % rotation.length];
}

/**
 * Names a pass: 'none', 'left', 'right' (the neighbours), 'across' (exactly opposite) or 'left2', 'left3', 'right2'...
 * (that many places away, on whichever side is nearer; 'across' when it is equally far both ways).
 */
export function directionName(seats, offset) {
  const o = ((offset % seats) + seats) % seats;
  if (o === 0) return 'none';
  if (o * 2 === seats) return 'across';
  const [side, distance] = o * 2 < seats ? ['left', o] : ['right', seats - o];
  return distance === 1 ? side : `${side}${distance}`;
}

/** The inverse of directionName: the offset to the left, for a number of players. */
export function offsetOfDirection(seats, direction) {
  if (direction === 'none') return 0;
  if (direction === 'across') return Math.floor(seats / 2);
  const match = /^(left|right)(\d*)$/.exec(String(direction));
  if (!match) return 0;
  const distance = match[2] ? Number(match[2]) : 1;
  return match[1] === 'left' ? distance % seats : (seats - (distance % seats)) % seats;
}

/** Everything the table shows about a pass: its name, side and distance, and a sentence for it. */
export function describePass(seats, offset) {
  const direction = directionName(seats, offset);
  const count = passCountFor(seats);
  const match = /^(left|right)(\d*)$/.exec(direction);
  const distance = direction === 'across' ? Math.floor(seats / 2) : match ? Number(match[2] || 1) : 0;
  const side = direction === 'none' ? 'none' : direction === 'across' ? 'across' : match[1];
  let label;
  if (side === 'none') label = 'No passing this hand';
  else if (side === 'across') label = `Passing ${count} across`;
  else label = distance === 1 ? `Passing ${count} to the ${side}` : `Passing ${count} to the ${side} (${distance} places along)`;
  return { direction, offset, side, distance, count, label };
}
