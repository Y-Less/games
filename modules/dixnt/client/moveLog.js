// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.
// Used by store.js, which appends the lines to the Recent moves list.

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
 * @returns {string[]} The new lines, oldest first (empty for a lobby or no state).
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  // Returns the name of a player id in the new state ('Someone' if gone).
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? 'Someone';
  const out = [];

  if (next.phase === 'word' && (!prev || prev.phase !== 'word' || prev.chooserId !== next.chooserId)) {
    if (prev && IN_ROUND.includes(prev.phase) && prev.completedRounds === next.completedRounds) out.push('The round was skipped.');
    out.push(`Round ${roundNumber(next)}: ${name(next.chooserId)} is choosing a word.`);
  }
  if (prev?.phase === 'word' && next.phase === 'picking') out.push(`${name(next.chooserId)} chose the word.`);

  if (prev && prev.phase === next.phase && ['picking', 'voting'].includes(next.phase)) {
    for (const p of next.players) {
      const was = prev.players.find((q) => q.id === p.id);
      if (!was) continue;
      if (next.phase === 'picking' && p.hasPlayed && !was.hasPlayed) out.push(`${p.name} played a card.`);
      if (next.phase === 'voting' && p.hasVoted && !was.hasVoted) out.push(next.judging === 'everyone' ? `${p.name} voted.` : `${p.name} made the choice.`);
    }
  }

  if (prev?.phase === 'picking' && next.phase === 'voting') out.push('All the cards are on the table.');
  if (prev?.phase === 'voting' && next.phase === 'results' && next.results) {
    const r = next.results;
    if (r.judging === 'favourite') out.push(`${name(next.chooserId)} picked ${name(r.winnerId)}’s card.`);
    else out.push(`${name(r.imposterId)} was the imposter. ${r.groupCorrect ? 'They were found out.' : 'They fooled the table.'}`);
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished' && prev) {
    const winners = next.players.filter((p) => next.winners.includes(p.id)).map((p) => p.name);
    if (winners.length) out.push(`The game is over: ${winners.join(' and ')} ${winners.length > 1 ? 'win' : 'wins'}.`);
  }
  return out;
}
