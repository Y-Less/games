// What Trivium counts about each player for the statistics and the achievements (see module.json "stats").  The
// counters live on the player; the rules call tallyQuestion once a question has been scored and tallyRound at the end
// of a round.  Nothing here changes the game.
// Depends on: shared/tally.js for the counter helpers, and ./scoring.js for what counts as centre, edge, and snap.
import { bump, extrasOf, freshTally, peak } from '../../shared/tally.js';
import { SNAP_MS, isCentre, isEdge } from './scoring.js';

/** The counters Trivium keeps per player. */
export const STAT_KEYS = [
  'rightAnswers',
  'answersGiven',
  'fastestRight',
  'bestRound',
  'questionsMissed',
  'perfectRounds',
  'soleRight',
  'snapAnswers',
  'bullseyes',
  'edgeClicks',
  'lastButRight',
];

/**
 * A fresh, all-zero set of counters for a new player.
 *
 * @returns {object} counters keyed by STAT_KEYS
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);

/**
 * Picks this game's counters off a player for the statistics record.
 *
 * @param {object} player  the player holding the counters
 * @returns {object} the STAT_KEYS values of that player
 * Side effects: none.
 */
export const statsExtras = (player) => extrasOf(player, STAT_KEYS);

/**
 * Counts one scored question.  `entries` are the answers in the order they arrived, each already judged; `missed` are
 * the players who let the question go by.  "Only one who knew" and "better late than never" need somebody to have been
 * beaten to it, so they want at least two answers.
 *
 * @param {{ id: string|number, right: boolean, at: number, x: number, y: number }[]} entries  the answers, quickest first
 * @param {Array<string|number>} missed  the players who did not answer
 * @param {(id: string|number) => object} playerOf  looks up the player holding the counters
 * @returns {void}
 * Side effects: increments counters on the players (via bump); nothing else.
 */
export function tallyQuestion(entries, missed, playerOf) {
  const right = entries.filter((e) => e.right);
  for (const [place, entry] of entries.entries()) {
    const player = playerOf(entry.id);
    if (!player) continue;
    bump(player, 'answersGiven');
    if (isCentre(entry.x, entry.y)) bump(player, 'bullseyes');
    if (isEdge(entry.x, entry.y)) bump(player, 'edgeClicks');
    if (!entry.right) continue;
    bump(player, 'rightAnswers');
    if (right[0] === entry) bump(player, 'fastestRight');
    if (entry.at <= SNAP_MS) bump(player, 'snapAnswers');
    if (entries.length > 1 && right.length === 1) bump(player, 'soleRight');
    if (entries.length > 1 && place === entries.length - 1) bump(player, 'lastButRight');
  }
  for (const id of missed) {
    const player = playerOf(id);
    if (player) bump(player, 'questionsMissed');
  }
}

/**
 * Counts a finished round: what each player scored in it, and whether they got every question of it right.
 *
 * @param {object[]} players  the players holding the counters
 * @param {Record<string|number, number>} scored  what each of them scored this round
 * @param {Record<string|number, number>} correct  how many of the round's questions each of them got right
 * @param {number} asked  how many questions the round had
 * @returns {void}
 * Side effects: increments and raises counters on the players.
 */
export function tallyRound(players, scored, correct, asked) {
  for (const player of players) {
    peak(player, 'bestRound', scored[player.id] ?? 0);
    if (asked > 0 && (correct[player.id] ?? 0) === asked) bump(player, 'perfectRounds');
  }
}
