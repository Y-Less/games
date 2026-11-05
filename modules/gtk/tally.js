// What GTK counts about each player for the statistics and achievements (see module.json "stats").  The counters live on
// the player and are saved with the room.  The game calls tallyQuestion once a question has been scored, and
// tallyRound once both questions of a round are done; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

// The counters kept on every player.
export const STAT_KEYS = ['rightAnswers', 'peopleFooled', 'answersWritten', 'matchedTruth', 'namedAsTruth', 'nobodyFoundMe', 'cleanSweeps', 'perfectRounds', 'picksMade', 'roundsAsSubject'];
/**
 * A fresh set of zeroed counters for a new player.
 * @returns {object} one zero per STAT_KEYS entry
 * Side effects: none.
 */
export const newCounters = () => freshTally(STAT_KEYS);

/** The fewest picks that make "found every true answer" worth recording, so one lucky round is not a clean game. */
export const MIN_SHARP_PICKS = 4;

/**
 * Counts one scored question.
 *   subject   the player the question was about (or null if they have left), who neither picks nor scores
 *   picks     one per person who picked: { player (or null), right } — `right` means they found the true answer
 *   fakes     one per made-up answer: { player (or null), fooled (how many people picked it), matched (it happened to
 *             be the true answer) }
 *   named     the players in the room whose own name was the subject's true answer (see namedBy in game.js)
 *   foundByNobody  true when not one picker found the subject's own answer
 * A "clean sweep" is a made-up answer that every single picker fell for.
 * @param {object} question  { subject, picks, fakes, named, foundByNobody } as above
 * @returns {void}
 * Side effects: increments counters on the subject, the pickers, the writers of the made-up answers, and anybody named.
 */
export function tallyQuestion({ subject, picks, fakes, named = [], foundByNobody = false }) {
  if (subject) {
    bump(subject, 'answersWritten');
    if (foundByNobody) bump(subject, 'nobodyFoundMe');
  }
  for (const { player, right } of picks) {
    if (!player) continue;
    bump(player, 'picksMade');
    if (right) bump(player, 'rightAnswers');
  }
  for (const { player, fooled, matched } of fakes) {
    if (!player) continue;
    bump(player, 'answersWritten');
    bump(player, 'peopleFooled', fooled);
    if (matched) bump(player, 'matchedTruth');
    if (picks.length > 1 && fooled === picks.length) bump(player, 'cleanSweeps');
  }
  for (const player of named) if (player) bump(player, 'namedAsTruth');
}

/**
 * Counts a finished round (both of its questions).
 * @param {object} round
 * @param {object | null} round.subject  the player the round was about, if they are still here
 * @param {Array<{ player: object | null, rights: number, asked: number }>} round.pickers  how many of the round's
 *   questions each picker got right, out of how many they were asked
 * @returns {void}
 * Side effects: increments roundsAsSubject on the subject and perfectRounds on anybody who got every question right.
 */
export function tallyRound({ subject, pickers }) {
  if (subject) bump(subject, 'roundsAsSubject');
  for (const { player, rights, asked } of pickers) {
    if (player && asked > 0 && rights === asked) bump(player, 'perfectRounds');
  }
}

/**
 * What to record for a player when the game ends.
 * `neverFooled` needs at least MIN_SHARP_PICKS picks, so that a short game is not a perfect record.
 * @param {object} player  the player holding the counters
 * @returns {object} the extras to store with the player's result
 * Side effects: none.
 */
export function statsExtras(player) {
  const picks = player.picksMade ?? 0;
  return {
    ...extrasOf(player, ['rightAnswers', 'peopleFooled', 'answersWritten', 'matchedTruth', 'namedAsTruth', 'nobodyFoundMe', 'cleanSweeps', 'perfectRounds']),
    neverFooled: picks >= MIN_SHARP_PICKS && (player.rightAnswers ?? 0) === picks ? 1 : 0,
  };
}
