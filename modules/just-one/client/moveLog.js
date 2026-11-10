// The "Recent moves" of a game, worked out on the client from the state it already receives: each new state is compared
// with the one before, and what changed becomes a line.  Each line is a message (`{ key, params }`, see shared/messages.js)
// under the game's `log.*` keys, put into words by the table when it is drawn, so the list reads in the player's language
// whenever they switch.  Nothing here needs the server to keep a log.
import { endOfGame, entering, nameIn, newlyFlagged } from '../../../shared/logDiff.js';
import { msg } from '../../../shared/messages.js';

/**
 * The lines that the step from `prev` to `next` adds (none for a first state, except the start of a turn).  The caller appends
 * them to its list, so a line is only produced on the one step where its event happens.
 * @param {object | null} prev  the state before (null for the first state received)
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new lines as messages, oldest first (empty when there is no game or it is in the lobby)
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const name = nameIn(next);
  const out = [];
  const sameTurn = prev && prev.turn === next.turn;

  if (next.phase === 'clues' && !(prev?.phase === 'clues' && sameTurn)) out.push(msg('log.turnStart', { n: next.turn, total: next.turnsTotal, name: name(next.guesser) }));
  if (next.phase === 'clues' && sameTurn && prev.phase === 'clues') out.push(...newlyFlagged(prev, next, 'written', 'log.written'));
  if (next.phase === 'guessing' && prev?.phase !== 'guessing' && sameTurn) {
    const cancelled = next.clues.filter((c) => c.cancelled).length;
    out.push(msg('log.cluesIn', { count: cancelled }));
  }
  if (sameTurn && next.guess && !prev.guess) out.push(next.guess.passed ? msg('log.passed', { name: name(next.guesser) }) : msg('log.guessed', { name: name(next.guesser), guess: next.guess.text }));
  if (next.phase === 'reveal' && prev?.phase !== 'reveal' && next.result) {
    // The list is read newest first, so the outcome goes in before the line that says what the word was.
    const r = next.result;
    if (r.correct) out.push(r.bestName ? msg('log.bestHint', { best: r.bestName, points: r.bestPoints, name: r.guesserName, score: r.guesserPoints }) : msg('log.noHints', { name: r.guesserName, score: r.guesserPoints }));
    out.push(msg('log.wordWas', { word: r.word }));
  }
  out.push(...endOfGame(prev, next));
  if (entering(prev, next, 'abandoned')) out.push(msg('log.abandoned'));
  return out;
}
