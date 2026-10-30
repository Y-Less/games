// What Wavelength counts about each player for the statistics and achievements (see module.json "stats"). The counters live
// on the player. The game calls tallyTurn once a turn is scored; nothing here changes the game.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

export const STAT_KEYS = ['bullseyes', 'cluesGiven', 'onlyScorer', 'highGuesses', 'lowGuesses', 'blankClues'];
export const newCounters = () => freshTally(STAT_KEYS);
export const statsExtras = (player) => extrasOf(player, STAT_KEYS);

/** The two ends of the dial. */
export const DIAL_MIN = 0;
export const DIAL_MAX = 100;

/**
 * Counts a scored turn.
 *   entries   one per guess: { id, position, points, bullseye }
 *   playerOf  the player (the object that holds the counters) for an id
 *   psychic   the player who gave the clue, or undefined if they have left
 * "Only scorer" and "blank clue" need at least two guessers, so three or more people.
 */
export function tallyTurn(entries, playerOf, psychic) {
  const scorers = entries.filter((e) => e.points > 0);
  for (const e of entries) {
    const player = playerOf(e.id);
    if (e.bullseye) bump(player, 'bullseyes');
    if (e.position === DIAL_MAX) bump(player, 'highGuesses');
    if (e.position === DIAL_MIN) bump(player, 'lowGuesses');
  }
  if (entries.length >= 2 && scorers.length === 1) bump(playerOf(scorers[0].id), 'onlyScorer');
  if (!psychic) return;
  bump(psychic, 'cluesGiven');
  if (entries.length >= 2 && !scorers.length) bump(psychic, 'blankClues');
}
