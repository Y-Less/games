// What Cheat counts about each player for the statistics and achievements (see module.json "stats"). The game calls these as
// plays and calls are made; nothing here changes the game.
import { RANKS, SUITS } from '../../shared/cards.js';
import { bump, freshTally } from '../../shared/tally.js';

/** Every counter kept for a player. */
export const STAT_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect', 'liesGotAway', 'badCalls', 'brazenLies', 'cleanGetaways', 'fullSuits'];
/** A fresh set of counters, all zero, for one player. */
export const newTally = () => freshTally(STAT_KEYS);

/** The counters the table shows to everybody (the others are for the player's own statistics only). */
export const PUBLIC_KEYS = ['liesTold', 'liesCaught', 'callsMade', 'callsCorrect'];

/** The most cards that can be played at once: a lie with this many is a brazen one. */
export const BRAZEN_COUNT = 4;

/**
 * Counts a play of `count` cards, which was a lie or not. An honest play counts for nothing.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the player's counters
 * @param {{ count: number, lie: boolean }} play
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
 */
export const tallyLieStood = (tally) => bump(tally, 'liesGotAway');

/**
 * Counts going out with a lie that nobody called, and so winning.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the winner's counters
 */
export const tallyCleanGetaway = (tally) => bump(tally, 'cleanGetaways');

/** Does this hand hold all thirteen ranks of a suit? */
const holdsSuit = (hand, suit) => RANKS.every((rank) => hand.includes(rank + suit));

/**
 * Counts each suit a player now holds all thirteen of (one of each rank) that they did not hold before, e.g. after picking up the pile.
 * Side effects: mutates the tally.
 *
 * @param {object} tally  the player's counters
 * @param {string[]} before  the hand before
 * @param {string[]} after  the hand after
 */
export function tallyHand(tally, before, after) {
  for (const suit of SUITS) if (holdsSuit(after, suit) && !holdsSuit(before, suit)) bump(tally, 'fullSuits');
}
