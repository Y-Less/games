// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.
const KIND = { exact: 'exactly right', close: 'close', miss: 'missed' };

/** The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn). */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? 'Someone';
  const out = [];
  const samePhase = prev && prev.phase === next.phase && prev.turn === next.turn;

  if (next.phase === 'guessing1' && prev?.phase !== 'guessing1') out.push(`Turn ${next.turn} of ${next.turnsTotal}: ${name(next.hinter)} is the hinter.`);
  if (next.phase === 'guessing2' && prev?.phase === 'guessing1') out.push('Second round: guess again with the second hint.');

  if (prev && prev.turn === next.turn && next.phase !== 'reveal') {
    for (const key of ['first', 'second']) {
      const text = next.hints[key];
      if (text && text !== prev.hints[key]) out.push(`${name(next.hinter)} gave the ${key === 'first' ? '' : 'second '}hint “${text}”.`);
    }
  }
  if (samePhase) {
    for (const p of next.players) if (p.guessed && !prev.players.find((q) => q.id === p.id)?.guessed) out.push(`${p.name} guessed.`);
  }

  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the guesses go in before the line that says what the tint was.
    for (const e of next.result.entries) out.push(`${e.name} guessed ${e.cell} in round ${e.round}: ${KIND[e.kind] ?? e.kind} (+${e.points}).`);
    out.push(`The tint was ${next.result.tint}. ${next.result.hinterName} scores ${next.result.hinterPoints} for the hints.`);
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(`The game is over: ${winners.join(' and ')} ${winners.length > 1 ? 'win' : 'wins'}.`);
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push('The game was abandoned.');
  return out;
}
