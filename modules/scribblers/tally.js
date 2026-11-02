// What Scribblers counts about each player for the statistics and achievements (see module.json "stats").  The counters
// live on the player.  The game calls tallyTurn as each turn is scored; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally, peak } from '../../shared/tally.js';

// The counters kept on every player.
export const STAT_KEYS = ['wordsDrawn', 'wordsGuessed', 'firstGuesses', 'nobodyGot', 'bestTurn', 'guesses', 'wordsAdded', 'juvenilePicks'];
/**
 * A fresh set of zeroed counters for a new player.
 * @returns {object} one zero per STAT_KEYS entry
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);

/**
 * Counts a guess, right or wrong: every one a person types while somebody is drawing (not what they say between
 * turns, which is talk rather than guessing).
 *
 * @param {object} player  the player holding the counters
 * @returns {void}
 * Side effects: increments the player's `guesses`.
 */
export const tallyGuess = (player) => bump(player, 'guesses');

/**
 * Counts a word somebody added to the game themselves, and a drawer picking one of the juvenile ten (see words.js,
 * JUVENILE: the "Had to be done" achievement).
 *
 * @param {object} player  the player holding the counters
 * @param {'added' | 'juvenile'} what  which of the two
 * @returns {void}
 * Side effects: increments one of the player's counters.
 */
export const tallyWord = (player, what) => bump(player, what === 'juvenile' ? 'juvenilePicks' : 'wordsAdded');

/**
 * Counts a turn as it is scored.
 *   drawer     the player who was drawing (the object that holds the counters), or null if they have left
 *   guessed    the players who found the word, in the order they found it
 *   reason     why the turn ended ('allGuessed', 'timeUp', 'drawerAway')
 *   average    what the drawer scored
 * A turn nobody could draw ('drawerAway') counts for nobody.
 *
 * @param {object} turn  { drawer, guessed, reason, average } as above
 * @returns {void}
 * Side effects: increments counters on the drawer and on everybody who guessed (the player objects).
 */
export function tallyTurn({ drawer, guessed, reason, average }) {
  if (reason === 'drawerAway') return;
  if (drawer) {
    bump(drawer, 'wordsDrawn');
    peak(drawer, 'bestTurn', average);
    if (!guessed.length) bump(drawer, 'nobodyGot');
  }
  for (const [place, player] of guessed.entries()) {
    bump(player, 'wordsGuessed');
    peak(player, 'bestTurn', player.lastScore ?? 0);
    if (place === 0) bump(player, 'firstGuesses');
  }
}

/**
 * What to record for a player when the game ends.
 * @param {object} player  the player holding the counters
 * @returns {object} the extras to store with the player's result
 * Side effects: none.
 */
export const statsExtras = (player) => extrasOf(player, STAT_KEYS);
