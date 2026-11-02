// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line.  Nothing here needs the server to keep a log.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's own keys, put into words by the
// table when it is drawn, so the list reads in the player's language whenever they switch.
import { msg } from '../../../shared/messages.js';

// The key for each kind of guess result, used in the guess lines of the log.
const KIND = { exact: 'log.kind.exact', close: 'log.kind.close', miss: 'log.kind.miss' };

/**
 * The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn).
 * @param {object|null} prev  the previous state (null for the first)
 * @param {object|null} next  the new state (null or lobby yields no lines)
 * @returns {object[]} new log lines as messages, oldest first
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  // Returns the name of the player with this id, or the site's "Someone" if not found.
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? msg('common.someone');
  const out = [];
  const samePhase = prev && prev.phase === next.phase && prev.turn === next.turn;

  if (next.phase === 'guessing1' && prev?.phase !== 'guessing1') out.push(msg('log.turnStart', { n: next.turn, total: next.turnsTotal, name: name(next.hinter) }));
  if (next.phase === 'guessing2' && prev?.phase === 'guessing1') out.push(msg('log.secondRound'));

  if (prev && prev.turn === next.turn && next.phase !== 'reveal') {
    for (const key of ['first', 'second']) {
      const text = next.hints[key];
      if (text && text !== prev.hints[key]) out.push(msg(key === 'first' ? 'log.firstHint' : 'log.secondHint', { name: name(next.hinter), text }));
    }
  }
  if (samePhase) {
    for (const p of next.players) if (p.guessed && !prev.players.find((q) => q.id === p.id)?.guessed) out.push(msg('log.guessed', { name: p.name }));
  }

  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the guesses go in before the line that says what the tint was.
    for (const e of next.result.entries) out.push(msg('log.guess', { name: e.name, cell: e.cell, round: e.round, kind: KIND[e.kind] ? msg(KIND[e.kind]) : e.kind, points: e.points }));
    out.push(msg('reveal.summary', { cell: next.result.tint, name: next.result.hinterName, points: next.result.hinterPoints }));
  }
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(msg('log.gameOver', { names: winners, count: winners.length }));
  }
  if (next.phase === 'abandoned' && prev?.phase !== 'abandoned') out.push(msg('status.abandoned'));
  return out;
}
