// What Just One counts about each player for the statistics and achievements (see module.json "stats"). The counters live on
// the player. The game calls tallyTurn once a turn is scored; nothing here changes the game.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

export const STAT_KEYS = ['correctGuesses', 'bestHints', 'cluesGiven', 'cancelledClues', 'hiveMinds', 'guesserTurns'];
export const newCounters = () => freshTally(STAT_KEYS);

/** The fewest turns as the guesser that make "guessed every word" worth anything. */
export const MIN_PERFECT_TURNS = 2;

/**
 * Counts a scored turn.
 *   guesser, best  the players (the objects that hold the counters), or null if they have left or there was no best hint
 *   correct        whether the guess was right
 *   clues          one per clue written: { writer (a player, or null if they have left), cancelled }
 * A "hive mind" is a turn in which every clue was cancelled.
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

/** What to record for a player when the game ends. */
export function statsExtras(player) {
  const turns = player.guesserTurns ?? 0;
  return {
    ...extrasOf(player, ['correctGuesses', 'bestHints', 'cluesGiven', 'cancelledClues', 'hiveMinds']),
    perfectGuesser: turns >= MIN_PERFECT_TURNS && player.correctGuesses === turns ? 1 : 0,
  };
}
