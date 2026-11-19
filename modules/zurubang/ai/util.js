// What every Zurubang computer player needs to weigh a card, a hand, and a position.  Nothing here touches the clock,
// a socket, or Math.random: the game passes an rng in wherever one is wanted, so that a seeded game replays exactly.
// Depends on ../cards.js and ../duel.js.
import { BACKS, BEATS, cardOf } from '../cards.js';
import { printedPower } from '../duel.js';

/** What a Zurubang is worth when a number is wanted: better than a Dragon, and not infinitely so. */
export const ZURUBANG_VALUE = 12;

/**
 * Roughly what a card is worth in the hand: its power, with something for each ability and something for a talent.
 * It is a blunt measure on purpose — a sharper one belongs in the AI that wants it.
 *
 * @param {string} id
 * @returns {number}
 * Side effects: none.
 */
export function valueOf(id) {
  const card = cardOf(id);
  if (!card) return 0;
  const power = card.power === null ? ZURUBANG_VALUE : card.power;
  return power + card.abilities.length * 1.5 + (card.talent ? 1 : 0);
}

/** What a whole hand is worth. */
export const handValue = (hand) => hand.reduce((sum, id) => sum + valueOf(id), 0);

/** The card in a hand worth least, which is the one to throw away. */
export const weakest = (hand) => hand.reduce((worst, id) => (valueOf(id) < valueOf(worst) ? id : worst), hand[0]);

/** The card in a hand worth most. */
export const strongest = (hand) => hand.reduce((best, id) => (valueOf(id) > valueOf(best) ? id : best), hand[0]);

/** The stack with the most left on it, which is the one to draw from when nothing else decides. */
export const fullestOf = (counts) => counts.reduce((best, n, i) => (n > counts[best] ? i : best), 0);

/** One of the things in a list, chosen at random. */
export const anyOf = (list, rng) => list[Math.floor(rng() * list.length)];

/**
 * Would a card of this face beat a card of that one outright?  Only the element circle, which is all an AI can read
 * off a back it has not seen the face of.
 *
 * @param {string} mine  @param {string} theirs
 * @returns {boolean}
 * Side effects: none.
 */
export const beatsFace = (mine, theirs) => Boolean(mine) && Boolean(theirs) && BEATS[mine] === theirs;

/**
 * The element a card back promises.  Most of the time the back tells the truth, which is the whole reason the game
 * puts them on show, so an AI planning against a back is planning against five chances in six.
 *
 * @param {string | null} back
 * @returns {string | null}
 * Side effects: none.
 */
export const elementBehind = (back) => (back && BACKS.includes(back) ? ELEMENT_OF[back] : null);

const ELEMENT_OF = { white: 'air', green: 'earth', red: 'fire', black: 'spirit', blue: 'water' };

/**
 * The card in a hand most likely to beat whatever is hiding behind a back: one whose face beats the element the back
 * promises, the strongest of them, or the strongest card in hand when none of them does.
 *
 * @param {string[]} hand  @param {string | null} back  the back of the card it will face
 * @returns {string} a card from the hand
 * Side effects: none.
 */
export function answerTo(hand, back) {
  const element = elementBehind(back);
  const counters = hand.filter((id) => beatsFace(cardOf(id)?.face, element));
  return counters.length ? strongest(counters) : strongest(hand);
}

/**
 * How many backs a hand would have to change to reach a special hand, and which card is in the way.  A hand one card
 * off five of a kind is worth chasing; a hand three off is not.
 *
 * @param {string[]} hand
 * @returns {{ toFiveOfAKind: number, oddOne: string | null, toRainbow: number }}
 * Side effects: none.
 */
export function towardsSpecial(hand) {
  const backs = hand.map((id) => cardOf(id)?.back);
  const counts = {};
  for (const back of backs) counts[back] = (counts[back] ?? 0) + 1;
  const commonest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const oddOnes = hand.filter((id) => cardOf(id)?.back !== commonest[0]);
  const repeated = hand.filter((id) => counts[cardOf(id)?.back] > 1);
  return {
    toFiveOfAKind: hand.length - commonest[1],
    oddOne: oddOnes.length ? weakest(oddOnes) : null,
    toRainbow: hand.length - new Set(backs).size,
    duplicate: repeated.length ? weakest(repeated) : null,
  };
}

/** The positions of a hand's own placed cards, best card first, for a sudden death. */
export const bestPositions = (mine, choices) => [...choices].sort((a, b) => valueOf(mine[b]) - valueOf(mine[a]));

/** How close a score is to going out. */
export const nearlyHome = (score, target) => score >= target - 6;

/** Power as a number an AI can compare, with a Zurubang standing in as something very large. */
export const powerValue = (id) => (Number.isFinite(printedPower(id)) ? printedPower(id) : ZURUBANG_VALUE);
