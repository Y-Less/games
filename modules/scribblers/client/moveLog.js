// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line.  Each line is a message (`{ key, params }`, see
// shared/messages.js) under the game's `log.*` keys, put into words by the table when it is drawn, so the list reads in
// the player's language whenever they switch.  Nothing here needs the server to keep a log.
//
// The guesses themselves are not in here: they are in the guesses panel beside the board.  This is the scoring and the
// turns, as in every other game.
import { msg } from '../../../shared/messages.js';

/**
 * The lines that the step from `prev` to `next` adds.  The caller appends them to its list, so a line is only produced
 * on the one step where its event happens.
 * @param {object | null} prev  the state before (null for the first state received)
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new lines as messages, oldest first (empty when there is no game or it is in the lobby)
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  /** A player's name from the new state, or the site's "Someone" if they are not found (a string, or a message). */
  const name = (id) => next.players.find((p) => p.id === id)?.name ?? msg('common.someone');
  const out = [];
  const sameTurn = prev && prev.round === next.round && prev.turn === next.turn;

  if (next.phase === 'choosing' && !(prev?.phase === 'choosing' && sameTurn)) out.push(msg('log.turnStart', { n: next.turn, of: next.turns, name: name(next.drawer) }));
  if (next.phase === 'drawing' && prev?.phase === 'choosing' && sameTurn) out.push(msg('log.drawing', { name: name(next.drawer) }));
  // Somebody has found the word: the view says who has, so the new ones are whoever was not there a moment ago.
  if (sameTurn && prev) {
    for (const p of next.players) {
      if (p.guessed && !prev.players.find((q) => q.id === p.id)?.guessed) out.push(msg('log.gotIt', { name: p.name }));
    }
  }
  if (next.phase === 'between' && prev?.phase !== 'between' && next.reveal) {
    const reveal = next.reveal;
    // The list is read newest first, so the points go in before the line that says what the word was.
    const scored = next.players.filter((p) => reveal.points[p.id]);
    if (reveal.reason === 'drawerAway') out.push(msg('log.drawerLeft', { name: name(reveal.drawer) }));
    else if (scored.length) out.push(msg('log.points', { names: scored.map((p) => msg('log.playerPoints', { name: p.name, n: reveal.points[p.id] })) }));
    else out.push(msg('log.nobodyGotIt'));
    out.push(msg('log.wordWas', { word: reveal.word ?? '' }));
  }
  if (next.phase === 'scores' && prev?.phase !== 'scores') out.push(msg('log.roundOver', { n: next.round, of: next.rounds }));
  if (next.phase === 'finished' && prev?.phase !== 'finished') {
    const winners = next.players.filter((p) => p.winner).map((p) => p.name);
    if (winners.length) out.push(msg('log.gameOver', { names: winners, count: winners.length }));
  }
  return out;
}
