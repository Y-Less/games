// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line.  Nothing here needs the server to keep a log.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by the
// table when it is drawn, so the list reads in the player's language whenever they switch.
import { msg } from '../../../shared/messages.js';

/**
 * The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn).
 *
 * @param {object|null} prev  the previous server view, or null for the first one received
 * @param {object|null} next  the new server view
 * @returns {object[]} the new log lines as messages, oldest first within the step (the list is displayed newest first, so
 *   a result's guesses come before the line about the psychic)
 *
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  // Returns the name of a player in the new view, or the site's "Someone" if they have gone.
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? msg('common.someone');
  const out = [];
  // True when the step is within one turn (so a changed clue or guess is news, not a new turn's starting state).
  const sameTurn = prev && prev.turn === next.turn;

  if (next.phase === 'clue' && !(prev?.phase === 'clue' && sameTurn)) {
    const { left, right } = next.spectrum ?? {};
    out.push(msg('log.turnStart', { n: next.turn, total: next.turnsTotal, name: name(next.psychic), left, right }));
  }
  if (sameTurn && next.clue && next.clue !== prev.clue) out.push(msg('log.clue', { name: name(next.psychic), clue: next.clue }));
  if (sameTurn && prev.phase === next.phase) {
    for (const p of next.players) if (p.guessed && !prev.players.find((q) => q.id === p.id)?.guessed) out.push(msg('log.guessed', { name: p.name }));
  }

  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the guesses go in before the line that says how the psychic did.
    if (next.result.team) out.push(msg('log.teamLock', { name: name(next.result.lockedBy), points: next.result.psychicPoints }));
    else for (const e of next.result.entries) out.push(msg(e.bullseye ? 'log.bullseye' : e.points ? 'log.inTarget' : 'log.missed', { name: e.name, points: e.points }));
    out.push(msg('log.reveal', { name: next.result.psychicName, points: next.result.psychicPoints }));
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(msg('log.gameOver', { names: winners, count: winners.length }));
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push(msg('log.abandoned'));
  return out;
}
