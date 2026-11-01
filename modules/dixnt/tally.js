// What Dixnt counts about each player in a game for the statistics and achievements (see module.json "stats"). The server
// keeps one tally for each person in each game and calls tallyRound once a round is finished; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

/** Everything counted, including what is only needed to work out a stat at the end. */
export const COUNTERS = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks', 'votesCast'];
/**
 * Creates an empty tally with every counter at zero.
 * @returns {object} a fresh tally
 * Side effects: none.
 */
export const newTally = () => freshTally(COUNTERS);

/** The stats a game records for each person, besides the two worked out from the counters in statsExtras. */
const RECORDED = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks'];

/** The fewest rounds of voting that make "voted for the imposter every round" worth anything. */
export const MIN_SPYMASTER_ROUNDS = 3;

/**
 * Counts a finished round.
 *   tallyFor  (playerId) => the player's tally, or null for a computer player (they are not counted)
 *   pickers   the ids of the players who played a card
 *   results   the round's results (see Game: judging, imposterId, groupCorrect, winnerId, votes)
 * @param {(playerId: string) => (object | null)} tallyFor  looks up a person's tally (null for computer players)
 * @param {{ pickers: string[], results: object }} round  who played a card and the round's results
 * @returns {void} nothing
 * Side effects: increments counters on the tallies returned by `tallyFor`.
 */
export function tallyRound(tallyFor, { pickers, results }) {
  // Bumps one counter for a player, skipping computer players (tallyFor gives null).
  const count = (id, key) => {
    const tally = tallyFor(id);
    if (tally) bump(tally, key);
  };
  for (const id of pickers) count(id, 'cardsPlayed');
  if (results.judging === 'favourite') {
    if (results.winnerId) count(results.winnerId, 'favouritePicks');
    return;
  }
  if (!results.imposterId) return;
  count(results.imposterId, 'roundsAsImposter');
  if (!results.groupCorrect) count(results.imposterId, 'timesFooledGroup');
  const guesses = Object.entries(results.votes).filter(([voterId]) => voterId !== results.imposterId);
  for (const [voterId, targetId] of guesses) {
    count(voterId, 'votesCast');
    if (targetId === results.imposterId) count(voterId, 'correctGuesses');
  }
  const right = guesses.filter(([, targetId]) => targetId === results.imposterId);
  if (!results.groupCorrect && results.judging === 'everyone' && right.length === 1) count(right[0][0], 'soleCorrect');
}

/**
 * What to record for a person when the game ends.
 * @param {object} tally  the person's finished tally
 * @returns {object} the stat values to record, plus mostFooled and spymaster (1 only if they accused the imposter in every voting round, over enough rounds)
 * Side effects: none.
 */
export function statsExtras(tally) {
  const votes = tally.votesCast ?? 0;
  return {
    ...extrasOf(tally, RECORDED),
    mostFooled: tally.timesFooledGroup ?? 0,
    spymaster: votes >= MIN_SPYMASTER_ROUNDS && tally.correctGuesses === votes ? 1 : 0,
  };
}
