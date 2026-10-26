// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.

/** The round number as the scoreboard labels it (skipped rounds do not count). */
export const roundNumber = (state) => Math.min(state.completedRounds + (state.phase === 'results' ? 0 : 1), state.totalRounds);

const IN_ROUND = ['word', 'picking', 'voting'];

/** The lines that the step from `prev` to `next` adds (none for a first state, except the start of a round). */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
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
