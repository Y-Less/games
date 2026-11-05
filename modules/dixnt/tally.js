// What Dixnt counts about each player in a game for the statistics and achievements (see module.json "stats").  The server
// keeps one tally for each person in each game and calls tallyRound once a round is finished; nothing here changes the game.
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

/** Everything counted, including what is only needed to work out a stat at the end. */
const COUNTERS = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks', 'votesCast', 'votesAgainst', 'loneDissent'];
/**
 * Creates an empty tally with every counter at zero.
 * @returns {object} a fresh tally
 * Side effects: none.
 */
export const newTally = () => freshTally(COUNTERS);

/** The stats a game records for each person, besides the two worked out from the counters in statsExtras. */
const RECORDED = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks', 'loneDissent'];

/** The fewest rounds of voting that make "voted for the imposter every round" worth anything. */
export const MIN_SPYMASTER_ROUNDS = 3;

/** The fewest rounds as the imposter that make "nobody ever pointed at me" worth anything. */
export const MIN_UNACCUSED_IMPOSTER_ROUNDS = 2;
/** The fewest players for the same: with two there is hardly a crowd to go unnoticed in. */
export const MIN_UNACCUSED_PLAYERS = 3;
/** The fewest voters who must agree before standing alone against them is worth counting. */
export const MIN_CROWD = 2;

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
  // Every vote names somebody as the imposter, the imposter's own vote included: a player no vote ever names is above suspicion.
  for (const targetId of Object.values(results.votes)) count(targetId, 'votesAgainst');
  if (results.judging === 'everyone') countLoneDissent(count, results.votes);
}

/**
 * Counts the one voter who stood against the card the rest of the group settled on.  The player whose card it is never
 * counts as that voter: nobody may vote for their own card, so being the accused would otherwise be dissent by itself.
 * The group must be a real one (MIN_CROWD agreeing), and a tie for the most votes settles on no card at all.
 *
 * @param {(id: string, key: string) => void} count  bumps a counter for a person (computer players are skipped)
 * @param {Record<string, string>} votes  every vote of the round, as voter id to the id they voted for
 * @returns {void} nothing
 * Side effects: increments `loneDissent` on the lone dissenter, when there is exactly one.
 */
function countLoneDissent(count, votes) {
  const entries = Object.entries(votes);
  const counts = new Map();
  for (const [, targetId] of entries) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  const leaders = [...counts].filter(([, n]) => n === most).map(([id]) => id);
  if (leaders.length !== 1) return; // a tie: the group settled on nothing to stand against
  const [card] = leaders;
  const agreed = entries.filter(([voterId, targetId]) => targetId === card && voterId !== card);
  const against = entries.filter(([voterId, targetId]) => targetId !== card && voterId !== card);
  if (agreed.length >= MIN_CROWD && against.length === 1) count(against[0][0], 'loneDissent');
}

/**
 * What to record for a person when the game ends.  The game's own facts come in beside the tally: how many people were
 * playing at the end, and what this person finished on.
 *
 * @param {object} tally  the person's finished tally
 * @param {{ players?: number, score?: number|null }} [game]  the people left in the game, and this person's final score
 * @returns {object} the stat values to record, plus mostFooled, spymaster (they accused the imposter in every voting
 *   round, over enough rounds), neverAccused (no vote all game ever named them, over enough rounds as the imposter) and
 *   scorelessGames (they played and finished on nothing)
 * Side effects: none.
 */
export function statsExtras(tally, { players = 0, score = null } = {}) {
  const votes = tally.votesCast ?? 0;
  const asImposter = tally.roundsAsImposter ?? 0;
  const unaccused = players >= MIN_UNACCUSED_PLAYERS && asImposter >= MIN_UNACCUSED_IMPOSTER_ROUNDS && (tally.votesAgainst ?? 0) === 0;
  return {
    ...extrasOf(tally, RECORDED),
    mostFooled: tally.timesFooledGroup ?? 0,
    spymaster: votes >= MIN_SPYMASTER_ROUNDS && tally.correctGuesses === votes ? 1 : 0,
    neverAccused: unaccused ? 1 : 0,
    scorelessGames: score === 0 && (tally.cardsPlayed ?? 0) > 0 ? 1 : 0,
  };
}
