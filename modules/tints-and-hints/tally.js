// What Tints and Hints counts about each player for the statistics and achievements (see module.json "stats").  The counters
// live on the player.  The game calls tallyTurn once a turn is scored; nothing here changes the game.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';
import { COLS, distance, parseCell } from './grid.js';

// Depends on shared/tally.js for the counter helpers and ./grid.js for cell geometry.

/** The statistic counters Tints and Hints keeps per player. */
export const STAT_KEYS = ['exactGuesses', 'closeGuesses', 'hintsGiven', 'missGuesses', 'firstExact', 'leeks', 'distance', 'alexTurns', 'doubleExacts', 'perfectHints'];
/**
 * A fresh, all-zero set of counters for a new player.
 *
 * @returns {object} counters keyed by STAT_KEYS
 *
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);
/**
 * Picks this game's counters off a player for the statistics record.
 *
 * @param {object} player  the player holding the counters
 * @returns {object} the STAT_KEYS values of that player
 *
 * Side effects: none.
 */
export const statsExtras = (player) => extrasOf(player, STAT_KEYS);

/** The columns that spell a name: a turn with a secret square in one of them is counted for its hinter (the `alex` achievement). */
export const ALEX = [...'ALEX'];

/**
 * Counts a scored turn.
 *   entries   one per guess: { id, round, cell, kind: 'exact' | 'close' | 'miss' }
 *   playerOf  the player (the object that holds the counters) for an id, or undefined if they have left
 *   hinter    the player who gave the hints, or undefined if they have left
 *   target    the secret square
 * A "leek" is a turn where nobody scored with the first hint, and somebody found the exact square with the second.  A
 * guesser who finds the square in both rounds scores for both, and that counts once more as a "twice over"; a hint that
 * every guesser finds the square from is a perfect one, which needs two guessers at least to mean anything.
 *
 * @param {object} turn  the scored turn
 * @param {{id: string, round: number, cell: string, kind: string}[]} turn.entries  the guesses
 * @param {(id: string) => object|undefined} turn.playerOf  looks up the player holding the counters
 * @param {object|undefined} turn.hinter  the hint-giver, or undefined if they have left
 * @param {string} turn.target  the secret square, such as 'B7'
 * @returns {void}
 *
 * Side effects: increments counters on guessers and the hinter (via bump); nothing else.
 */
export function tallyTurn({ entries, playerOf, hinter, target }) {
  const exactRounds = new Map(); // guesser id -> the rounds they found the square in
  for (const { id, round, cell, kind } of entries) {
    const player = playerOf(id);
    if (!player) continue;
    bump(player, 'distance', distance(cell, target));
    if (kind === 'exact') {
      bump(player, 'exactGuesses');
      if (round === 1) bump(player, 'firstExact');
      exactRounds.set(id, (exactRounds.get(id) ?? new Set()).add(round));
    } else if (kind === 'close') bump(player, 'closeGuesses');
    else bump(player, 'missGuesses');
  }
  for (const [id, rounds] of exactRounds) {
    const player = playerOf(id);
    if (player && rounds.size > 1) bump(player, 'doubleExacts');
  }
  if (!hinter) return;
  bump(hinter, 'hintsGiven');
  if (ALEX.includes(COLS[parseCell(target)?.col])) bump(hinter, 'alexTurns');
  const first = entries.filter((e) => e.round === 1);
  const foundLate = entries.some((e) => e.round === 2 && e.kind === 'exact');
  if (first.length && first.every((e) => e.kind === 'miss') && foundLate) bump(hinter, 'leeks');
  // A hint everybody found the square from.  With a single guesser there is nothing to it, so two are asked for.
  const guessers = new Set(entries.map((e) => e.id));
  if (guessers.size > 1 && exactRounds.size === guessers.size) bump(hinter, 'perfectHints');
}
