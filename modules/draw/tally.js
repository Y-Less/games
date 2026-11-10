// What Draw! counts about each player, for the statistics and the achievements (see module.json "stats").  The
// counters live on the player in the room, like their score, so they follow a place when it changes hands and survive
// a restart.  Nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

/** Everything counted about a player over a game. */
const COUNTERS = ['drawn', 'guessedFirst', 'wasNamed', 'wentUnnamed', 'guesses'];

/**
 * Creates an empty set of counters, every one at zero (merged into a player when they are made).
 * @returns {object} the counters
 * Side effects: none.
 */
export const newCounters = () => freshTally(COUNTERS);

/** The counters a finished game records for each person. */
const RECORDED = ['drawn', 'guessedFirst', 'wasNamed', 'wentUnnamed'];

/**
 * Counts one guess for the player who made it, right or wrong.
 * @param {object} player  the player (mutated)
 * @returns {void}
 * Side effects: increments their `guesses`.
 */
export const tallyGuess = (player) => bump(player, 'guesses');

/**
 * Counts a finished turn: both drawers drew, and if anybody named a drawing, that drawer and that guesser get their
 * counter.  A drawing nobody named counts against its drawer, which is what "went unnamed" is for.
 *
 * @param {object} turn
 * @param {object[]} turn.drawers  the two who drew
 * @param {object | null} turn.winner  the drawer whose drawing was named, or null when neither was
 * @param {object | null} turn.guesser  the player who named it, or null
 * @returns {void}
 * Side effects: increments counters on the players given.
 */
export function tallyTurn({ drawers, winner, guesser }) {
  for (const drawer of drawers) {
    bump(drawer, 'drawn');
    if (drawer !== winner) bump(drawer, 'wentUnnamed');
  }
  if (winner) bump(winner, 'wasNamed');
  if (guesser) bump(guesser, 'guessedFirst');
}

/**
 * What to record for a person when the game ends.
 * @param {object} player  the player, whose counters are on them
 * @returns {object} the stat values to record
 * Side effects: none.
 */
export const statsExtras = (player) => extrasOf(player, RECORDED);
