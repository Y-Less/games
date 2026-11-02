// What Scribblers counts about each player for the statistics and achievements (see module.json "stats").  The counters
// live on the player.  The game calls tallyTurn as each turn is scored; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally, peak } from '../../shared/tally.js';

// The counters kept on every player.
export const STAT_KEYS = ['wordsDrawn', 'wordsGuessed', 'firstGuesses', 'everyoneGot', 'nobodyGot', 'bestTurn', 'turnsGuessing'];
/**
 * A fresh set of zeroed counters for a new player.
 * @returns {object} one zero per STAT_KEYS entry
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);

/** The fewest turns as a guesser that make "guessed every word" worth anything. */
export const MIN_PERFECT_TURNS = 3;

/**
 * Counts a turn as it is scored.
 *   drawer     the player who was drawing (the object that holds the counters), or null if they have left
 *   guessed    the players who found the word, in the order they found it
 *   guessers   everybody who was not drawing, whether they found it or not
 *   reason     why the turn ended ('allGuessed', 'timeUp', 'drawerAway')
 *   average    what the drawer scored
 * A turn nobody could draw ('drawerAway') counts for nobody.
 *
 * @param {object} turn  { drawer, guessed, guessers, reason, average } as above
 * @returns {void}
 * Side effects: increments counters on the drawer and the guessers (the player objects).
 */
export function tallyTurn({ drawer, guessed, guessers, reason, average }) {
  if (reason === 'drawerAway') return;
  if (drawer) {
    bump(drawer, 'wordsDrawn');
    peak(drawer, 'bestTurn', average);
    if (guessed.length && guessed.length === guessers.length) bump(drawer, 'everyoneGot');
    if (!guessed.length) bump(drawer, 'nobodyGot');
  }
  for (const player of guessers) bump(player, 'turnsGuessing');
  for (const [place, player] of guessed.entries()) {
    bump(player, 'wordsGuessed');
    peak(player, 'bestTurn', player.lastScore ?? 0);
    if (place === 0) bump(player, 'firstGuesses');
  }
}

/**
 * What to record for a player when the game ends.
 * cleanSweep needs at least MIN_PERFECT_TURNS turns as a guesser, so that a two-turn game is not a "clean sweep".
 * @param {object} player  the player holding the counters
 * @returns {object} the extras to store with the player's result
 * Side effects: none.
 */
export function statsExtras(player) {
  const turns = player.turnsGuessing ?? 0;
  return {
    ...extrasOf(player, ['wordsDrawn', 'wordsGuessed', 'firstGuesses', 'everyoneGot', 'nobodyGot', 'bestTurn']),
    cleanSweep: turns >= MIN_PERFECT_TURNS && player.wordsGuessed === turns ? 1 : 0,
  };
}
