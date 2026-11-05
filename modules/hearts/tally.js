// What Hearts counts about each player for the statistics and achievements (see module.json "stats").  The game calls
// tallyHand once a hand is scored; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';
import { HAND_POINTS } from './deals.js';

export const STAT_KEYS = ['handsPlayed', 'moonsShot', 'queensTaken', 'heartsTaken', 'jacksTaken', 'queensAvoided', 'zeroHands', 'missedMoons', 'openingPassed', 'openingReceived', 'tricksWon', 'claimsMade'];
/**
 * A fresh, zeroed tally for one player.
 * @returns {object} counters for every key in STAT_KEYS.
 * Side effects: none.
 */
export const newTally = () => freshTally(STAT_KEYS);

/** A hand that scores exactly this was one heart short of shooting the moon. */
export const MISSED_MOON_POINTS = HAND_POINTS - 1;

/**
 * Counts one player's scored hand.
 *   cards  what they took: { hearts, queen, jack } (see scoreHand)
 *   hand   { points, shotMoon, moonShot, jackScores }: their points, whether they shot the moon, whether anybody did, and
 *          whether the Jack of Diamonds counted in this game
 * @param {object} tally  the player's tally.
 * @param {{hearts: number, queen: boolean, jack: boolean}} cards  what they took.
 * @param {object} hand  the hand's result, as above.
 * @returns {void}
 * Side effects: mutates tally.
 */
export function tallyHand(tally, cards, { points, shotMoon, moonShot, jackScores }) {
  bump(tally, 'handsPlayed');
  bump(tally, 'heartsTaken', cards.hearts);
  if (cards.queen) bump(tally, 'queensTaken');
  else bump(tally, 'queensAvoided');
  if (!cards.queen && cards.hearts === 0) bump(tally, 'zeroHands');
  if (cards.jack && jackScores) bump(tally, 'jacksTaken');
  if (shotMoon) bump(tally, 'moonsShot');
  if (!moonShot && points === MISSED_MOON_POINTS) bump(tally, 'missedMoons');
}

/**
 * Counts the opening card (the one that leads the first trick) being passed: who passed it on and who it was passed to.
 *   tallies   every seat's tally
 *   passes    the cards each seat passed
 *   targetOf  the seat a seat passed to
 *   opening   the opening card
 * @param {object[]} tallies  every seat's tally.
 * @param {string[][]} passes  cards passed by each seat.
 * @param {(seat: number) => number} targetOf  seat that a seat passed to.
 * @param {string} opening  the opening card.
 * @returns {void}
 * Side effects: mutates the tallies of seats that passed or received the opening card.
 */
export function tallyExchange(tallies, passes, targetOf, opening) {
  passes.forEach((cards, seat) => {
    if (!cards.includes(opening)) return;
    bump(tallies[seat], 'openingPassed');
    bump(tallies[targetOf(seat)], 'openingReceived');
  });
}

/**
 * Counts a trick won.
 * @param {object} tally  the winner's tally.
 * @returns {void}
 * Side effects: mutates tally.
 */
export const tallyTrick = (tally) => bump(tally, 'tricksWon');

/**
 * Counts a hand taken with Claim all: the player showed a hand that could not lose another trick and took the rest.
 * @param {object} tally  the claiming player's counters.
 * @returns {void}
 * Side effects: mutates `tally.claimsMade`.
 */
export const tallyClaim = (tally) => bump(tally, 'claimsMade');
