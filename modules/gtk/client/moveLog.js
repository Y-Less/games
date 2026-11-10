// The "Recent moves" of a game of GTK, worked out on the client from the state it already receives: each new state is
// compared with the one before, and what changed becomes a line.  Each line is a message (`{ key, params }`, see
// shared/messages.js) under the game's `log.*` keys, put into words by the table when it is drawn, so the list reads in
// the player's language whenever they switch.  Nothing here needs the server to keep a log.
import { endOfGame, entering, newlyFlagged } from '../../../shared/logDiff.js';
import { msg } from '../../../shared/messages.js';

/**
 * The lines that the step from `prev` to `next` adds (none for a first state, except the start of a round).  The caller
 * appends them to its list, so a line is only produced on the one step where its event happens.
 * @param {object | null} prev  the state before (null for the first state received)
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new lines as messages, oldest first (empty when there is no game or it is in the lobby)
 * Side effects: none.
 */
export function newEntries(prev, next) {
  if (!next || next.phase === 'lobby') return [];
  const out = [];
  const sameRound = prev && prev.round === next.round && prev.phase !== 'lobby';
  const sameQuestion = sameRound && prev.question === next.question;

  if (next.phase === 'writing' && !(prev?.phase === 'writing' && sameRound)) out.push(msg('log.roundStart', { n: next.round, total: next.roundsTotal, name: next.subjectName }));
  if (next.phase === 'writing' && sameRound && prev.phase === 'writing') out.push(...newlyFlagged(prev, next, 'written', 'log.written'));
  if (next.phase === 'picking' && !(prev?.phase === 'picking' && sameQuestion)) {
    if (prev?.phase === 'writing') out.push(msg('log.answersIn'));
    out.push(msg('log.questionUp', { n: next.question, prompt: next.prompts[next.question - 1] ?? '' }));
  }
  if (next.phase === 'picking' && sameQuestion && prev.phase === 'picking') out.push(...newlyFlagged(prev, next, 'picked', 'log.picked'));
  if (next.phase === 'reveal' && !(prev?.phase === 'reveal' && sameQuestion) && next.options.length) {
    const truth = next.options.find((o) => o.truth);
    out.push(msg('log.truthWas', { answer: truth?.text ?? '' }));
    const spotted = truth?.pickedBy?.length ?? 0;
    out.push(msg('log.spotted', { count: spotted }));
    for (const option of next.options) {
      if (option.truth || !option.pickedBy.length) continue;
      for (const author of option.authors) out.push(msg('log.fooled', { name: author.name, count: option.pickedBy.length, answer: option.text }));
    }
  }
  out.push(...endOfGame(prev, next));
  if (entering(prev, next, 'abandoned')) out.push(msg('log.abandoned'));
  return out;
}
