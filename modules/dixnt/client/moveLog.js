// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by
// the component that draws the list, so Recent moves reads in the player's language whenever they switch.
// Used by store.js, which appends the lines to the Recent moves list.
import { msg } from '../../../shared/messages.js';

/**
 * Gives the round number as the scoreboard labels it (skipped rounds do not count).
 * @param {object} state  The game state: completedRounds, totalRounds and phase.
 * @returns {number} The current round (the one just finished while showing results), never above totalRounds.
 * Side effects: none.
 */
export const roundNumber = (state) => Math.min(state.completedRounds + (state.phase === 'results' ? 0 : 1), state.totalRounds);

// The phases in which a round is under way (a skipped round is one that leaves these without being completed).
const IN_ROUND = ['word', 'picking', 'voting'];

/**
 * Works out the lines that the step from `prev` to `next` adds (none for a first state, except the start of a round).
 * @param {object | null} prev  The previous state, or null if there was none.
 * @param {object | null} next  The state that has just arrived (null when the player left the game).
 * @returns {object[]} The new lines as messages, oldest first (empty for a lobby or no state).
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  // Returns the name of a player id in the new state (the site's "Someone" if they have gone).
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? msg('common.someone');
  const out = [];

  if (next.phase === 'word' && (!prev || prev.phase !== 'word' || prev.chooserId !== next.chooserId)) {
    if (prev && IN_ROUND.includes(prev.phase) && prev.completedRounds === next.completedRounds) out.push(msg('log.skipped'));
    out.push(msg('log.choosing', { n: roundNumber(next), name: name(next.chooserId) }));
  }
  if (prev?.phase === 'word' && next.phase === 'picking') out.push(msg('log.chose', { name: name(next.chooserId) }));

  if (prev && prev.phase === next.phase && ['picking', 'voting'].includes(next.phase)) {
    for (const p of next.players) {
      const was = prev.players.find((q) => q.id === p.id);
      if (!was) continue;
      if (next.phase === 'picking' && p.hasPlayed && !was.hasPlayed) out.push(msg('log.played', { name: p.name }));
      if (next.phase === 'voting' && p.hasVoted && !was.hasVoted) out.push(msg(next.judging === 'everyone' ? 'log.voted' : 'log.decided', { name: p.name }));
    }
  }

  if (prev?.phase === 'picking' && next.phase === 'voting') out.push(msg('log.allOnTable'));
  if (prev?.phase === 'voting' && next.phase === 'results' && next.results) {
    const r = next.results;
    if (r.judging === 'favourite') out.push(msg('log.favourite', { chooser: name(next.chooserId), winner: name(r.winnerId) }));
    else out.push(msg(r.groupCorrect ? 'log.imposterCaught' : 'log.imposterFooled', { name: name(r.imposterId) }));
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished' && prev) {
    const winners = next.players.filter((p) => next.winners.includes(p.id)).map((p) => p.name);
    if (winners.length) out.push(msg('log.gameOver', { names: winners, count: winners.length }));
  }
  return out;
}
