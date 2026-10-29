// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.

/** The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn). */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? 'Someone';
  const out = [];
  const sameTurn = prev && prev.turn === next.turn;

  if (next.phase === 'clues' && !(prev?.phase === 'clues' && sameTurn)) out.push(`Turn ${next.turn} of ${next.turnsTotal}: ${name(next.guesser)} is the guesser. Everyone else is writing a clue.`);
  if (next.phase === 'clues' && sameTurn && prev.phase === 'clues') {
    for (const p of next.players) if (p.written && !prev.players.find((q) => q.id === p.id)?.written) out.push(`${p.name} has written a clue.`);
  }
  if (next.phase === 'guessing' && prev?.phase !== 'guessing' && sameTurn) {
    const cancelled = next.clues.filter((c) => c.cancelled).length;
    out.push(cancelled ? `The clues are in. ${cancelled} matched and were cancelled.` : 'The clues are in. None of them matched.');
  }
  if (sameTurn && next.guess && !prev.guess) out.push(next.guess.passed ? `${name(next.guesser)} passed.` : `${name(next.guesser)} guessed “${next.guess.text}”.`);
  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the outcome goes in before the line that says what the word was.
    if (next.result.correct) out.push(next.result.bestName ? `${next.result.bestName}'s hint was the best (+${next.result.bestPoints}). ${next.result.guesserName} scores ${next.result.guesserPoints}.` : `${next.result.guesserName} scores ${next.result.guesserPoints}. No hints were left to pick from.`);
    out.push(`The word was “${next.result.word}”.`);
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(`The game is over: ${winners.join(' and ')} ${winners.length > 1 ? 'win' : 'wins'}.`);
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push('The game was abandoned.');
  return out;
}
