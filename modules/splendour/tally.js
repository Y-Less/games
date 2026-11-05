// What Splendour counts about each player for the statistics and achievements (see module.json "stats").  The counters live
// on the player.  The game calls these as things happen in a turn; nothing here changes the game.
//
// Depends on: ../../shared/tally.js (bump, freshTally).
import { bump, freshTally } from '../../shared/tally.js';

/** The counters this game keeps for every player (the keys of the player's tally; see module.json "stats"). */
export const STAT_KEYS = ['cardsBought', 'noblesVisited', 'reservedCards', 'turnsTaken', 'level3Bought', 'nobleChoices', 'tokenReturns', 'freeCards', 'blindBuys'];
/**
 * A tally with every Splendour counter at zero.
 *
 * Side effects: none.
 *
 * @returns {Record<string, number>} a new object, one zero per STAT_KEYS entry
 */
export const newTally = () => freshTally(STAT_KEYS);

/** The highest level of development card. */
export const TOP_LEVEL = 3;

/**
 * Counts a development card bought (and, for a level 3 card, the separate level 3 counter).  A card that cost no tokens at
 * all was paid for by the discounts alone; one bought out of a card reserved face down was taken on trust from a pile.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the buyer's tally
 * @param {{ level: number }} card        the card bought
 * @param {{ free?: boolean, blind?: boolean }} [how]  whether no tokens were paid, and whether it was reserved blind
 */
export function tallyBuy(tally, card, { free = false, blind = false } = {}) {
  bump(tally, 'cardsBought');
  if (card.level === TOP_LEVEL) bump(tally, 'level3Bought');
  if (free) bump(tally, 'freeCards');
  if (blind) bump(tally, 'blindBuys');
}

/**
 * Counts a card reserved.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the player's tally
 */
export const tallyReserve = (tally) => bump(tally, 'reservedCards');
/**
 * Counts a noble visit.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the player's tally
 */
export const tallyNoble = (tally) => bump(tally, 'noblesVisited');
/**
 * Counts a turn taken.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the player's tally
 */
export const tallyTurn = (tally) => bump(tally, 'turnsTaken');

/**
 * Counts a turn that ended with two or more nobles visiting at once, so that the player had to choose.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the player's tally
 */
export const tallyNobleChoice = (tally) => bump(tally, 'nobleChoices');

/**
 * Counts putting tokens back after going over the limit.
 *
 * Side effects: mutates `tally`.
 *
 * @param {Record<string, number>} tally  the player's tally
 */
export const tallyReturn = (tally) => bump(tally, 'tokenReturns');
