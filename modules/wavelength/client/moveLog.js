// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line. Nothing here needs the server to keep a log.

/** The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn). */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? 'Someone';
  const out = [];
  const sameTurn = prev && prev.turn === next.turn;

  if (next.phase === 'clue' && !(prev?.phase === 'clue' && sameTurn)) {
    const { left, right } = next.spectrum ?? {};
    out.push(`Turn ${next.turn} of ${next.turnsTotal}: ${name(next.psychic)} is the psychic, between ${left} and ${right}.`);
  }
  if (sameTurn && next.clue && next.clue !== prev.clue) out.push(`${name(next.psychic)} gave the clue “${next.clue}”.`);
  if (sameTurn && prev.phase === next.phase) {
    for (const p of next.players) if (p.guessed && !prev.players.find((q) => q.id === p.id)?.guessed) out.push(`${p.name} guessed.`);
  }

  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the guesses go in before the line that says how the psychic did.
    for (const e of next.result.entries) out.push(`${e.name} ${e.bullseye ? 'hit the bullseye' : e.points ? 'landed in the target' : 'missed'} (+${e.points}).`);
    out.push(`The target is revealed. ${next.result.psychicName} scores ${next.result.psychicPoints} for the clue.`);
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(`The game is over: ${winners.join(' and ')} ${winners.length > 1 ? 'win' : 'wins'}.`);
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push('The game was abandoned.');
  return out;
}
