// How a Hearts hand is dealt and passed for 3 to 7 players. Pure data and helpers, used by the rules (game.js) and by the
// computer players (ai/), so there is one place that knows the variants.
//
// Cards are removed from the 52-card deck so that everyone gets the same number and the whole remaining deck is dealt.
// The Queen of Spades, the Jack of Diamonds and every heart are always kept, so a hand is always worth 26 points.
import { RANKS, fullDeck } from '../../shared/cards.js';
import { msg } from '../../shared/messages.js';

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

/**
 * Whether a value is a supported number of players.
 * @param {*} n  value to test.
 * @returns {boolean} true for an integer from MIN_SEATS to MAX_SEATS.
 * Side effects: none.
 */
export const isSeatCount = (n) => Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS;

/**
 * The deal for a number of players (falls back to the four-player deal for a number that is not supported).
 * @param {number} seats  number of players.
 * @returns {{removed: string[], each: number, pass: number, rotation: number[]}} the DEALS entry.
 * Side effects: none.
 */
export const dealFor = (seats) => DEALS[seats] ?? DEALS[DEFAULT_SEATS];

/**
 * The deck that is dealt: 52 cards less the removed ones.
 * @param {number} seats  number of players.
 * @returns {string[]} card codes in the deck.
 * Side effects: none.
 */
export const deckFor = (seats) => fullDeck().filter((card) => !dealFor(seats).removed.includes(card));

/**
 * The card that must open the first trick: the lowest club still in the deck (the 2 of clubs for 4 players).
 * @param {number} seats  number of players.
 * @returns {string} card code.
 * Side effects: none.
 */
export function openingCard(seats) {
  const removed = dealFor(seats).removed;
  return RANKS.map((rank) => `${rank}C`).find((card) => !removed.includes(card));
}

/**
 * How many tricks a hand has, which is also how many cards each player is dealt.
 * @param {number} seats  number of players.
 * @returns {number} tricks per hand.
 * Side effects: none.
 */
export const tricksFor = (seats) => dealFor(seats).each;
/**
 * How many cards each player passes.
 * @param {number} seats  number of players.
 * @returns {number} cards passed (3, or 2 with 6 or 7 players).
 * Side effects: none.
 */
export const passCountFor = (seats) => dealFor(seats).pass;

/** Points in a hand once the Queen of Spades (13) and the 13 hearts are counted. A moon is worth this much. */
export const HAND_POINTS = 26;

/**
 * The offset to the left of the pass on a hand (0: none).
 * @param {number} seats  number of players.
 * @param {number} handNumber  zero-based hand index; the rotation repeats.
 * @returns {number} places to the left that cards go.
 * Side effects: none.
 */
export function offsetFor(seats, handNumber) {
  const { rotation } = dealFor(seats);
  return rotation[handNumber % rotation.length];
}

/**
 * Names a pass: 'none', 'left', 'right' (the neighbours), 'across' (exactly opposite) or 'left2', 'left3', 'right2'...
 * (that many places away, on whichever side is nearer; 'across' when it is equally far both ways).
 * @param {number} seats  number of players.
 * @param {number} offset  places to the left (any integer; reduced modulo seats).
 * @returns {string} the direction name.
 * Side effects: none.
 */
export function directionName(seats, offset) {
  const o = ((offset % seats) + seats) % seats;
  if (o === 0) return 'none';
  if (o * 2 === seats) return 'across';
  const [side, distance] = o * 2 < seats ? ['left', o] : ['right', seats - o];
  return distance === 1 ? side : `${side}${distance}`;
}

/**
 * The inverse of directionName: the offset to the left, for a number of players.
 * @param {number} seats  number of players.
 * @param {string} direction  a name from directionName; unrecognised names mean no pass.
 * @returns {number} places to the left (0 for none).
 * Side effects: none.
 */
export function offsetOfDirection(seats, direction) {
  if (direction === 'none') return 0;
  if (direction === 'across') return Math.floor(seats / 2);
  const match = /^(left|right)(\d*)$/.exec(String(direction));
  if (!match) return 0;
  const distance = match[2] ? Number(match[2]) : 1;
  return match[1] === 'left' ? distance % seats : (seats - (distance % seats)) % seats;
}

/**
 * Everything the table shows about a pass: its name, side and distance, and a sentence for it (a message under the
 * game's `pass.*` keys, see shared/messages.js).
 * @param {number} seats  number of players.
 * @param {number} offset  places to the left that cards go.
 * @returns {{direction: string, offset: number, side: string, distance: number, count: number, label: object}} description.
 * Side effects: none.
 */
export function describePass(seats, offset) {
  const direction = directionName(seats, offset);
  const count = passCountFor(seats);
  const match = /^(left|right)(\d*)$/.exec(direction);
  const distance = direction === 'across' ? Math.floor(seats / 2) : match ? Number(match[2] || 1) : 0;
  const side = direction === 'none' ? 'none' : direction === 'across' ? 'across' : match[1];
  let label;
  if (side === 'none') label = msg('pass.none');
  else if (side === 'across') label = msg('pass.across', { count });
  else label = distance === 1 ? msg('pass.side', { count, side: msg(`pass.${side}`) }) : msg('pass.sideFar', { count, side: msg(`pass.${side}`), distance });
  return { direction, offset, side, distance, count, label };
}
