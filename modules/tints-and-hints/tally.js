// What Tints and Hints counts about each player for the statistics and achievements (see module.json "stats"). The counters
// live on the player. The game calls tallyTurn once a turn is scored; nothing here changes the game.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';
import { COLS, distance, parseCell } from './grid.js';

export const STAT_KEYS = ['exactGuesses', 'closeGuesses', 'hintsGiven', 'missGuesses', 'firstExact', 'leeks', 'distance', 'alexTurns'];
export const newCounters = () => freshTally(STAT_KEYS);
export const statsExtras = (player) => extrasOf(player, STAT_KEYS);

/** The columns that spell a name: a turn with a secret square in one of them is counted for its hinter (the "Alex" achievement). */
export const ALEX = [...'ALEX'];

/**
 * Counts a scored turn.
 *   entries   one per guess: { id, round, cell, kind: 'exact' | 'close' | 'miss' }
 *   playerOf  the player (the object that holds the counters) for an id, or undefined if they have left
 *   hinter    the player who gave the hints, or undefined if they have left
 *   target    the secret square
 * A "leek" is a turn where nobody scored with the first hint, and somebody found the exact square with the second.
 */
export function tallyTurn({ entries, playerOf, hinter, target }) {
  for (const { id, round, cell, kind } of entries) {
    const player = playerOf(id);
    if (!player) continue;
    bump(player, 'distance', distance(cell, target));
    if (kind === 'exact') {
      bump(player, 'exactGuesses');
      if (round === 1) bump(player, 'firstExact');
    } else if (kind === 'close') bump(player, 'closeGuesses');
    else bump(player, 'missGuesses');
  }
  if (!hinter) return;
  bump(hinter, 'hintsGiven');
  if (ALEX.includes(COLS[parseCell(target)?.col])) bump(hinter, 'alexTurns');
  const first = entries.filter((e) => e.round === 1);
  const foundLate = entries.some((e) => e.round === 2 && e.kind === 'exact');
  if (first.length && first.every((e) => e.kind === 'miss') && foundLate) bump(hinter, 'leeks');
}
