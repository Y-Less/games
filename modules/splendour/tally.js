// What Splendour counts about each player for the statistics and achievements (see module.json "stats"). The counters live
// on the player. The game calls these as things happen in a turn; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';

export const STAT_KEYS = ['cardsBought', 'noblesVisited', 'reservedCards', 'turnsTaken', 'level3Bought', 'nobleChoices', 'tokenReturns'];
export const newTally = () => freshTally(STAT_KEYS);

/** The highest level of development card. */
export const TOP_LEVEL = 3;

/** Counts a development card bought. */
export function tallyBuy(tally, card) {
  bump(tally, 'cardsBought');
  if (card.level === TOP_LEVEL) bump(tally, 'level3Bought');
}

export const tallyReserve = (tally) => bump(tally, 'reservedCards');
export const tallyNoble = (tally) => bump(tally, 'noblesVisited');
export const tallyTurn = (tally) => bump(tally, 'turnsTaken');

/** Counts a turn that ended with two or more nobles visiting at once, so that the player had to choose. */
export const tallyNobleChoice = (tally) => bump(tally, 'nobleChoices');

/** Counts putting tokens back after going over the limit. */
export const tallyReturn = (tally) => bump(tally, 'tokenReturns');
