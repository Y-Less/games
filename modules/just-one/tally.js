// What Just One counts about each player for the statistics and achievements (see module.json "stats"). The counters live on
// the player. The game calls tallyTurn once a turn is scored; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

// The counters kept on every player.
export const STAT_KEYS = ['correctGuesses', 'bestHints', 'cluesGiven', 'cancelledClues', 'hiveMinds', 'guesserTurns'];
/**
 * A fresh set of zeroed counters for a new player.
 * @returns {object} one zero per STAT_KEYS entry
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);

/** The fewest turns as the guesser that make "guessed every word" worth anything. */
export const MIN_PERFECT_TURNS = 2;

/**
 * Counts a scored turn.
 *   guesser, best  the players (the objects that hold the counters), or null if they have left or there was no best hint
 *   correct        whether the guess was right
 *   clues          one per clue written: { writer (a player, or null if they have left), cancelled }
 * A "hive mind" is a turn in which every clue was cancelled.
 * @param {object} turn  { guesser, best, correct, clues } as above
 * @returns {void}
 * Side effects: increments counters on the guesser, best-hint writer and clue writers (the player objects).
 */
export function tallyTurn({ guesser, best, correct, clues }) {
  if (guesser) {
    bump(guesser, 'guesserTurns');
    if (correct) bump(guesser, 'correctGuesses');
  }
  if (best) bump(best, 'bestHints');
  const hive = clues.length > 0 && clues.every((c) => c.cancelled);
  for (const { writer, cancelled } of clues) {
    if (!writer) continue;
    bump(writer, 'cluesGiven');
    if (cancelled) bump(writer, 'cancelledClues');
    if (hive) bump(writer, 'hiveMinds');
  }
}

/**
 * What to record for a player when the game ends.
 * perfectGuesser needs at least MIN_PERFECT_TURNS turns so that one lucky guess is not a "perfect" record.
 * @param {object} player  the player holding the counters
 * @returns {object} the extras to store with the player's result
 * Side effects: none.
 */
export function statsExtras(player) {
  const turns = player.guesserTurns ?? 0;
  return {
    ...extrasOf(player, ['correctGuesses', 'bestHints', 'cluesGiven', 'cancelledClues', 'hiveMinds']),
    perfectGuesser: turns >= MIN_PERFECT_TURNS && player.correctGuesses === turns ? 1 : 0,
  };
}
