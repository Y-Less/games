// What Dixnt counts about each player in a game for the statistics and achievements (see module.json "stats").  The
// counters live on the player in the room, like their score, so they follow a place when it changes hands; the rules
// call tallyTurn once a turn is finished (see game.js, completeTurn).  Nothing here changes the game.
// `roundsAsImposter` counts turns, not rounds: it is a stat key recorded against people's accounts, so it keeps the
// name it was first written under while its label says what it really counts (see module.json).
// Depends on shared/tally.js for the counter helpers.
import { bump, extrasOf, freshTally } from '../../shared/tally.js';

/** Everything counted, including what is only needed to work out a stat at the end. */
const COUNTERS = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks', 'votesCast', 'votesAgainst', 'loneDissent'];
/**
 * Creates an empty set of counters, every one at zero (merged into a player when they are made).
 * @returns {object} the counters
 * Side effects: none.
 */
export const newCounters = () => freshTally(COUNTERS);

/** The stats a game records for each person, besides the two worked out from the counters in statsExtras. */
const RECORDED = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed', 'soleCorrect', 'favouritePicks', 'loneDissent'];

/** The fewest turns of voting that make "voted for the imposter every turn" worth anything. */
export const MIN_SPYMASTER_TURNS = 3;

/** The fewest turns as the imposter that make "nobody ever pointed at me" worth anything. */
export const MIN_UNACCUSED_IMPOSTER_TURNS = 2;
/** The fewest players for the same: with two there is hardly a crowd to go unnoticed in. */
export const MIN_UNACCUSED_PLAYERS = 3;
/** The fewest voters who must agree before standing alone against them is worth counting. */
export const MIN_CROWD = 2;

/**
 * Counts a finished turn.  Every id is a real player id (a table keyed by player id has text keys, and a person's
 * id is their account number), which is why the votes arrive as pairs rather than as the results' own object.
 *
 * @param {(playerId: number | string) => (object | null)} counterOf  a person's counters (null for a computer player)
 * @param {{ pickers: Array<number | string>, votes: Array<Array<number | string>>, results: object }} turn
 *   who played a card, every vote as [voter, who they voted for], and the turn's results (judging, imposterId,
 *   groupCorrect, winnerId)
 * @returns {void} nothing
 * Side effects: increments counters on the objects `counterOf` returns.
 */
export function tallyTurn(counterOf, { pickers, votes, results }) {
  // Bumps one counter for a player, skipping computer players (counterOf gives null).
  const count = (id, key) => {
    const counters = counterOf(id);
    if (counters) bump(counters, key);
  };
  for (const id of pickers) count(id, 'cardsPlayed');
  // The best-card styles: nobody was bluffing, so a vote is praise rather than an accusation and none of the
  // imposter counters apply.  Having the table settle on your card counts the same as the chooser picking it.
  if (results.judging === 'favourite' || results.judging === 'best') {
    if (results.winnerId !== null && results.winnerId !== undefined) count(results.winnerId, 'favouritePicks');
    return;
  }
  if (results.imposterId === null || results.imposterId === undefined) return;
  count(results.imposterId, 'roundsAsImposter');
  if (!results.groupCorrect) count(results.imposterId, 'timesFooledGroup');
  const guesses = votes.filter(([voterId]) => voterId !== results.imposterId);
  for (const [voterId, targetId] of guesses) {
    count(voterId, 'votesCast');
    if (targetId === results.imposterId) count(voterId, 'correctGuesses');
  }
  const right = guesses.filter(([, targetId]) => targetId === results.imposterId);
  if (!results.groupCorrect && results.judging === 'everyone' && right.length === 1) count(right[0][0], 'soleCorrect');
  // Every vote names somebody as the imposter, the imposter's own vote included: a player no vote ever names is above suspicion.
  for (const [, targetId] of votes) count(targetId, 'votesAgainst');
  if (results.judging === 'everyone') countLoneDissent(count, votes);
}

/**
 * Counts the one voter who stood against the card the rest of the group settled on.  The player whose card it is never
 * counts as that voter: nobody may vote for their own card, so being the accused would otherwise be dissent by itself.
 * The group must be a real one (MIN_CROWD agreeing), and a tie for the most votes settles on no card at all.
 *
 * @param {(id: number | string, key: string) => void} count  bumps a counter for a person (computer players are skipped)
 * @param {Array<Array<number | string>>} votes  every vote of the turn, as [voter, who they voted for]
 * @returns {void} nothing
 * Side effects: increments `loneDissent` on the lone dissenter, when there is exactly one.
 */
function countLoneDissent(count, votes) {
  const counts = new Map();
  for (const [, targetId] of votes) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  const leaders = [...counts].filter(([, n]) => n === most).map(([id]) => id);
  if (leaders.length !== 1) return; // a tie: the group settled on nothing to stand against
  const [card] = leaders;
  const agreed = votes.filter(([voterId, targetId]) => targetId === card && voterId !== card);
  const against = votes.filter(([voterId, targetId]) => targetId !== card && voterId !== card);
  if (agreed.length >= MIN_CROWD && against.length === 1) count(against[0][0], 'loneDissent');
}

/**
 * What to record for a person when the game ends.  The game's own facts come in beside the counters: how many people
 * were playing at the end, and what this person finished on.
 *
 * @param {object} tally  the person's finished counters (the player themselves: the counters live on them)
 * @param {{ players?: number, score?: number|null }} [game]  the people left in the game, and this person's final score
 * @returns {object} the stat values to record, plus mostFooled, spymaster (they accused the imposter in every voting
 *   turn, over enough turns), neverAccused (no vote all game ever named them, over enough turns as the imposter) and
 *   scorelessGames (they played and finished on nothing)
 * Side effects: none.
 */
export function statsExtras(tally, { players = 0, score = null } = {}) {
  const votes = tally.votesCast ?? 0;
  const asImposter = tally.roundsAsImposter ?? 0;
  const unaccused = players >= MIN_UNACCUSED_PLAYERS && asImposter >= MIN_UNACCUSED_IMPOSTER_TURNS && (tally.votesAgainst ?? 0) === 0;
  return {
    ...extrasOf(tally, RECORDED),
    mostFooled: tally.timesFooledGroup ?? 0,
    spymaster: votes >= MIN_SPYMASTER_TURNS && tally.correctGuesses === votes ? 1 : 0,
    neverAccused: unaccused ? 1 : 0,
    scorelessGames: score === 0 && (tally.cardsPlayed ?? 0) > 0 ? 1 : 0,
  };
}
