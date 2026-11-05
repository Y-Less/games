// What Cheat counts about each player for the statistics and achievements (see module.json "stats").  The game calls these as
// plays and calls are made; nothing here changes the game.  Depends on shared/cards.js and shared/tally.js.
import { RANKS, SUITS } from '../../shared/cards.js';
import { bump, freshTally } from '../../shared/tally.js';

/** Every counter kept for a player. */
export const STAT_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect', 'liesGotAway', 'badCalls', 'brazenLies', 'cleanGetaways', 'fullSuits', 'bigPickups'];
/**
 * A fresh set of counters, all zero, for one player.
 *
 * @returns {object} the counters, keyed by STAT_KEYS
 * Side effects: none.
 */
export const newTally = () => freshTally(STAT_KEYS);

/** The counters the table shows to everybody (the others are for the player's own statistics only). */
export const PUBLIC_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect'];

/** The most cards that can be played at once: a lie with this many is a brazen one. */
export const BRAZEN_COUNT = 4;

/** A pile of this many cards or more is a punishing one to pick up. */
export const BIG_PILE = 30;

/**
 * Counts picking up a pile big enough to hurt.  The size is the pile as it was before it was taken.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the picker's counters
 * @param {number} pileSize  how many cards were picked up
 * @returns {void}
 */
export function tallyPickup(tally, pileSize) {
  if (pileSize >= BIG_PILE) bump(tally, 'bigPickups');
}

/**
 * Counts a play of `count` cards, which was a lie or not.  An honest play counts for nothing.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the player's counters
 * @param {{ count: number, lie: boolean }} play  how many cards were played and whether the claim was false
 * @returns {void}
 */
export function tallyPlay(tally, { count, lie }) {
  if (!lie) return;
  bump(tally, 'liesTold');
  if (count === BRAZEN_COUNT) bump(tally, 'brazenLies');
}

/**
 * Counts a call of "Cheat!": the caller's, and a lie caught out or a call that was wrong.
 * Side effects: mutates both tallies.
 *
 * @param {object} callerTally  the caller's counters
 * @param {object} accusedTally  the accused player's counters
 * @param {boolean} lie  whether the play really was a lie
 * @returns {void}
 */
export function tallyCall(callerTally, accusedTally, lie) {
  bump(callerTally, 'callsMade');
  if (lie) {
    bump(callerTally, 'callsCorrect');
    bump(accusedTally, 'liesCaught');
  } else bump(callerTally, 'badCalls');
}

/**
 * Counts a lie that nobody called before the next play, or before the player who went out was believed.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the liar's counters
 * @returns {void}
 */
export const tallyLieStood = (tally) => bump(tally, 'liesGotAway');

/**
 * Counts going out with a lie that nobody called, and so winning.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the winner's counters
 * @returns {void}
 */
export const tallyCleanGetaway = (tally) => bump(tally, 'cleanGetaways');

/**
 * Does this hand hold all thirteen ranks of a suit?
 *
 * @param {string[]} hand  card codes (rank then suit)
 * @param {string} suit  the suit letter
 * @returns {boolean} true when every rank of the suit is held
 * Side effects: none.
 */
const holdsSuit = (hand, suit) => RANKS.every((rank) => hand.includes(rank + suit));

/**
 * Counts each suit a player now holds all thirteen of (one of each rank) that they did not hold before, e.g. after picking up the pile.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the player's counters
 * @param {string[]} before  the hand before
 * @param {string[]} after  the hand after
 * @returns {void}
 */
export function tallyHand(tally, before, after) {
  for (const suit of SUITS) if (holdsSuit(after, suit) && !holdsSuit(before, suit)) bump(tally, 'fullSuits');
}
