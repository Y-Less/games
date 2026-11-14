// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line.  Nothing here needs the server to keep a log.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by
// the component that draws the list, so Recent moves reads in the player's language whenever they switch.
// Used by store.js, which appends the lines to the Recent moves list.
import { endOfGame } from '../../../shared/logDiff.js';
import { msg } from '../../../shared/messages.js';

/**
 * Gives the turn number as the scoreboard labels it (skipped turns do not count).
 * @param {object} state  The game state: completedTurns, totalTurns, and phase.
 * @returns {number} The current turn (the one just finished while showing results), never above totalTurns.
 * Side effects: none.
 */
export const turnNumber = (state) => Math.min(state.completedTurns + (state.phase === 'results' ? 0 : 1), state.totalTurns);

/**
 * Gives the round number: the one being played, or, while the results of the turn that closed one are up, that round.
 * @param {object} state  The game state: completedRounds, rounds, results, and phase.
 * @returns {number} The current round, never above the number the host asked for.
 * Side effects: none.
 */
export const roundNumber = (state) => Math.min(state.completedRounds + (state.results?.roundOver ? 0 : 1), state.rounds);

// The phases in which a turn is under way (a skipped turn is one that leaves these without being completed).
const IN_TURN = ['word', 'picking', 'voting'];

/**
 * Works out the lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn).
 * @param {object | null} prev  The previous state, or null if there was none.
 * @param {object | null} next  The state that has just arrived (null when the player left the game).
 * @returns {object[]} The new lines as messages, oldest first (empty for a lobby or no state).
 * Side effects: none.
 */
/**
 * The lines that open a turn: the one that was skipped to get here, if one was, and whose word it now is.  A turn
 * is new when the phase is `word` and either the game was not in it before or the chooser has changed under it.
 * @param {object | null} prev  the state before
 * @param {object} next  the state that has just arrived
 * @param {(id: *) => *} name  names a player
 * @returns {object[]} the lines
 * Side effects: none.
 */
function turnOpening(prev, next, name) {
  if (next.phase !== 'word' || (prev && prev.phase === 'word' && prev.chooserId === next.chooserId)) return [];
  const out = [];
  // A turn left behind without being completed: say so before announcing the one replacing it.
  if (prev && IN_TURN.includes(prev.phase) && prev.completedTurns === next.completedTurns) out.push(msg('log.skipped'));
  out.push(msg('log.choosing', { n: turnNumber(next), name: name(next.chooserId) }));
  return out;
}

/**
 * The lines for people who have just done the thing the phase is waiting for: put a card down, or voted on them.
 * Only for somebody who was already there a state ago, so that a computer player stepping into a seat mid-turn does
 * not announce the move it inherited.
 * @param {object | null} prev  the state before
 * @param {object} next  the state that has just arrived
 * @returns {object[]} the lines
 * Side effects: none.
 */
function duringTurn(prev, next) {
  if (!prev || prev.phase !== next.phase || !['picking', 'voting'].includes(next.phase)) return [];
  const voting = next.phase === 'voting';
  const flag = voting ? 'hasVoted' : 'hasPlayed';
  const key = voting ? (next.judging === 'everyone' ? 'log.voted' : 'log.decided') : 'log.played';
  return next.players
    .filter((p) => {
      const was = prev.players.find((q) => q.id === p.id);
      return was && p[flag] && !was[flag];
    })
    .map((p) => msg(key, { name: p.name }));
}

/**
 * The lines for how a turn turned out, and for the end of the game.
 * @param {object | null} prev  the state before
 * @param {object} next  the state that has just arrived
 * @param {(id: *) => *} name  names a player
 * @returns {object[]} the lines
 * Side effects: none.
 */
function turnOutcome(prev, next, name) {
  const out = [];
  if (prev?.phase === 'picking' && next.phase === 'voting') out.push(msg('log.allOnTable'));
  if (prev?.phase === 'voting' && next.phase === 'results' && next.results) {
    const r = next.results;
    if (r.judging === 'favourite') out.push(msg('log.favourite', { chooser: name(next.chooserId), winner: name(r.winnerId) }));
    else out.push(msg(r.groupCorrect ? 'log.imposterCaught' : 'log.imposterFooled', { name: name(r.imposterId) }));
  }
  // Who won, on the step the game finishes (shared/logDiff.js); nothing for a state that arrives already finished.
  if (prev) out.push(...endOfGame(prev, next));
  return out;
}

export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  // Returns the name of a player id in the new state (the site's "Someone" if they have gone).  Ids read out of a
  // table's keys are text, while a person's id is their account number, so the two are matched as text.
  const name = (id) => next.players.find((p) => String(p.id) === String(id))?.name ?? msg('common.someone');
  return [
    ...turnOpening(prev, next, name),
    ...(prev?.phase === 'word' && next.phase === 'picking' ? [msg('log.chose', { name: name(next.chooserId) })] : []),
    ...duringTurn(prev, next),
    ...turnOutcome(prev, next, name),
  ];
}
